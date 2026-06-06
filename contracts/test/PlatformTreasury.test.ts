import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MockERC20, PlatformTreasury } from "../typechain-types";

describe("PlatformTreasury", () => {
  let admin: SignerWithAddress;
  let escrow: SignerWithAddress;
  let registry: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let user: SignerWithAddress;
  let stranger: SignerWithAddress;
  let usdt: MockERC20;
  let treasury: PlatformTreasury;

  const REASON = ethers.encodeBytes32String("test-reason");

  beforeEach(async () => {
    [admin, escrow, registry, arbitrator, user, stranger] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    usdt = (await Mock.deploy("Tether USD", "USDT", 6)) as unknown as MockERC20;

    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    treasury = (await Treasury.deploy(await usdt.getAddress(), admin.address)) as unknown as PlatformTreasury;

    const ESCROW_ROLE = await treasury.ESCROW_ROLE();
    const REGISTRY_ROLE = await treasury.REGISTRY_ROLE();
    await treasury.connect(admin).grantRole(ESCROW_ROLE, escrow.address);
    await treasury.connect(admin).grantRole(REGISTRY_ROLE, registry.address);
  });

  describe("deployment", () => {
    it("sets token, default reserve bps to 20%", async () => {
      expect(await treasury.token()).to.equal(await usdt.getAddress());
      expect(await treasury.reserveBps()).to.equal(2000);
      expect(await treasury.mainBalance()).to.equal(0);
      expect(await treasury.reserveBalance()).to.equal(0);
    });

    it("reverts on zero token or admin", async () => {
      const Treasury = await ethers.getContractFactory("PlatformTreasury");
      await expect(Treasury.deploy(ethers.ZeroAddress, admin.address)).to.be.revertedWithCustomError(treasury, "ZeroAddress");
      await expect(Treasury.deploy(await usdt.getAddress(), ethers.ZeroAddress)).to.be.revertedWithCustomError(
        treasury,
        "ZeroAddress",
      );
    });
  });

  describe("depositFee", () => {
    it("splits 80/20 between main and reserve", async () => {
      await usdt.mint(escrow.address, 1000);
      await usdt.connect(escrow).transfer(await treasury.getAddress(), 1000);
      await treasury.connect(escrow).depositFee(1000);

      expect(await treasury.mainBalance()).to.equal(800);
      expect(await treasury.reserveBalance()).to.equal(200);
    });

    it("respects updated reserveBps", async () => {
      await treasury.connect(admin).setReserveBps(3000);
      await usdt.mint(escrow.address, 1000);
      await usdt.connect(escrow).transfer(await treasury.getAddress(), 1000);
      await treasury.connect(escrow).depositFee(1000);

      expect(await treasury.mainBalance()).to.equal(700);
      expect(await treasury.reserveBalance()).to.equal(300);
    });

    it("reverts if not ESCROW_ROLE", async () => {
      await expect(treasury.connect(stranger).depositFee(100)).to.be.reverted;
    });

    it("reverts on zero amount", async () => {
      await expect(treasury.connect(escrow).depositFee(0)).to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });
  });

  describe("payArbitratorFromReserve", () => {
    beforeEach(async () => {
      // Заполняем reserve через depositFee
      await usdt.mint(escrow.address, 5000);
      await usdt.connect(escrow).transfer(await treasury.getAddress(), 5000);
      await treasury.connect(escrow).depositFee(5000);
      // reserve = 1000, main = 4000
    });

    it("transfers to arbitrator and decreases reserveBalance", async () => {
      const disputeId = ethers.encodeBytes32String("dispute-1");
      const before = await usdt.balanceOf(arbitrator.address);
      await treasury.connect(escrow).payArbitratorFromReserve(arbitrator.address, 300, disputeId);
      expect(await usdt.balanceOf(arbitrator.address)).to.equal(before + 300n);
      expect(await treasury.reserveBalance()).to.equal(700);
    });

    it("reverts if reserve insufficient", async () => {
      const disputeId = ethers.encodeBytes32String("dispute-1");
      await expect(
        treasury.connect(escrow).payArbitratorFromReserve(arbitrator.address, 2000, disputeId),
      ).to.be.revertedWithCustomError(treasury, "InsufficientReserveBalance");
    });

    it("reverts if not ESCROW_ROLE", async () => {
      const disputeId = ethers.encodeBytes32String("dispute-1");
      await expect(treasury.connect(stranger).payArbitratorFromReserve(arbitrator.address, 100, disputeId)).to.be.reverted;
    });
  });

  describe("depositSlashedStake", () => {
    it("increases reserveBalance", async () => {
      // Send tokens to treasury first
      await usdt.mint(registry.address, 500);
      await usdt.connect(registry).transfer(await treasury.getAddress(), 500);
      await treasury.connect(registry).depositSlashedStake(500);
      expect(await treasury.reserveBalance()).to.equal(500);
    });

    it("reverts if not REGISTRY_ROLE", async () => {
      await expect(treasury.connect(stranger).depositSlashedStake(100)).to.be.reverted;
    });
  });

  describe("compensateUser", () => {
    beforeEach(async () => {
      await usdt.mint(escrow.address, 5000);
      await usdt.connect(escrow).transfer(await treasury.getAddress(), 5000);
      await treasury.connect(escrow).depositFee(5000); // reserve = 1000
    });

    it("transfers to user and decreases reserveBalance", async () => {
      await treasury.connect(admin).compensateUser(user.address, 400, REASON);
      expect(await usdt.balanceOf(user.address)).to.equal(400);
      expect(await treasury.reserveBalance()).to.equal(600);
    });

    it("reverts if not ADMIN_ROLE", async () => {
      await expect(treasury.connect(stranger).compensateUser(user.address, 100, REASON)).to.be.reverted;
    });

    it("reverts on zero address", async () => {
      await expect(treasury.connect(admin).compensateUser(ethers.ZeroAddress, 100, REASON)).to.be.revertedWithCustomError(
        treasury,
        "ZeroAddress",
      );
    });
  });

  describe("withdraw", () => {
    beforeEach(async () => {
      await usdt.mint(escrow.address, 5000);
      await usdt.connect(escrow).transfer(await treasury.getAddress(), 5000);
      await treasury.connect(escrow).depositFee(5000); // main = 4000
    });

    it("withdraws from main and decreases mainBalance", async () => {
      await treasury.connect(admin).withdraw(user.address, 1500);
      expect(await usdt.balanceOf(user.address)).to.equal(1500);
      expect(await treasury.mainBalance()).to.equal(2500);
    });

    it("reverts if amount exceeds main", async () => {
      await expect(treasury.connect(admin).withdraw(user.address, 5000)).to.be.revertedWithCustomError(
        treasury,
        "InsufficientMainBalance",
      );
    });

    it("reverts if not ADMIN_ROLE", async () => {
      await expect(treasury.connect(stranger).withdraw(user.address, 100)).to.be.reverted;
    });
  });

  describe("setReserveBps", () => {
    it("updates and emits event", async () => {
      await expect(treasury.connect(admin).setReserveBps(2500))
        .to.emit(treasury, "ReserveBpsUpdated")
        .withArgs(2000, 2500);
      expect(await treasury.reserveBps()).to.equal(2500);
    });

    it("reverts if too high", async () => {
      await expect(treasury.connect(admin).setReserveBps(6000)).to.be.revertedWithCustomError(
        treasury,
        "ReserveBpsTooHigh",
      );
    });

    it("reverts if not ADMIN_ROLE", async () => {
      await expect(treasury.connect(stranger).setReserveBps(2500)).to.be.reverted;
    });
  });

  describe("reconcile", () => {
    it("captures unaccounted tokens into mainBalance", async () => {
      await usdt.mint(stranger.address, 700);
      await usdt.connect(stranger).transfer(await treasury.getAddress(), 700);
      // Не вызываем depositFee — токены «осиротели»
      expect(await treasury.mainBalance()).to.equal(0);
      expect(await treasury.reserveBalance()).to.equal(0);

      await treasury.connect(admin).reconcile();
      expect(await treasury.mainBalance()).to.equal(700);
    });
  });
});
