import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  ArbitratorRegistry,
  EscrowFactory,
  EscrowImplementation,
  MockERC20,
  PlatformTreasury,
} from "../typechain-types";

const FeeModel = { SPLIT_50_50: 0, BUYER_100: 1, SELLER_100: 2 };

const TWENTY_USDT = 20_000_000n;
const FIFTY_RUB_FEE = 550_000n;
const THRESHOLD = 11_000_000n;
const PERCENT_BPS = 500n;
const MIN_DEAL = 3_300_000n;
const FINE_MIN = 1_100_000n;
const FINE_MAX = 11_000_000n;
const FINE_BPS = 1000n;

const ARB_MIN_STAKE = 200_000_000n;
const ARB_SENIOR_MIN_STAKE = 100_000_000n;

describe("Audit fixes", () => {
  let admin: SignerWithAddress;
  let relay: SignerWithAddress;
  let newRelay: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let stranger: SignerWithAddress;

  let usdt: MockERC20;
  let treasury: PlatformTreasury;
  let registry: ArbitratorRegistry;
  let implementation: EscrowImplementation;
  let factory: EscrowFactory;

  const dealIdFor = (n: number) => ethers.keccak256(ethers.toUtf8Bytes(`audit-deal-${n}`));

  async function createEscrow(
    dealId: string,
    feeModel = FeeModel.SPLIT_50_50,
    deadlineOffset = 3600,
  ): Promise<{ escrow: EscrowImplementation; escrowAddr: string }> {
    const deadline = (await time.latest()) + deadlineOffset;
    await factory
      .connect(relay)
      .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, feeModel, deadline);
    const escrowAddr = await factory.escrowOf(dealId);
    const escrow = (await ethers.getContractAt(
      "EscrowImplementation",
      escrowAddr,
    )) as unknown as EscrowImplementation;
    return { escrow, escrowAddr };
  }

  beforeEach(async () => {
    [admin, relay, newRelay, buyer, seller, arbitrator, stranger] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    usdt = (await Mock.deploy("Tether USD", "USDT", 6)) as unknown as MockERC20;

    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    treasury = (await Treasury.deploy(await usdt.getAddress(), admin.address)) as unknown as PlatformTreasury;

    const Registry = await ethers.getContractFactory("ArbitratorRegistry");
    registry = (await Registry.deploy(
      await usdt.getAddress(),
      await treasury.getAddress(),
      ARB_MIN_STAKE,
      ARB_SENIOR_MIN_STAKE,
      admin.address,
    )) as unknown as ArbitratorRegistry;

    const Impl = await ethers.getContractFactory("EscrowImplementation");
    implementation = (await Impl.deploy()) as unknown as EscrowImplementation;

    const Factory = await ethers.getContractFactory("EscrowFactory");
    factory = (await Factory.deploy(
      await implementation.getAddress(),
      await usdt.getAddress(),
      await treasury.getAddress(),
      await registry.getAddress(),
      relay.address,
      admin.address,
      MIN_DEAL,
      { threshold: THRESHOLD, flatFee: FIFTY_RUB_FEE, percentFeeBps: PERCENT_BPS },
      { fineBps: FINE_BPS, fineMin: FINE_MIN, fineMax: FINE_MAX },
    )) as unknown as EscrowFactory;

    await treasury.connect(admin).grantRole(await treasury.FACTORY_ROLE(), await factory.getAddress());
    await registry.connect(admin).grantRole(await registry.FACTORY_ROLE(), await factory.getAddress());
  });

  describe("H1: rescue() — recovery of stuck funds", () => {
    it("returns full balance to buyer after expire() (deadline race)", async () => {
      const { escrow, escrowAddr } = await createEscrow(dealIdFor(1));
      // Relay forwarded USDT but notifyFunded never landed
      const funded = TWENTY_USDT + 500_000n;
      await usdt.mint(escrowAddr, funded);
      await time.increase(7200);
      await escrow.connect(stranger).expire(); // permissionless griefing attempt
      const before = await usdt.balanceOf(buyer.address);
      await expect(escrow.connect(stranger).rescue())
        .to.emit(escrow, "Rescued")
        .withArgs(buyer.address, funded);
      expect(await usdt.balanceOf(buyer.address)).to.equal(before + funded);
      expect(await usdt.balanceOf(escrowAddr)).to.equal(0);
    });

    it("returns funds to buyer after cancel()", async () => {
      const { escrow, escrowAddr } = await createEscrow(dealIdFor(2));
      await usdt.mint(escrowAddr, TWENTY_USDT);
      await escrow.connect(seller).cancel();
      await escrow.rescue();
      expect(await usdt.balanceOf(buyer.address)).to.equal(TWENTY_USDT);
    });

    it("sends overfunding surplus to treasury after release()", async () => {
      const { escrow, escrowAddr } = await createEscrow(dealIdFor(3));
      const buyerFee = 500_000n;
      const surplus = 3_000_000n;
      await usdt.mint(escrowAddr, TWENTY_USDT + buyerFee + surplus);
      await escrow.connect(relay).notifyFunded();
      await escrow.connect(buyer).release();
      expect(await usdt.balanceOf(escrowAddr)).to.equal(surplus);
      await expect(escrow.rescue())
        .to.emit(escrow, "Rescued")
        .withArgs(await treasury.getAddress(), surplus);
      // Admin reconciles the orphaned tokens into mainBalance
      await treasury.connect(admin).reconcile();
      const totalFee = 1_000_000n;
      expect(await treasury.mainBalance()).to.equal((totalFee * 8000n) / 10000n + surplus);
    });

    it("reverts in AWAITING_FUNDING and FUNDED (no theft path)", async () => {
      const { escrow, escrowAddr } = await createEscrow(dealIdFor(4));
      await usdt.mint(escrowAddr, TWENTY_USDT + 500_000n);
      await expect(escrow.rescue()).to.be.revertedWithCustomError(escrow, "WrongStatus");
      await escrow.connect(relay).notifyFunded();
      await expect(escrow.rescue()).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("reverts when there is nothing to rescue", async () => {
      const { escrow } = await createEscrow(dealIdFor(5));
      await escrow.connect(buyer).cancel();
      await expect(escrow.rescue()).to.be.revertedWithCustomError(escrow, "NothingToRescue");
    });
  });

  describe("H2: Treasury fundReserve() / moveToReserve()", () => {
    it("admin can fund reserve directly", async () => {
      await usdt.mint(admin.address, 50_000_000n);
      await usdt.connect(admin).approve(await treasury.getAddress(), 50_000_000n);
      await expect(treasury.connect(admin).fundReserve(50_000_000n))
        .to.emit(treasury, "ReserveFunded")
        .withArgs(admin.address, 50_000_000n);
      expect(await treasury.reserveBalance()).to.equal(50_000_000n);
    });

    it("non-admin cannot fund reserve", async () => {
      await expect(treasury.connect(stranger).fundReserve(1n)).to.be.reverted;
    });

    it("moveToReserve shifts accounting from main", async () => {
      // Earn some main balance via a released deal
      const { escrow, escrowAddr } = await createEscrow(dealIdFor(10));
      await usdt.mint(escrowAddr, TWENTY_USDT + 500_000n);
      await escrow.connect(relay).notifyFunded();
      await escrow.connect(buyer).release();
      const main = await treasury.mainBalance();
      await treasury.connect(admin).moveToReserve(main);
      expect(await treasury.mainBalance()).to.equal(0);
      expect(await treasury.reserveBalance()).to.equal(1_000_000n); // full fee now in reserve
    });

    it("buyer-win dispute resolves with empty reserve and defers the reward", async () => {
      // Hire an arbitrator
      await usdt.mint(arbitrator.address, ARB_MIN_STAKE);
      await usdt.connect(arbitrator).approve(await registry.getAddress(), ARB_MIN_STAKE);
      await registry.connect(admin).hire(arbitrator.address, 1 /* JUNIOR */);
      await registry.connect(arbitrator).depositStake(ARB_MIN_STAKE);

      const { escrow, escrowAddr } = await createEscrow(dealIdFor(11));
      await usdt.mint(escrowAddr, TWENTY_USDT + 500_000n);
      await escrow.connect(relay).notifyFunded();
      await escrow.connect(buyer).dispute();
      await escrow.connect(relay).assignArbitrator(arbitrator.address);

      const buyerBefore = await usdt.balanceOf(buyer.address);
      await expect(escrow.connect(arbitrator).resolve(100, 0)).to.emit(escrow, "Resolved");
      expect(await escrow.status()).to.equal(6); // RESOLVED, never frozen by reserve liquidity
      expect(await usdt.balanceOf(buyer.address)).to.equal(buyerBefore + TWENTY_USDT + 500_000n);
      expect(await usdt.balanceOf(escrowAddr)).to.equal(0n);
      expect(await treasury.deferredArbitratorRewards(arbitrator.address)).to.equal(2_000_000n);
    });
  });

  describe("M1: relay rotation propagates to live clones", () => {
    it("after setRelay the new relay controls existing escrows, old relay does not", async () => {
      const { escrow, escrowAddr } = await createEscrow(dealIdFor(20));
      await usdt.mint(escrowAddr, TWENTY_USDT + 500_000n);

      await factory.connect(admin).setRelay(newRelay.address);

      await expect(escrow.connect(relay).notifyFunded()).to.be.revertedWithCustomError(
        escrow,
        "NotRelay",
      );
      await escrow.connect(newRelay).notifyFunded();
      expect(await escrow.status()).to.equal(2); // FUNDED
      expect(await escrow.relay()).to.equal(newRelay.address);
    });
  });

  describe("L1: implementation singleton is locked", () => {
    it("initialize() on the implementation itself reverts", async () => {
      const params = {
        token: await usdt.getAddress(),
        treasury: await treasury.getAddress(),
        registry: await registry.getAddress(),
        dealId: dealIdFor(30),
        buyer: buyer.address,
        seller: seller.address,
        amount: TWENTY_USDT,
        buyerFee: 0n,
        sellerFee: 0n,
        fundingDeadline: BigInt((await time.latest()) + 3600),
        fineMin: FINE_MIN,
        fineMax: FINE_MAX,
        fineBps: FINE_BPS,
      };
      await expect(implementation.initialize(params)).to.be.revertedWithCustomError(
        implementation,
        "InvalidInitialization",
      );
    });
  });

  describe("L2: createEscrow validations", () => {
    it("reverts when fundingDeadline is in the past", async () => {
      const past = (await time.latest()) - 1;
      await expect(
        factory
          .connect(relay)
          .createEscrow(dealIdFor(40), buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, past),
      ).to.be.revertedWithCustomError(factory, "InvalidFundingDeadline");
    });

    it("reverts when sellerFee would exceed amount (SELLER_100 + misconfigured tariff)", async () => {
      // flatFee above minDealAmount: deal of MIN_DEAL with SELLER_100 → sellerFee > amount
      await factory.connect(admin).setTariff({
        threshold: THRESHOLD,
        flatFee: MIN_DEAL + 1n,
        percentFeeBps: PERCENT_BPS,
      });
      const deadline = (await time.latest()) + 3600;
      await expect(
        factory
          .connect(relay)
          .createEscrow(dealIdFor(41), buyer.address, seller.address, MIN_DEAL, FeeModel.SELLER_100, deadline),
      ).to.be.revertedWithCustomError(factory, "FeeExceedsAmount");
    });
  });

  describe("L3: tariff percent cap", () => {
    it("setTariff reverts above MAX_PERCENT_FEE_BPS", async () => {
      await expect(
        factory
          .connect(admin)
          .setTariff({ threshold: THRESHOLD, flatFee: FIFTY_RUB_FEE, percentFeeBps: 1001n }),
      ).to.be.revertedWithCustomError(factory, "TariffTooHigh");
    });

    it("constructor reverts above MAX_PERCENT_FEE_BPS", async () => {
      const Factory = await ethers.getContractFactory("EscrowFactory");
      await expect(
        Factory.deploy(
          await implementation.getAddress(),
          await usdt.getAddress(),
          await treasury.getAddress(),
          await registry.getAddress(),
          relay.address,
          admin.address,
          MIN_DEAL,
          { threshold: THRESHOLD, flatFee: FIFTY_RUB_FEE, percentFeeBps: 5000n },
          { fineBps: FINE_BPS, fineMin: FINE_MIN, fineMax: FINE_MAX },
        ),
      ).to.be.revertedWithCustomError(Factory, "TariffTooHigh");
    });
  });
});
