import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const AMOY_CHAIN_ID = 80002n;
const EXPECTED_DEPLOYER = "0x97C2DdF6D747b9188e20578f06174D68db732a22";
const EXPECTED_RELAY = "0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf";
const ZERO_ROLE = ethers.ZeroHash;

interface Manifest {
  network: { chainId: number };
  contracts: {
    testUsdt: string;
    testGovernance: string;
    platformTreasury: string;
    arbitratorRegistry: string;
    escrowImplementation: string;
    escrowFactory: string;
  };
  wallets: {
    deployer: { address: string };
    relay: { address: string };
    buyer: { address: string };
    seller: { address: string };
  };
  minted: { relayUsdt: string };
}

interface CheckResult {
  name: string;
  pass: boolean;
  actual: unknown;
  expected: unknown;
}

function requireManifestPath(): string {
  const value = process.env.AMOY_DEPLOYMENT_OUTPUT;
  if (!value) throw new Error("AMOY_DEPLOYMENT_OUTPUT is required");
  return path.resolve(value);
}

function normalize(value: string): string {
  return ethers.getAddress(value);
}

async function main() {
  const manifestPath = requireManifestPath();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  const network = await ethers.provider.getNetwork();
  const allowLocal = process.env.AMOY_ACCEPTANCE_LOCAL_DRY_RUN === "true";
  const expectedChainId = allowLocal ? 31337n : AMOY_CHAIN_ID;
  if (network.chainId !== expectedChainId || manifest.network.chainId !== Number(expectedChainId)) {
    throw new Error("Verifier and manifest must both target Polygon Amoy chain 80002");
  }

  const checks: CheckResult[] = [];
  const check = (name: string, actual: unknown, expected: unknown) => {
    const pass = actual === expected;
    checks.push({ name, pass, actual, expected });
  };
  const checkAddress = (name: string, actual: string, expected: string) =>
    check(name, normalize(actual), normalize(expected));

  checkAddress(
    "manifest.deployer",
    manifest.wallets.deployer.address,
    allowLocal ? manifest.wallets.deployer.address : EXPECTED_DEPLOYER,
  );
  checkAddress("manifest.relay", manifest.wallets.relay.address, EXPECTED_RELAY);
  checkAddress("manifest.buyer", manifest.wallets.buyer.address, manifest.wallets.deployer.address);

  const codeEvidence: Record<string, { address: string; sizeBytes: number; keccak256: string }> = {};
  for (const [name, address] of Object.entries(manifest.contracts)) {
    const code = await ethers.provider.getCode(address);
    const sizeBytes = ethers.dataLength(code);
    codeEvidence[name] = { address: normalize(address), sizeBytes, keccak256: ethers.keccak256(code) };
    checks.push({ name: `code.${name}`, pass: sizeBytes > 0, actual: sizeBytes, expected: "> 0" });
  }

  const token = await ethers.getContractAt("TestUSDT", manifest.contracts.testUsdt);
  const governance = await ethers.getContractAt("TestGovernance", manifest.contracts.testGovernance);
  const treasury = await ethers.getContractAt("PlatformTreasury", manifest.contracts.platformTreasury);
  const registry = await ethers.getContractAt("ArbitratorRegistry", manifest.contracts.arbitratorRegistry);
  const implementation = await ethers.getContractAt(
    "EscrowImplementation",
    manifest.contracts.escrowImplementation,
  );
  const factory = await ethers.getContractAt("EscrowFactory", manifest.contracts.escrowFactory);

  check("token.decimals", Number(await token.decimals()), 6);
  check("token.name", await token.name(), "Test Tether USD");
  check("token.symbol", await token.symbol(), "USDT");
  check(
    "token.relayBalance",
    (await token.balanceOf(EXPECTED_RELAY)).toString(),
    ethers.parseUnits(manifest.minted.relayUsdt, 6).toString(),
  );
  checkAddress("governance.owner", await governance.owner(), manifest.wallets.deployer.address);

  checkAddress("treasury.token", await treasury.token(), manifest.contracts.testUsdt);
  check("treasury.reserveBps", Number(await treasury.reserveBps()), 2000);
  checkAddress("registry.token", await registry.token(), manifest.contracts.testUsdt);
  checkAddress("registry.treasury", await registry.treasury(), manifest.contracts.platformTreasury);
  check("registry.minStake", (await registry.minStake()).toString(), "200000000");
  check("registry.seniorMinStake", (await registry.seniorMinStake()).toString(), "100000000");

  checkAddress("factory.implementation", await factory.implementation(), manifest.contracts.escrowImplementation);
  checkAddress("factory.token", await factory.token(), manifest.contracts.testUsdt);
  checkAddress("factory.treasury", await factory.treasury(), manifest.contracts.platformTreasury);
  checkAddress("factory.registry", await factory.registry(), manifest.contracts.arbitratorRegistry);
  checkAddress("factory.relay", await factory.relay(), EXPECTED_RELAY);
  check("factory.minDealAmount", (await factory.minDealAmount()).toString(), "3300000");
  const tariff = await factory.tariff();
  check("factory.tariff.threshold", tariff.threshold.toString(), "11000000");
  check("factory.tariff.flatFee", tariff.flatFee.toString(), "550000");
  check("factory.tariff.percentFeeBps", tariff.percentFeeBps.toString(), "500");
  const fine = await factory.fine();
  check("factory.fine.fineBps", fine.fineBps.toString(), "1000");
  check("factory.fine.fineMin", fine.fineMin.toString(), "1100000");
  check("factory.fine.fineMax", fine.fineMax.toString(), "11000000");

  const factoryAdmin = await factory.ADMIN_ROLE();
  const relayRole = await factory.RELAY_ROLE();
  const treasuryFactoryRole = await treasury.FACTORY_ROLE();
  const treasuryRegistryRole = await treasury.REGISTRY_ROLE();
  const registryFactoryRole = await registry.FACTORY_ROLE();
  check("factory.defaultAdmin.governance", await factory.hasRole(ZERO_ROLE, manifest.contracts.testGovernance), true);
  check("factory.admin.governance", await factory.hasRole(factoryAdmin, manifest.contracts.testGovernance), true);
  check("factory.relay.relay", await factory.hasRole(relayRole, EXPECTED_RELAY), true);
  check("factory.relay.deployer", await factory.hasRole(relayRole, manifest.wallets.deployer.address), false);
  check("factory.defaultAdmin.deployer", await factory.hasRole(ZERO_ROLE, manifest.wallets.deployer.address), false);
  check("treasury.factoryRole", await treasury.hasRole(treasuryFactoryRole, manifest.contracts.escrowFactory), true);
  check("treasury.registryRole", await treasury.hasRole(treasuryRegistryRole, manifest.contracts.arbitratorRegistry), true);
  check("registry.factoryRole", await registry.hasRole(registryFactoryRole, manifest.contracts.escrowFactory), true);
  check("treasury.defaultAdmin.deployer", await treasury.hasRole(ZERO_ROLE, manifest.wallets.deployer.address), false);
  check("registry.defaultAdmin.deployer", await registry.hasRole(ZERO_ROLE, manifest.wallets.deployer.address), false);

  const initializationProbe = {
    token: manifest.contracts.testUsdt,
    treasury: manifest.contracts.platformTreasury,
    registry: manifest.contracts.arbitratorRegistry,
    dealId: ethers.keccak256(ethers.toUtf8Bytes("implementation-lock-probe")),
    buyer: manifest.wallets.buyer.address,
    seller: manifest.wallets.seller.address,
    amount: 3_300_000n,
    buyerFee: 275_000n,
    sellerFee: 275_000n,
    fundingDeadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    fineMin: 1_100_000n,
    fineMax: 11_000_000n,
    fineBps: 1000,
  };
  let implementationLocked = false;
  try {
    await implementation.initialize.staticCall(initializationProbe);
  } catch {
    implementationLocked = true;
  }
  check("implementation.initialize.reverts", implementationLocked, true);

  const failed = checks.filter((entry) => !entry.pass);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    result: failed.length === 0 ? "PASS" : "FAIL",
    chainId: Number(network.chainId),
    manifestPath,
    codeEvidence,
    checks,
    summary: { passed: checks.length - failed.length, failed: failed.length, total: checks.length },
  };
  const outputPath = path.resolve(
    process.env.AMOY_VERIFICATION_REPORT ??
      path.join(__dirname, "..", "..", ".local-e2e", "amoy-deployment-verification.json"),
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ outputPath, ...report }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
