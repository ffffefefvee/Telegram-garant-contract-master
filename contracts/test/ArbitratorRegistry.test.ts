import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ArbitratorRegistry, MockERC20, PlatformTreasury } from "../typechain-types";

describe("ArbitratorRegistry", () => {
  let admin: SignerWithAddress;
  let escrow: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let other: SignerWithAddress;
  let victim: SignerWithAddress;
  let stranger: SignerWithAddress;
  let usdt: MockERC20;
  let treasury: PlatformTreasury;
  let registry: ArbitratorRegistry;

  const MIN_STAKE = 200_000_000n; // 200 USDT (6 decimals)
  const SENIOR_MIN_STAKE = 100_000_000n;
  const REASON = ethers.encodeBytes32String("misconduct");

  // Level enum values
  const Level = { TRAINEE: 0, JUNIOR: 1, SENIOR: 2, HEAD: 3 };
  // Status enum values
  const Status = { NONE: 0, ACTIVE: 1, PROBATION: 2, SUSPENDED: 3, TERMINATED: 4 };

  beforeEach(async () => {
    [admin, escrow, arbitrator, other, victim, stranger] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    usdt = (await Mock.deploy("Tether USD", "USDT", 6)) as unknown as MockERC20;

    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    treasury = (await Treasury.deploy(await usdt.getAddress(), admin.address)) as unknown as PlatformTreasury;

    const Registry = await ethers.getContractFactory("ArbitratorRegistry");
    registry = (await Registry.deploy(
      await usdt.getAddress(),
      await treasury.getAddress(),
      MIN_STAKE,
      SENIOR_MIN_STAKE,
      admin.address,
    )) as unknown as ArbitratorRegistry;

    // grant REGISTRY_ROLE on treasury so registry can deposit slashed stakes
    const REGISTRY_ROLE = await treasury.REGISTRY_ROLE();
    await treasury.connect(admin).grantRole(REGISTRY_ROLE, await registry.getAddress());

    const ESCROW_ROLE = await registry.ESCROW_ROLE();
    await registry.connect(admin).grantRole(ESCROW_ROLE, escrow.address);

    // Pre-fund arbitrator with USDT
    await usdt.mint(arbitrator.address, MIN_STAKE * 5n);
    await usdt.connect(arbitrator).approve(await registry.getAddress(), ethers.MaxUint256);
  });

  describe("deployment", () => {
    it("sets token, treasury, and stake params", async () => {
      expect(await registry.token()).to.equal(await usdt.getAddress());
      expect(await registry.treasury()).to.equal(await treasury.getAddress());
      expect(await registry.minStake()).to.equal(MIN_STAKE);
      expect(await registry.seniorMinStake()).to.equal(SENIOR_MIN_STAKE);
      expect(await registry.withdrawCooldown()).to.equal(14n * 24n * 3600n);
      expect(await registry.arbitratorCount()).to.equal(0);
    });
  });

  describe("hire", () => {
    it("adds arbitrator with ACTIVE status", async () => {
      await expect(registry.connect(admin).hire(arbitrator.address, Level.JUNIOR))
        .to.emit(registry, "ArbitratorHired")
        .withArgs(arbitrator.address, Level.JUNIOR);

      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.status).to.equal(Status.ACTIVE);
      expect(a.level).to.equal(Level.JUNIOR);
      expect(a.stake).to.equal(0);
      expect(await registry.arbitratorCount()).to.equal(1);
    });

    it("reverts on second hire of same address", async () => {
      await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
      await expect(registry.connect(admin).hire(arbitrator.address, Level.JUNIOR)).to.be.revertedWithCustomError(
        registry,
        "AlreadyHired",
      );
    });

    it("reverts on zero address", async () => {
      await expect(registry.connect(admin).hire(ethers.ZeroAddress, Level.JUNIOR)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
    });

    it("reverts if not ADMIN_ROLE", async () => {
      await expect(registry.connect(stranger).hire(arbitrator.address, Level.JUNIOR)).to.be.reverted;
    });
  });

  describe("depositStake", () => {
    beforeEach(async () => {
      await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
    });

    it("transfers tokens and updates stake", async () => {
      await expect(registry.connect(arbitrator).depositStake(MIN_STAKE))
        .to.emit(registry, "StakeDeposited")
        .withArgs(arbitrator.address, MIN_STAKE, MIN_STAKE);
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.stake).to.equal(MIN_STAKE);
      expect(await usdt.balanceOf(await registry.getAddress())).to.equal(MIN_STAKE);
    });

    it("reverts if not hired", async () => {
      await usdt.mint(other.address, MIN_STAKE);
      await usdt.connect(other).approve(await registry.getAddress(), ethers.MaxUint256);
      await expect(registry.connect(other).depositStake(MIN_STAKE)).to.be.revertedWithCustomError(registry, "NotHired");
    });

    it("reverts on zero amount", async () => {
      await expect(registry.connect(arbitrator).depositStake(0)).to.be.revertedWithCustomError(registry, "ZeroAmount");
    });
  });

  describe("isEligible", () => {
    beforeEach(async () => {
      await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
    });

    it("false before stake deposited", async () => {
      expect(await registry.isEligible(arbitrator.address)).to.equal(false);
    });

    it("true with full minStake and ACTIVE status", async () => {
      await registry.connect(arbitrator).depositStake(MIN_STAKE);
      expect(await registry.isEligible(arbitrator.address)).to.equal(true);
    });

    it("false when SUSPENDED", async () => {
      await registry.connect(arbitrator).depositStake(MIN_STAKE);
      await registry.connect(admin).setStatus(arbitrator.address, Status.SUSPENDED);
      expect(await registry.isEligible(arbitrator.address)).to.equal(false);
    });

    it("uses seniorMinStake when level=SENIOR", async () => {
      await registry.connect(arbitrator).depositStake(SENIOR_MIN_STAKE);
      // With JUNIOR level and 100 USDT, not eligible
      expect(await registry.isEligible(arbitrator.address)).to.equal(false);
      await registry.connect(admin).setLevel(arbitrator.address, Level.SENIOR);
      expect(await registry.isEligible(arbitrator.address)).to.equal(true);
    });
  });

  describe("requestWithdraw + withdraw", () => {
    beforeEach(async () => {
      await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
      await registry.connect(arbitrator).depositStake(MIN_STAKE * 2n);
    });

    it("two-step withdraw with cooldown", async () => {
      await expect(registry.connect(arbitrator).requestWithdraw(MIN_STAKE)).to.emit(registry, "WithdrawRequested");
      await expect(registry.connect(arbitrator).withdraw()).to.be.revertedWithCustomError(
        registry,
        "WithdrawCooldownActive",
      );
      await time.increase(14 * 24 * 3600 + 1);
      const before = await usdt.balanceOf(arbitrator.address);
      await registry.connect(arbitrator).withdraw();
      expect(await usdt.balanceOf(arbitrator.address)).to.equal(before + MIN_STAKE);
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.stake).to.equal(MIN_STAKE);
    });

    it("blocks withdraw that would breach minStake (non-terminated)", async () => {
      // Have MIN_STAKE * 2, try to withdraw MIN_STAKE + 1 → leaves MIN_STAKE - 1, below min
      await expect(registry.connect(arbitrator).requestWithdraw(MIN_STAKE + 1n)).to.be.revertedWithCustomError(
        registry,
        "WithdrawWouldBreachMin",
      );
    });

    it("allows full withdraw when TERMINATED", async () => {
      await registry.connect(admin).setStatus(arbitrator.address, Status.TERMINATED);
      // Note: TERMINATED still blocks isEligible-but allows withdraw of full stake
      await registry.connect(arbitrator).requestWithdraw(MIN_STAKE * 2n);
      await time.increase(14 * 24 * 3600 + 1);
      await registry.connect(arbitrator).withdraw();
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.stake).to.equal(0);
    });

    it("reverts withdraw if no request", async () => {
      await expect(registry.connect(arbitrator).withdraw()).to.be.revertedWithCustomError(registry, "WithdrawNotRequested");
    });

    it("blocks request when SUSPENDED", async () => {
      await registry.connect(admin).setStatus(arbitrator.address, Status.SUSPENDED);
      await expect(registry.connect(arbitrator).requestWithdraw(100)).to.be.revertedWithCustomError(
        registry,
        "NotEligibleForWithdraw",
      );
    });

    it("can cancel withdraw request", async () => {
      await registry.connect(arbitrator).requestWithdraw(MIN_STAKE);
      await registry.connect(arbitrator).cancelWithdrawRequest();
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.withdrawRequestAt).to.equal(0);
      // Can now request again
      await registry.connect(arbitrator).requestWithdraw(MIN_STAKE);
    });
  });

  describe("slash", () => {
    beforeEach(async () => {
      await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
      await registry.connect(arbitrator).depositStake(MIN_STAKE);
    });

    it("slashes to victim address", async () => {
      const slashAmount = MIN_STAKE / 4n;
      const before = await usdt.balanceOf(victim.address);
      await expect(registry.connect(admin).slash(arbitrator.address, slashAmount, REASON, victim.address))
        .to.emit(registry, "StakeSlashed")
        .withArgs(arbitrator.address, slashAmount, REASON, victim.address);
      expect(await usdt.balanceOf(victim.address)).to.equal(before + slashAmount);
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.stake).to.equal(MIN_STAKE - slashAmount);
      expect(a.totalSlashed).to.equal(slashAmount);
    });

    it("slashes to Treasury Reserve when beneficiary=0", async () => {
      const slashAmount = MIN_STAKE / 4n;
      const reserveBefore = await treasury.reserveBalance();
      await registry.connect(admin).slash(arbitrator.address, slashAmount, REASON, ethers.ZeroAddress);
      expect(await treasury.reserveBalance()).to.equal(reserveBefore + slashAmount);
    });

    it("caps slash at current stake (no underflow)", async () => {
      await registry.connect(admin).slash(arbitrator.address, MIN_STAKE * 10n, REASON, victim.address);
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.stake).to.equal(0);
      expect(a.totalSlashed).to.equal(MIN_STAKE);
      expect(await usdt.balanceOf(victim.address)).to.equal(MIN_STAKE);
    });

    it("reverts if not ADMIN_ROLE", async () => {
      await expect(registry.connect(stranger).slash(arbitrator.address, 100, REASON, victim.address)).to.be.reverted;
    });

    it("reverts on not hired", async () => {
      await expect(
        registry.connect(admin).slash(other.address, 100, REASON, victim.address),
      ).to.be.revertedWithCustomError(registry, "NotHired");
    });
  });

  describe("incrementResolved", () => {
    beforeEach(async () => {
      await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
    });

    it("increments counter via ESCROW_ROLE", async () => {
      await registry.connect(escrow).incrementResolved(arbitrator.address);
      const a = await registry.getArbitrator(arbitrator.address);
      expect(a.totalResolved).to.equal(1);
    });

    it("reverts if not ESCROW_ROLE", async () => {
      await expect(registry.connect(stranger).incrementResolved(arbitrator.address)).to.be.reverted;
    });
  });

  describe("status & level admin", () => {
    beforeEach(async () => {
      await registry.connect(admin).hire(arbitrator.address, Level.JUNIOR);
    });

    it("sets status with event", async () => {
      await expect(registry.connect(admin).setStatus(arbitrator.address, Status.PROBATION))
        .to.emit(registry, "StatusChanged")
        .withArgs(arbitrator.address, Status.ACTIVE, Status.PROBATION);
    });

    it("sets level with event", async () => {
      await expect(registry.connect(admin).setLevel(arbitrator.address, Level.SENIOR))
        .to.emit(registry, "LevelChanged")
        .withArgs(arbitrator.address, Level.JUNIOR, Level.SENIOR);
    });
  });
});
