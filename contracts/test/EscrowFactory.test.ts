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

const Level = { TRAINEE: 0, JUNIOR: 1, SENIOR: 2, HEAD: 3 };
const FeeModel = { SPLIT_50_50: 0, BUYER_100: 1, SELLER_100: 2 };

const TWENTY_USDT = 20_000_000n; // 20 USDT in 6-decimal units
const FIFTY_RUB_FEE = 550_000n; // ~$0.55 ≈ 50 ₽
const THRESHOLD = 11_000_000n; // ~$11 ≈ 1000 ₽
const PERCENT_BPS = 500n; // 5%
const MIN_DEAL = 3_300_000n; // ~$3.30 ≈ 300 ₽
const FINE_MIN = 1_100_000n; // ~$1.10 ≈ 100 ₽
const FINE_MAX = 11_000_000n; // ~$11 ≈ 1000 ₽
const FINE_BPS = 1000n; // 10%

const ARB_MIN_STAKE = 200_000_000n;
const ARB_SENIOR_MIN_STAKE = 100_000_000n;

describe("EscrowFactory + EscrowImplementation", () => {
  let admin: SignerWithAddress;
  let relay: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let stranger: SignerWithAddress;

  let usdt: MockERC20;
  let treasury: PlatformTreasury;
  let registry: ArbitratorRegistry;
  let implementation: EscrowImplementation;
  let factory: EscrowFactory;

  beforeEach(async () => {
    [admin, relay, buyer, seller, arbitrator, stranger] = await ethers.getSigners();

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

    // Wire up roles
    await treasury.connect(admin).grantRole(await treasury.FACTORY_ROLE(), await factory.getAddress());
    await registry.connect(admin).grantRole(await registry.FACTORY_ROLE(), await factory.getAddress());
    await treasury
      .connect(admin)
      .grantRole(await treasury.REGISTRY_ROLE(), await registry.getAddress());

    // Hire arbitrator with stake
    await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
    await usdt.mint(arbitrator.address, ARB_MIN_STAKE);
    await usdt.connect(arbitrator).approve(await registry.getAddress(), ethers.MaxUint256);
    await registry.connect(arbitrator).depositStake(ARB_MIN_STAKE);
  });

  function dealIdFor(n: number): string {
    return ethers.zeroPadValue(ethers.toBeHex(n), 32);
  }

  describe("deployment & config", () => {
    it("computes total fee correctly under threshold (flat)", async () => {
      // Deal 5 USDT (under 11 USDT threshold) → flat 0.55 USDT
      expect(await factory.computeTotalFee(5_000_000n)).to.equal(FIFTY_RUB_FEE);
    });

    it("computes total fee correctly above threshold (percent)", async () => {
      // Deal 100 USDT → 5% = 5 USDT
      expect(await factory.computeTotalFee(100_000_000n)).to.equal(5_000_000n);
    });

    it("splits fee 50/50, 100/0, 0/100", async () => {
      const [b1, s1] = await factory.splitFee(1000n, FeeModel.SPLIT_50_50);
      expect(b1).to.equal(500n);
      expect(s1).to.equal(500n);

      const [b2, s2] = await factory.splitFee(1000n, FeeModel.BUYER_100);
      expect(b2).to.equal(1000n);
      expect(s2).to.equal(0n);

      const [b3, s3] = await factory.splitFee(1000n, FeeModel.SELLER_100);
      expect(b3).to.equal(0n);
      expect(s3).to.equal(1000n);
    });
  });

  describe("createEscrow", () => {
    const deadline = () => Math.floor(Date.now() / 1000) + 3600;

    it("clones, initializes, and grants ESCROW_ROLE", async () => {
      const dealId = dealIdFor(1);
      const tx = await factory
        .connect(relay)
        .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, deadline());
      await tx.wait();

      const escrowAddr = await factory.escrowOf(dealId);
      expect(escrowAddr).to.equal(await factory.predictEscrowAddress(dealId));

      const escrow = (await ethers.getContractAt("EscrowImplementation", escrowAddr)) as unknown as EscrowImplementation;
      expect(await escrow.buyer()).to.equal(buyer.address);
      expect(await escrow.seller()).to.equal(seller.address);
      expect(await escrow.amount()).to.equal(TWENTY_USDT);
      expect(await escrow.buyerFee()).to.equal(500_000n); // 1 USDT total fee → 50/50 split
      expect(await escrow.sellerFee()).to.equal(500_000n);

      expect(await treasury.hasRole(await treasury.ESCROW_ROLE(), escrowAddr)).to.equal(true);
      expect(await registry.hasRole(await registry.ESCROW_ROLE(), escrowAddr)).to.equal(true);
    });

    it("reverts if amount below minimum", async () => {
      const dealId = dealIdFor(2);
      await expect(
        factory
          .connect(relay)
          .createEscrow(
            dealId,
            buyer.address,
            seller.address,
            MIN_DEAL - 1n,
            FeeModel.SPLIT_50_50,
            deadline(),
          ),
      ).to.be.revertedWithCustomError(factory, "AmountBelowMinimum");
    });

    it("reverts if dealId already used", async () => {
      const dealId = dealIdFor(3);
      await factory
        .connect(relay)
        .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, deadline());
      await expect(
        factory
          .connect(relay)
          .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, deadline()),
      ).to.be.revertedWithCustomError(factory, "EscrowAlreadyExists");
    });

    it("reverts if not RELAY_ROLE", async () => {
      const dealId = dealIdFor(4);
      await expect(
        factory
          .connect(stranger)
          .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, deadline()),
      ).to.be.reverted;
    });
  });

  describe("escrow lifecycle: happy path (release)", () => {
    let escrow: EscrowImplementation;
    let escrowAddr: string;
    const dealId = dealIdFor(10);

    beforeEach(async () => {
      const deadline = (await time.latest()) + 3600;
      await factory
        .connect(relay)
        .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, deadline);
      escrowAddr = await factory.escrowOf(dealId);
      escrow = (await ethers.getContractAt("EscrowImplementation", escrowAddr)) as unknown as EscrowImplementation;
    });

    it("notifyFunded → release → seller payout + treasury fee", async () => {
      // Funding: buyer paid 20 + 0.5 = 20.5 USDT into escrow
      const totalFee = 1_000_000n; // 1 USDT
      const buyerFee = 500_000n;
      const sellerFee = 500_000n;
      const fundedAmount = TWENTY_USDT + buyerFee;

      await usdt.mint(escrowAddr, fundedAmount);
      await escrow.connect(relay).notifyFunded();
      expect(await escrow.status()).to.equal(2); // FUNDED

      // Buyer releases
      const sellerBefore = await usdt.balanceOf(seller.address);
      await escrow.connect(buyer).release();
      expect(await escrow.status()).to.equal(3); // RELEASED

      // Seller got amount - sellerFee = 19.5 USDT
      expect(await usdt.balanceOf(seller.address)).to.equal(sellerBefore + (TWENTY_USDT - sellerFee));
      // Treasury got totalFee = 1 USDT (split 80/20 main/reserve)
      expect(await treasury.mainBalance()).to.equal((totalFee * 8000n) / 10000n);
      expect(await treasury.reserveBalance()).to.equal((totalFee * 2000n) / 10000n);
      // Escrow drained
      expect(await usdt.balanceOf(escrowAddr)).to.equal(0);
    });

    it("notifyFunded reverts if balance below expected", async () => {
      // Send less than expected
      await usdt.mint(escrowAddr, TWENTY_USDT); // forgot the buyerFee
      await expect(escrow.connect(relay).notifyFunded()).to.be.revertedWithCustomError(
        escrow,
        "InsufficientFunding",
      );
    });

    it("release fails if not buyer", async () => {
      const fundedAmount = TWENTY_USDT + 500_000n;
      await usdt.mint(escrowAddr, fundedAmount);
      await escrow.connect(relay).notifyFunded();
      await expect(escrow.connect(stranger).release()).to.be.revertedWithCustomError(escrow, "NotBuyer");
    });

    it("release fails before FUNDED", async () => {
      await expect(escrow.connect(buyer).release()).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });
  });

  describe("escrow lifecycle: refund (seller backs out)", () => {
    let escrow: EscrowImplementation;
    let escrowAddr: string;
    const dealId = dealIdFor(11);

    beforeEach(async () => {
      const deadline = (await time.latest()) + 3600;
      await factory
        .connect(relay)
        .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.BUYER_100, deadline);
      escrowAddr = await factory.escrowOf(dealId);
      escrow = (await ethers.getContractAt("EscrowImplementation", escrowAddr)) as unknown as EscrowImplementation;
    });

    it("seller-only: full refund of amount + buyerFee, no fee charged", async () => {
      const buyerFee = 1_000_000n;
      const fundedAmount = TWENTY_USDT + buyerFee;
      await usdt.mint(escrowAddr, fundedAmount);
      await escrow.connect(relay).notifyFunded();

      const buyerBefore = await usdt.balanceOf(buyer.address);
      await escrow.connect(seller).refund();
      expect(await escrow.status()).to.equal(4); // REFUNDED
      expect(await usdt.balanceOf(buyer.address)).to.equal(buyerBefore + fundedAmount);
      expect(await treasury.mainBalance()).to.equal(0);
      expect(await treasury.reserveBalance()).to.equal(0);
    });

    it("refund fails if not seller", async () => {
      const fundedAmount = TWENTY_USDT + 1_000_000n;
      await usdt.mint(escrowAddr, fundedAmount);
      await escrow.connect(relay).notifyFunded();
      await expect(escrow.connect(buyer).refund()).to.be.revertedWithCustomError(escrow, "NotSeller");
    });
  });

  describe("escrow lifecycle: cancel before funding", () => {
    let escrow: EscrowImplementation;
    let escrowAddr: string;
    const dealId = dealIdFor(12);

    beforeEach(async () => {
      const deadline = (await time.latest()) + 3600;
      await factory
        .connect(relay)
        .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, deadline);
      escrowAddr = await factory.escrowOf(dealId);
      escrow = (await ethers.getContractAt("EscrowImplementation", escrowAddr)) as unknown as EscrowImplementation;
    });

    it("either party can cancel", async () => {
      await escrow.connect(buyer).cancel();
      expect(await escrow.status()).to.equal(7); // CANCELLED
    });

    it("seller can also cancel", async () => {
      await escrow.connect(seller).cancel();
      expect(await escrow.status()).to.equal(7);
    });

    it("stranger cannot cancel", async () => {
      await expect(escrow.connect(stranger).cancel()).to.be.revertedWithCustomError(escrow, "NotParty");
    });

    it("expire after deadline by anyone", async () => {
      await time.increase(3700);
      await escrow.connect(stranger).expire();
      expect(await escrow.status()).to.equal(8); // EXPIRED
    });

    it("expire before deadline reverts", async () => {
      await expect(escrow.connect(stranger).expire()).to.be.revertedWithCustomError(
        escrow,
        "FundingDeadlineNotPassed",
      );
    });
  });

  describe("escrow lifecycle: dispute & resolve", () => {
    let escrow: EscrowImplementation;
    let escrowAddr: string;
    const dealId = dealIdFor(20);

    beforeEach(async () => {
      const deadline = (await time.latest()) + 3600;
      await factory
        .connect(relay)
        .createEscrow(dealId, buyer.address, seller.address, TWENTY_USDT, FeeModel.SPLIT_50_50, deadline);
      escrowAddr = await factory.escrowOf(dealId);
      escrow = (await ethers.getContractAt("EscrowImplementation", escrowAddr)) as unknown as EscrowImplementation;

      const fundedAmount = TWENTY_USDT + 500_000n;
      await usdt.mint(escrowAddr, fundedAmount);
      await escrow.connect(relay).notifyFunded();
    });

    it("buyer opens dispute, relay assigns arbitrator", async () => {
      await escrow.connect(buyer).dispute();
      expect(await escrow.status()).to.equal(5); // DISPUTED
      await escrow.connect(relay).assignArbitrator(arbitrator.address);
      expect(await escrow.assignedArbitrator()).to.equal(arbitrator.address);
    });

    it("seller can also open dispute", async () => {
      await escrow.connect(seller).dispute();
      expect(await escrow.status()).to.equal(5);
    });

    it("assigning ineligible arbitrator reverts", async () => {
      await escrow.connect(buyer).dispute();
      await expect(
        escrow.connect(relay).assignArbitrator(stranger.address),
      ).to.be.revertedWithCustomError(escrow, "ArbitratorNotEligible");
    });

    it("resolve 100/0 (buyer fully wins) — fine paid from Treasury Reserve", async () => {
      await escrow.connect(buyer).dispute();
      await escrow.connect(relay).assignArbitrator(arbitrator.address);

      // Pre-load Treasury Reserve so it can pay arbitrator (need enough reserve)
      // Fine = max(10% * 20 USDT, fineMin) = 2 USDT (since 2 > 1.1, 2 < 11 → 2 USDT)
      const expectedFine = 2_000_000n;
      // Need reserve ≥ fine. Pre-fund.
      await usdt.mint(await treasury.getAddress(), expectedFine);
      // Use admin: deposit via depositFee won't work because we need ESCROW_ROLE. Manually adjust via reconcile.
      await treasury.connect(admin).reconcile(); // Now mainBalance = expectedFine; we need it in reserveBalance.
      // Easiest: set reserveBps = 10000 (100% goes to reserve) and depositFee from escrow context.
      // Simpler: have arbitrator slash herself? No — too contrived. Use depositSlashedStake via REGISTRY_ROLE.
      // But registry only calls depositSlashedStake with token transfer. Let's go through proper path:
      // give admin REGISTRY_ROLE temporarily:
      await treasury.connect(admin).grantRole(await treasury.REGISTRY_ROLE(), admin.address);
      // first, transfer expectedFine into treasury, then call depositSlashedStake
      // already minted earlier via reconcile() which moved into mainBalance. We need to revert that.
      // Simpler: redeploy fresh treasury in this test... too much. Alternative:
      // Drop the reconcile and instead: mint to treasury, call depositSlashedStake(amount)
      // But we already reconciled. Let's just compensateUser to drain main and start fresh:
      // Forget it — use a different strategy: have arbitrator slashed and stake go to reserve.
      // Reset: we'll just check the call path even with insufficient reserve, by skipping fine portion check.
      // For simplicity, mint extra and call depositSlashedStake from admin:
      await usdt.mint(await treasury.getAddress(), expectedFine);
      await treasury.connect(admin).depositSlashedStake(expectedFine);

      // Now reserve has 2 USDT
      const reserveBefore = await treasury.reserveBalance();
      const arbBefore = await usdt.balanceOf(arbitrator.address);
      const buyerBefore = await usdt.balanceOf(buyer.address);

      await escrow.connect(arbitrator).resolve(100, 0);

      // Buyer wins all of escrow balance (no fineFromEscrow because sellerSharePct=0)
      const escrowFunded = TWENTY_USDT + 500_000n;
      expect(await usdt.balanceOf(buyer.address)).to.equal(buyerBefore + escrowFunded);
      // Arbitrator got fine entirely from reserve
      expect(await usdt.balanceOf(arbitrator.address)).to.equal(arbBefore + expectedFine);
      expect(await treasury.reserveBalance()).to.equal(reserveBefore - expectedFine);
      // resolved counter incremented
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.totalResolved).to.equal(1n);
    });

    it("resolve 0/100 (seller fully wins) — fine paid from escrow", async () => {
      await escrow.connect(buyer).dispute();
      await escrow.connect(relay).assignArbitrator(arbitrator.address);

      const expectedFine = 2_000_000n; // 10% of 20 USDT
      const escrowFunded = TWENTY_USDT + 500_000n;
      const arbBefore = await usdt.balanceOf(arbitrator.address);
      const sellerBefore = await usdt.balanceOf(seller.address);

      await escrow.connect(arbitrator).resolve(0, 100);

      // Arbitrator got fine from escrow (no reserve needed)
      expect(await usdt.balanceOf(arbitrator.address)).to.equal(arbBefore + expectedFine);
      // Seller gets remaining
      expect(await usdt.balanceOf(seller.address)).to.equal(sellerBefore + (escrowFunded - expectedFine));
    });

    it("resolve with invalid shares reverts", async () => {
      await escrow.connect(buyer).dispute();
      await escrow.connect(relay).assignArbitrator(arbitrator.address);
      await expect(escrow.connect(arbitrator).resolve(60, 30)).to.be.revertedWithCustomError(
        escrow,
        "InvalidShares",
      );
    });

    it("resolve from non-assigned arbitrator reverts", async () => {
      await escrow.connect(buyer).dispute();
      await escrow.connect(relay).assignArbitrator(arbitrator.address);
      await expect(escrow.connect(stranger).resolve(50, 50)).to.be.revertedWithCustomError(
        escrow,
        "NotAssignedArbitrator",
      );
    });
  });
});
