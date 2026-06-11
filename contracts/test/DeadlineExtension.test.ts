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

const Status = {
  AWAITING_FUNDING: 1n,
  FUNDED: 2n,
  CANCELLED: 7n,
  EXPIRED: 8n,
};

describe("extendFundingDeadline", () => {
  let admin: SignerWithAddress;
  let relay: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let stranger: SignerWithAddress;

  let usdt: MockERC20;
  let treasury: PlatformTreasury;
  let registry: ArbitratorRegistry;
  let implementation: EscrowImplementation;
  let factory: EscrowFactory;

  const dealIdFor = (n: number) =>
    ethers.keccak256(ethers.toUtf8Bytes(`deadline-deal-${n}`));

  async function createEscrow(
    dealId: string,
    deadlineOffset = 3600,
  ): Promise<{ escrow: EscrowImplementation; deadline: number }> {
    const deadline = (await time.latest()) + deadlineOffset;
    await factory
      .connect(relay)
      .createEscrow(
        dealId,
        buyer.address,
        seller.address,
        TWENTY_USDT,
        FeeModel.SPLIT_50_50,
        deadline,
      );
    const escrowAddr = await factory.escrowOf(dealId);
    const escrow = (await ethers.getContractAt(
      "EscrowImplementation",
      escrowAddr,
    )) as unknown as EscrowImplementation;
    return { escrow, deadline };
  }

  /** Total the buyer must deposit: amount + buyerFee. */
  async function requiredFunding(escrow: EscrowImplementation): Promise<bigint> {
    return (await escrow.amount()) + (await escrow.buyerFee());
  }

  beforeEach(async () => {
    [admin, relay, buyer, seller, stranger] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    usdt = (await Mock.deploy("Tether USD", "USDT", 6)) as unknown as MockERC20;

    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    treasury = (await Treasury.deploy(
      await usdt.getAddress(),
      admin.address,
    )) as unknown as PlatformTreasury;

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

    await treasury
      .connect(admin)
      .grantRole(await treasury.FACTORY_ROLE(), await factory.getAddress());
    await registry
      .connect(admin)
      .grantRole(await registry.FACTORY_ROLE(), await factory.getAddress());
  });

  it("relay extends the deadline and emits the event", async () => {
    const { escrow, deadline } = await createEscrow(dealIdFor(1));
    const newDeadline = deadline + 24 * 3600;

    await expect(escrow.connect(relay).extendFundingDeadline(newDeadline))
      .to.emit(escrow, "FundingDeadlineExtended")
      .withArgs(deadline, newDeadline);

    expect(await escrow.fundingDeadline()).to.equal(newDeadline);
    expect(await escrow.status()).to.equal(Status.AWAITING_FUNDING);
  });

  it("rescues a late deposit: deadline passed → extend → notifyFunded succeeds", async () => {
    const { escrow, deadline } = await createEscrow(dealIdFor(2), 3600);

    // The funding window closes with no payment confirmed on-chain…
    await time.increaseTo(deadline + 600);

    // …and notifyFunded would now revert even with the money in place.
    const required = await requiredFunding(escrow);
    await usdt.mint(relay.address, required);
    await usdt.connect(relay).transfer(await escrow.getAddress(), required);
    await expect(
      escrow.connect(relay).notifyFunded(),
    ).to.be.revertedWithCustomError(escrow, "FundingDeadlinePassed");

    // Admin extends (escrow is still AWAITING_FUNDING — nobody expired it),
    // and the standard funding path completes.
    const newDeadline = (await time.latest()) + 3600;
    await escrow.connect(relay).extendFundingDeadline(newDeadline);
    await escrow.connect(relay).notifyFunded();
    expect(await escrow.status()).to.equal(Status.FUNDED);
  });

  it("reverts for anyone but the relay", async () => {
    const { escrow, deadline } = await createEscrow(dealIdFor(3));
    for (const signer of [buyer, seller, stranger, admin]) {
      await expect(
        escrow.connect(signer).extendFundingDeadline(deadline + 3600),
      ).to.be.revertedWithCustomError(escrow, "NotRelay");
    }
  });

  it("reverts when the new deadline does not actually extend", async () => {
    const { escrow, deadline } = await createEscrow(dealIdFor(4));

    // Equal to the current deadline.
    await expect(
      escrow.connect(relay).extendFundingDeadline(deadline),
    ).to.be.revertedWithCustomError(escrow, "InvalidNewDeadline");

    // Shorter than the current deadline (cannot cut off a paying buyer).
    await expect(
      escrow.connect(relay).extendFundingDeadline(deadline - 600),
    ).to.be.revertedWithCustomError(escrow, "InvalidNewDeadline");
  });

  it("reverts when the new deadline is already in the past", async () => {
    const { escrow, deadline } = await createEscrow(dealIdFor(5), 3600);
    await time.increaseTo(deadline + 7200);

    // > old deadline but <= now — still not a valid extension.
    await expect(
      escrow.connect(relay).extendFundingDeadline(deadline + 3600),
    ).to.be.revertedWithCustomError(escrow, "InvalidNewDeadline");
  });

  it("reverts once the escrow is EXPIRED (buyer may already rescue)", async () => {
    const { escrow, deadline } = await createEscrow(dealIdFor(6), 3600);
    await time.increaseTo(deadline + 600);
    await escrow.connect(stranger).expire();

    await expect(
      escrow.connect(relay).extendFundingDeadline((await time.latest()) + 3600),
    ).to.be.revertedWithCustomError(escrow, "WrongStatus");
  });

  it("reverts once the escrow is CANCELLED", async () => {
    const { escrow } = await createEscrow(dealIdFor(7));
    await escrow.connect(buyer).cancel();

    await expect(
      escrow.connect(relay).extendFundingDeadline((await time.latest()) + 3600),
    ).to.be.revertedWithCustomError(escrow, "WrongStatus");
  });

  it("reverts once the escrow is FUNDED", async () => {
    const { escrow } = await createEscrow(dealIdFor(8));
    const required = await requiredFunding(escrow);
    await usdt.mint(relay.address, required);
    await usdt.connect(relay).transfer(await escrow.getAddress(), required);
    await escrow.connect(relay).notifyFunded();

    await expect(
      escrow.connect(relay).extendFundingDeadline((await time.latest()) + 3600),
    ).to.be.revertedWithCustomError(escrow, "WrongStatus");
  });
});
