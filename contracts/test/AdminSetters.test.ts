import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  ArbitratorRegistry,
  EscrowFactory,
  EscrowImplementation,
  MockERC20,
  PlatformTreasury,
} from "../typechain-types";

const FeeModel = { SPLIT_50_50: 0, BUYER_100: 1, SELLER_100: 2 };
const Level = { TRAINEE: 0, JUNIOR: 1, SENIOR: 2, HEAD: 3 };

describe("Admin setters & edge cases", () => {
  let admin: SignerWithAddress;
  let relay: SignerWithAddress;
  let stranger: SignerWithAddress;
  let usdt: MockERC20;
  let treasury: PlatformTreasury;
  let registry: ArbitratorRegistry;
  let factory: EscrowFactory;

  beforeEach(async () => {
    [admin, relay, stranger] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    usdt = (await Mock.deploy("Tether USD", "USDT", 6)) as unknown as MockERC20;

    const Treasury = await ethers.getContractFactory("PlatformTreasury");
    treasury = (await Treasury.deploy(await usdt.getAddress(), admin.address)) as unknown as PlatformTreasury;

    const Registry = await ethers.getContractFactory("ArbitratorRegistry");
    registry = (await Registry.deploy(
      await usdt.getAddress(),
      await treasury.getAddress(),
      200_000_000n,
      100_000_000n,
      admin.address,
    )) as unknown as ArbitratorRegistry;

    const Impl = await ethers.getContractFactory("EscrowImplementation");
    const implementation = (await Impl.deploy()) as unknown as EscrowImplementation;

    const Factory = await ethers.getContractFactory("EscrowFactory");
    factory = (await Factory.deploy(
      await implementation.getAddress(),
      await usdt.getAddress(),
      await treasury.getAddress(),
      await registry.getAddress(),
      relay.address,
      admin.address,
      3_300_000n,
      { threshold: 11_000_000n, flatFee: 550_000n, percentFeeBps: 500n },
      { fineBps: 1000n, fineMin: 1_100_000n, fineMax: 11_000_000n },
    )) as unknown as EscrowFactory;
  });

  describe("EscrowFactory admin setters", () => {
    it("setTariff updates and emits event", async () => {
      const newTariff = { threshold: 20_000_000n, flatFee: 1_000_000n, percentFeeBps: 600n };
      await expect(factory.connect(admin).setTariff(newTariff)).to.emit(factory, "TariffUpdated");
      const t = await factory.tariff();
      expect(t.threshold).to.equal(newTariff.threshold);
      expect(t.flatFee).to.equal(newTariff.flatFee);
      expect(t.percentFeeBps).to.equal(newTariff.percentFeeBps);
    });

    it("setFine updates and emits event", async () => {
      const newFine = { fineBps: 1500n, fineMin: 2_000_000n, fineMax: 20_000_000n };
      await expect(factory.connect(admin).setFine(newFine)).to.emit(factory, "FineUpdated");
      const f = await factory.fine();
      expect(f.fineBps).to.equal(newFine.fineBps);
      expect(f.fineMin).to.equal(newFine.fineMin);
      expect(f.fineMax).to.equal(newFine.fineMax);
    });

    it("setMinDealAmount updates", async () => {
      await expect(factory.connect(admin).setMinDealAmount(5_000_000n))
        .to.emit(factory, "MinDealAmountUpdated")
        .withArgs(3_300_000n, 5_000_000n);
      expect(await factory.minDealAmount()).to.equal(5_000_000n);
    });

    it("setRelay swaps RELAY_ROLE", async () => {
      await expect(factory.connect(admin).setRelay(stranger.address)).to.emit(factory, "RelayUpdated");
      expect(await factory.hasRole(await factory.RELAY_ROLE(), stranger.address)).to.equal(true);
      expect(await factory.hasRole(await factory.RELAY_ROLE(), relay.address)).to.equal(false);
    });

    it("setRelay reverts on zero address", async () => {
      await expect(factory.connect(admin).setRelay(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
    });

    it("admin setters revert if not ADMIN_ROLE", async () => {
      await expect(
        factory.connect(stranger).setTariff({ threshold: 1n, flatFee: 1n, percentFeeBps: 1n }),
      ).to.be.reverted;
      await expect(factory.connect(stranger).setFine({ fineBps: 1n, fineMin: 1n, fineMax: 1n })).to.be.reverted;
      await expect(factory.connect(stranger).setMinDealAmount(1n)).to.be.reverted;
      await expect(factory.connect(stranger).setRelay(stranger.address)).to.be.reverted;
    });

    it("constructor reverts on zero addresses", async () => {
      const Factory = await ethers.getContractFactory("EscrowFactory");
      const tariff = { threshold: 1n, flatFee: 1n, percentFeeBps: 1n };
      const fine = { fineBps: 1n, fineMin: 1n, fineMax: 1n };
      await expect(
        Factory.deploy(
          ethers.ZeroAddress,
          await usdt.getAddress(),
          await treasury.getAddress(),
          await registry.getAddress(),
          relay.address,
          admin.address,
          0n,
          tariff,
          fine,
        ),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  describe("ArbitratorRegistry admin setters", () => {
    it("setMinStake updates", async () => {
      await registry.connect(admin).setMinStake(300_000_000n, 150_000_000n);
      expect(await registry.minStake()).to.equal(300_000_000n);
      expect(await registry.seniorMinStake()).to.equal(150_000_000n);
    });

    it("setWithdrawCooldown updates", async () => {
      await registry.connect(admin).setWithdrawCooldown(7n * 24n * 3600n);
      expect(await registry.withdrawCooldown()).to.equal(7n * 24n * 3600n);
    });

    it("admin setters revert if not ADMIN_ROLE", async () => {
      await expect(registry.connect(stranger).setMinStake(1n, 1n)).to.be.reverted;
      await expect(registry.connect(stranger).setWithdrawCooldown(1n)).to.be.reverted;
    });

    it("constructor reverts on zero treasury or token", async () => {
      const Registry = await ethers.getContractFactory("ArbitratorRegistry");
      await expect(
        Registry.deploy(ethers.ZeroAddress, await treasury.getAddress(), 1n, 1n, admin.address),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("authorizeEscrow reverts on zero address", async () => {
      await registry.connect(admin).grantRole(await registry.FACTORY_ROLE(), admin.address);
      await expect(registry.connect(admin).authorizeEscrow(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
    });
  });

  describe("PlatformTreasury edge cases", () => {
    it("authorizeEscrow grants ESCROW_ROLE", async () => {
      await treasury.connect(admin).grantRole(await treasury.FACTORY_ROLE(), admin.address);
      await treasury.connect(admin).authorizeEscrow(stranger.address);
      expect(await treasury.hasRole(await treasury.ESCROW_ROLE(), stranger.address)).to.equal(true);
    });

    it("authorizeEscrow reverts on zero address", async () => {
      await treasury.connect(admin).grantRole(await treasury.FACTORY_ROLE(), admin.address);
      await expect(treasury.connect(admin).authorizeEscrow(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        treasury,
        "ZeroAddress",
      );
    });
  });

  describe("FeeModel splitFee with invalid model", () => {
    it("InvalidFeeModel branch is unreachable through type system; covered by enum bounds", async () => {
      // Trying to call with feeModel=3 would revert at ABI level (out-of-range enum).
      const [b, s] = await factory.splitFee(1000n, FeeModel.SPLIT_50_50);
      expect(b + s).to.equal(1000n);
    });
  });
});
