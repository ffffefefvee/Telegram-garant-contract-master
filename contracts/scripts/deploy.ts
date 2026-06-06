import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// USDT addresses on supported networks. For testnets/local — empty → MockERC20 deployed.
const USDT_ADDRESSES: Record<string, string> = {
  polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  bsc: "0x55d398326f99059fF775485246999027B3197955",
};

/// MVP defaults (USDT 6 decimals).
const MIN_DEAL = 3_300_000n; // ~300 ₽
const TARIFF = {
  threshold: 11_000_000n, // ~$11 ≈ 1000 ₽
  flatFee: 550_000n, // ~$0.55 ≈ 50 ₽
  percentFeeBps: 500n, // 5%
};
const FINE = {
  fineBps: 1000n, // 10%
  fineMin: 1_100_000n, // ~$1.10 ≈ 100 ₽
  fineMax: 11_000_000n, // ~$11 ≈ 1000 ₽
};
const ARB_MIN_STAKE = 200_000_000n; // 200 USDT
const ARB_SENIOR_MIN_STAKE = 100_000_000n; // 100 USDT

async function main() {
  const networkName = network.name;
  const [deployer] = await ethers.getSigners();
  console.log(`\nDeploying on ${networkName} from ${deployer.address}`);

  // Resolve relay & admin addresses
  const relay = process.env.RELAY_ADDRESS || deployer.address;
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  console.log(`  relay = ${relay}`);
  console.log(`  admin = ${admin}`);

  // 1. Token (USDT or MockERC20 for local/test)
  let tokenAddress = USDT_ADDRESSES[networkName];
  if (!tokenAddress) {
    console.log("\n[1/5] Deploying MockERC20 (test network)…");
    const Mock = await ethers.getContractFactory("MockERC20");
    const mock = await Mock.deploy("Tether USD", "USDT", 6);
    await mock.waitForDeployment();
    tokenAddress = await mock.getAddress();
    console.log(`        MockERC20 → ${tokenAddress}`);
  } else {
    console.log(`\n[1/5] Using USDT ${tokenAddress}`);
  }

  // 2. PlatformTreasury
  console.log("\n[2/5] Deploying PlatformTreasury…");
  const Treasury = await ethers.getContractFactory("PlatformTreasury");
  const treasury = await Treasury.deploy(tokenAddress, admin);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log(`        PlatformTreasury → ${treasuryAddress}`);

  // 3. ArbitratorRegistry
  console.log("\n[3/5] Deploying ArbitratorRegistry…");
  const Registry = await ethers.getContractFactory("ArbitratorRegistry");
  const registry = await Registry.deploy(
    tokenAddress,
    treasuryAddress,
    ARB_MIN_STAKE,
    ARB_SENIOR_MIN_STAKE,
    admin,
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`        ArbitratorRegistry → ${registryAddress}`);

  // 4. EscrowImplementation (singleton, not used directly — only cloned)
  console.log("\n[4/5] Deploying EscrowImplementation…");
  const Impl = await ethers.getContractFactory("EscrowImplementation");
  const implementation = await Impl.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  console.log(`        EscrowImplementation → ${implementationAddress}`);

  // 5. EscrowFactory
  console.log("\n[5/5] Deploying EscrowFactory…");
  const Factory = await ethers.getContractFactory("EscrowFactory");
  const factory = await Factory.deploy(
    implementationAddress,
    tokenAddress,
    treasuryAddress,
    registryAddress,
    relay,
    admin,
    MIN_DEAL,
    TARIFF,
    FINE,
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`        EscrowFactory → ${factoryAddress}`);

  // Wire up roles. NOTE: deployer holds ADMIN_ROLE on Treasury/Registry only if
  // admin === deployer.address. Otherwise the caller of this script must hold ADMIN_ROLE
  // on those contracts (e.g. via a multisig signing the role-grant tx separately).
  console.log("\nWiring roles…");
  if (admin === deployer.address) {
    const FACTORY_ROLE_TREASURY = await treasury.FACTORY_ROLE();
    const FACTORY_ROLE_REGISTRY = await registry.FACTORY_ROLE();
    const REGISTRY_ROLE = await treasury.REGISTRY_ROLE();
    await (await treasury.grantRole(FACTORY_ROLE_TREASURY, factoryAddress)).wait();
    console.log(`  Treasury.FACTORY_ROLE  → ${factoryAddress}`);
    await (await registry.grantRole(FACTORY_ROLE_REGISTRY, factoryAddress)).wait();
    console.log(`  Registry.FACTORY_ROLE  → ${factoryAddress}`);
    await (await treasury.grantRole(REGISTRY_ROLE, registryAddress)).wait();
    console.log(`  Treasury.REGISTRY_ROLE → ${registryAddress}`);
  } else {
    console.log("  Skipped — admin != deployer. Grant these roles manually:");
    console.log(`    Treasury.grantRole(FACTORY_ROLE,  ${factoryAddress})`);
    console.log(`    Registry.grantRole(FACTORY_ROLE,  ${factoryAddress})`);
    console.log(`    Treasury.grantRole(REGISTRY_ROLE, ${registryAddress})`);
  }

  // Persist addresses
  const out = {
    network: networkName,
    deployer: deployer.address,
    relay,
    admin,
    timestamp: new Date().toISOString(),
    contracts: {
      token: tokenAddress,
      treasury: treasuryAddress,
      registry: registryAddress,
      implementation: implementationAddress,
      factory: factoryAddress,
    },
    config: {
      minDeal: MIN_DEAL.toString(),
      tariff: {
        threshold: TARIFF.threshold.toString(),
        flatFee: TARIFF.flatFee.toString(),
        percentFeeBps: TARIFF.percentFeeBps.toString(),
      },
      fine: {
        fineBps: FINE.fineBps.toString(),
        fineMin: FINE.fineMin.toString(),
        fineMax: FINE.fineMax.toString(),
      },
      arbMinStake: ARB_MIN_STAKE.toString(),
      arbSeniorMinStake: ARB_SENIOR_MIN_STAKE.toString(),
    },
  };
  const dir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const filePath = path.join(dir, `${networkName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2));
  console.log(`\nAddresses saved to ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
