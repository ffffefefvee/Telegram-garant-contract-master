import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Phase 5 Polygon lifecycle hardening", () => {
  const AMOUNT = 20_000_000n;
  const BUYER_FEE = 500_000n;

  async function deployFixture() {
    const [deployer, admin, relay, pauser, recovery, buyer, seller, arbitrator, stranger] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("USD Tether", "USDT", 6);
    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    const treasury = await Treasury.deploy(await token.getAddress(), admin.address);
    const Registry = await ethers.getContractFactory("ArbitratorRegistry");
    const registry = await Registry.deploy(
      await token.getAddress(),
      await treasury.getAddress(),
      100_000_000n,
      50_000_000n,
      admin.address,
    );
    const Impl = await ethers.getContractFactory("EscrowImplementation");
    const implementation = await Impl.deploy();
    const Factory = await ethers.getContractFactory("EscrowFactory");
    const factory = await Factory.deploy(
      await implementation.getAddress(),
      await token.getAddress(),
      await treasury.getAddress(),
      await registry.getAddress(),
      relay.address,
      admin.address,
      pauser.address,
      recovery.address,
      1_000_000n,
      { threshold: 100_000_000n, flatFee: 1_000_000n, percentFeeBps: 500n },
      { fineBps: 1000n, fineMin: 1_000_000n, fineMax: 10_000_000n },
    );

    await treasury.connect(admin).grantRole(await treasury.FACTORY_ROLE(), await factory.getAddress());
    await registry.connect(admin).grantRole(await registry.FACTORY_ROLE(), await factory.getAddress());
    await treasury.connect(admin).grantRole(await treasury.REGISTRY_ROLE(), await registry.getAddress());

    async function createEscrow(sequence: number) {
      const dealId = ethers.keccak256(ethers.toUtf8Bytes(`phase5-${sequence}`));
      const deadline = (await time.latest()) + 3600;
      await factory
        .connect(relay)
        .createEscrow(dealId, buyer.address, seller.address, AMOUNT, 0, deadline);
      const address = await factory.escrowOf(dealId);
      const escrow = await ethers.getContractAt("EscrowImplementation", address);
      return { dealId, escrow };
    }

    async function fundEscrow(escrow: any) {
      await token.mint(await escrow.getAddress(), AMOUNT + BUYER_FEE);
      await escrow.connect(relay).notifyFunded();
    }

    return {
      deployer,
      admin,
      relay,
      pauser,
      recovery,
      buyer,
      seller,
      arbitrator,
      stranger,
      token,
      treasury,
      registry,
      implementation,
      factory,
      createEscrow,
      fundEscrow,
    };
  }

  it("pins a deployed six-decimal token in the immutable factory", async () => {
    const { token, factory } = await deployFixture();
    expect(await factory.token()).to.equal(await token.getAddress());

    const [deployer, admin, relay, pauser, recovery] = await ethers.getSigners();
    const Impl = await ethers.getContractFactory("EscrowImplementation");
    const implementation = await Impl.deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const wrongDecimals = await Token.deploy("Wrong", "WRONG", 18);
    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    const treasury = await Treasury.deploy(await wrongDecimals.getAddress(), admin.address);
    const Registry = await ethers.getContractFactory("ArbitratorRegistry");
    const registry = await Registry.deploy(
      await wrongDecimals.getAddress(),
      await treasury.getAddress(),
      1n,
      1n,
      admin.address,
    );
    const Factory = await ethers.getContractFactory("EscrowFactory");
    const args = [
      await implementation.getAddress(),
      await wrongDecimals.getAddress(),
      await treasury.getAddress(),
      await registry.getAddress(),
      relay.address,
      admin.address,
      pauser.address,
      recovery.address,
      1n,
      { threshold: 1n, flatFee: 0n, percentFeeBps: 0n },
      { fineBps: 0n, fineMin: 0n, fineMax: 0n },
    ] as const;
    await expect(Factory.connect(deployer).deploy(...args)).to.be.revertedWithCustomError(
      Factory,
      "InvalidTokenDecimals",
    );
  });

  it("rejects an EOA masquerading as the allowlisted token", async () => {
    const { deployer, admin, relay, pauser, recovery, treasury, registry, implementation } =
      await deployFixture();
    const Factory = await ethers.getContractFactory("EscrowFactory");
    await expect(
      Factory.connect(deployer).deploy(
        await implementation.getAddress(),
        relay.address,
        await treasury.getAddress(),
        await registry.getAddress(),
        relay.address,
        admin.address,
        pauser.address,
        recovery.address,
        1n,
        { threshold: 1n, flatFee: 0n, percentFeeBps: 0n },
        { fineBps: 0n, fineMin: 0n, fineMax: 0n },
      ),
    ).to.be.revertedWithCustomError(Factory, "InvalidTokenContract");
  });

  it("rejects non-contract and inconsistently wired immutable dependencies", async () => {
    const {
      deployer,
      admin,
      relay,
      pauser,
      recovery,
      token,
      treasury,
      registry,
      implementation,
    } = await deployFixture();
    const Factory = await ethers.getContractFactory("EscrowFactory");
    const common = [
      await token.getAddress(),
      await treasury.getAddress(),
      await registry.getAddress(),
      relay.address,
      admin.address,
      pauser.address,
      recovery.address,
      1n,
      { threshold: 1n, flatFee: 0n, percentFeeBps: 0n },
      { fineBps: 0n, fineMin: 0n, fineMax: 0n },
    ] as const;
    await expect(
      Factory.connect(deployer).deploy(deployer.address, ...common),
    ).to.be.revertedWithCustomError(Factory, "InvalidDependencyContract");

    const Token = await ethers.getContractFactory("MockERC20");
    const otherToken = await Token.deploy("Other USD", "OUSD", 6);
    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    const otherTreasury = await Treasury.deploy(await otherToken.getAddress(), admin.address);
    await expect(
      Factory.connect(deployer).deploy(
        await implementation.getAddress(),
        await token.getAddress(),
        await otherTreasury.getAddress(),
        await registry.getAddress(),
        relay.address,
        admin.address,
        pauser.address,
        recovery.address,
        1n,
        { threshold: 1n, flatFee: 0n, percentFeeBps: 0n },
        { fineBps: 0n, fineMin: 0n, fineMax: 0n },
      ),
    ).to.be.revertedWithCustomError(Factory, "DependencyTokenMismatch");
  });

  it("separates pause, recovery, relay and governance authority", async () => {
    const { admin, relay, pauser, recovery, factory } = await deployFixture();
    expect(await factory.hasRole(await factory.PAUSER_ROLE(), pauser.address)).to.equal(true);
    expect(await factory.hasRole(await factory.RECOVERY_ROLE(), recovery.address)).to.equal(true);
    expect(await factory.hasRole(await factory.ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await factory.hasRole(await factory.RELAY_ROLE(), relay.address)).to.equal(true);
    expect(await factory.hasRole(await factory.ADMIN_ROLE(), pauser.address)).to.equal(false);
    expect(await factory.hasRole(await factory.RECOVERY_ROLE(), admin.address)).to.equal(false);
  });

  it("lets operations stop immediately but only governance resume", async () => {
    const { admin, pauser, stranger, factory } = await deployFixture();
    await expect(factory.connect(stranger).pauseSettlement()).to.be.reverted;
    await expect(factory.connect(pauser).pauseSettlement())
      .to.emit(factory, "SettlementPaused")
      .withArgs(pauser.address);
    await expect(factory.connect(pauser).unpauseSettlement()).to.be.reverted;
    await expect(factory.connect(admin).unpauseSettlement())
      .to.emit(factory, "SettlementUnpaused")
      .withArgs(admin.address);
  });

  it("blocks new exposure, funding recognition and normal egress while paused", async () => {
    const { relay, pauser, buyer, seller, token, factory, createEscrow, fundEscrow } =
      await deployFixture();
    const first = await createEscrow(1);
    await fundEscrow(first.escrow);
    const second = await createEscrow(2);
    await token.mint(await second.escrow.getAddress(), AMOUNT + BUYER_FEE);
    await factory.connect(pauser).pauseSettlement();

    await expect(
      factory
        .connect(relay)
        .createEscrow(
          ethers.keccak256(ethers.toUtf8Bytes("phase5-blocked")),
          buyer.address,
          seller.address,
          AMOUNT,
          0,
          (await time.latest()) + 3600,
        ),
    ).to.be.revertedWithCustomError(factory, "SettlementIsPaused");
    await expect(second.escrow.connect(relay).notifyFunded()).to.be.revertedWithCustomError(
      second.escrow,
      "SettlementIsPaused",
    );
    await expect(first.escrow.connect(buyer).release()).to.be.revertedWithCustomError(
      first.escrow,
      "SettlementIsPaused",
    );
    await expect(first.escrow.connect(seller).refund()).to.be.revertedWithCustomError(
      first.escrow,
      "SettlementIsPaused",
    );
  });

  it("keeps pre-funding cancellation and deterministic rescue available", async () => {
    const { pauser, buyer, token, factory, createEscrow } = await deployFixture();
    const { escrow } = await createEscrow(3);
    await token.mint(await escrow.getAddress(), 7_000_000n);
    await factory.connect(pauser).pauseSettlement();
    await escrow.connect(buyer).cancel();
    await escrow.connect(buyer).rescue();
    expect(await token.balanceOf(buyer.address)).to.equal(7_000_000n);
  });

  it("permits only the recovery role to return all funded value while paused", async () => {
    const { pauser, recovery, stranger, buyer, token, factory, createEscrow, fundEscrow } =
      await deployFixture();
    const { dealId, escrow } = await createEscrow(4);
    await fundEscrow(escrow);

    await expect(factory.connect(recovery).emergencyRefund(dealId)).to.be.revertedWithCustomError(
      factory,
      "SettlementIsNotPaused",
    );
    await factory.connect(pauser).pauseSettlement();
    await expect(factory.connect(stranger).emergencyRefund(dealId)).to.be.reverted;
    await expect(factory.connect(recovery).emergencyRefund(dealId))
      .to.emit(escrow, "EmergencyRefunded")
      .withArgs(buyer.address, AMOUNT + BUYER_FEE);
    expect(await token.balanceOf(buyer.address)).to.equal(AMOUNT + BUYER_FEE);
    expect(await escrow.status()).to.equal(4n);
    expect(await escrow.getBalance()).to.equal(0n);
  });

  it("closes an assigned dispute before emergency recovery", async () => {
    const {
      admin,
      relay,
      pauser,
      recovery,
      buyer,
      arbitrator,
      token,
      registry,
      factory,
      createEscrow,
      fundEscrow,
    } = await deployFixture();
    await registry.connect(admin).hire(arbitrator.address, 0);
    await token.mint(arbitrator.address, 100_000_000n);
    await token.connect(arbitrator).approve(await registry.getAddress(), 100_000_000n);
    await registry.connect(arbitrator).depositStake(100_000_000n);
    const { dealId, escrow } = await createEscrow(5);
    await fundEscrow(escrow);
    await escrow.connect(buyer).dispute();
    await escrow.connect(relay).assignArbitrator(arbitrator.address);
    expect((await registry.getArbitrator(arbitrator.address)).activeDisputes).to.equal(1n);

    await factory.connect(pauser).pauseSettlement();
    await factory.connect(recovery).emergencyRefund(dealId);
    expect((await registry.getArbitrator(arbitrator.address)).activeDisputes).to.equal(0n);
  });
});
