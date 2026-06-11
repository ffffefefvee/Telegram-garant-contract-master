import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Redeploy EscrowImplementation + EscrowFactory, reusing the live
 * PlatformTreasury / ArbitratorRegistry / token.
 *
 * Why a new factory: `EscrowFactory.implementation` is immutable, so shipping
 * a new implementation (e.g. extendFundingDeadline from PR #9) requires a new
 * factory clone-source. Treasury, registry, balances and all in-flight escrows
 * stay untouched — old escrows keep running on the old implementation.
 *
 * Config (relay, minDealAmount, tariff, fine) is read on-chain from the OLD
 * factory, so the new one is guaranteed to be configured identically.
 *
 * Usage:
 *   OLD_FACTORY_ADDRESS=0x... npx hardhat run scripts/redeploy-impl.ts --network amoy
 *
 *   - OLD_FACTORY_ADDRESS is optional if deployments/<network>.json exists
 *     (it is read from there by default).
 *   - ADMIN_ADDRESS is optional; defaults to the deployer. If the admin is a
 *     different account/multisig, role grants are printed for manual signing.
 *
 * After running: follow docs/DEPLOYMENT_RUNBOOK.md §4 (verify on Polygonscan,
 * switch ESCROW_FACTORY_ADDRESS in the backend, restart, smoke-test).
 */

async function main() {
  const networkName = network.name;
  const [deployer] = await ethers.getSigners();
  console.log(`\nRedeploying impl+factory on ${networkName} from ${deployer.address}`);

  // --- 1. Locate the old factory -------------------------------------------
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${networkName}.json`);
  let deployment: any = null;
  if (fs.existsSync(deploymentFile)) {
    deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  }

  const oldFactoryAddress =
    process.env.OLD_FACTORY_ADDRESS || deployment?.contracts?.factory;
  if (!oldFactoryAddress) {
    throw new Error(
      `No OLD_FACTORY_ADDRESS env var and no deployments/${networkName}.json — ` +
        `cannot locate the live factory.`,
    );
  }
  console.log(`  old factory = ${oldFactoryAddress}`);

  // --- 2. Read live config on-chain ----------------------------------------
  const oldFactory = await ethers.getContractAt("EscrowFactory", oldFactoryAddress);
  const [token, treasury, registry, relay, minDealAmount, tariff, fine] =
    await Promise.all([
      oldFactory.token(),
      oldFactory.treasury(),
      oldFactory.registry(),
      oldFactory.relay(),
      oldFactory.minDealAmount(),
      oldFactory.tariff(),
      oldFactory.fine(),
    ]);
  const admin = process.env.ADMIN_ADDRESS || deployer.address;

  console.log(`  token       = ${token}`);
  console.log(`  treasury    = ${treasury}`);
  console.log(`  registry    = ${registry}`);
  console.log(`  relay       = ${relay}`);
  console.log(`  admin       = ${admin}`);
  console.log(`  minDeal     = ${minDealAmount}`);
  console.log(`  tariff      = threshold=${tariff.threshold} flat=${tariff.flatFee} bps=${tariff.percentFeeBps}`);
  console.log(`  fine        = bps=${fine.fineBps} min=${fine.fineMin} max=${fine.fineMax}`);

  // --- 3. Deploy new implementation ----------------------------------------
  console.log("\n[1/3] Deploying new EscrowImplementation…");
  const Impl = await ethers.getContractFactory("EscrowImplementation");
  const implementation = await Impl.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  console.log(`        EscrowImplementation → ${implementationAddress}`);

  // --- 4. Deploy new factory with identical config -------------------------
  console.log("\n[2/3] Deploying new EscrowFactory…");
  const Factory = await ethers.getContractFactory("EscrowFactory");
  const factory = await Factory.deploy(
    implementationAddress,
    token,
    treasury,
    registry,
    relay,
    admin,
    minDealAmount,
    { threshold: tariff.threshold, flatFee: tariff.flatFee, percentFeeBps: tariff.percentFeeBps },
    { fineBps: fine.fineBps, fineMin: fine.fineMin, fineMax: fine.fineMax },
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`        EscrowFactory → ${factoryAddress}`);

  // --- 5. Grant roles on Treasury/Registry to the new factory --------------
  // The OLD factory keeps its roles so in-flight escrows finish normally.
  console.log("\n[3/3] Wiring roles…");
  const treasuryContract = await ethers.getContractAt("PlatformTreasury", treasury);
  const registryContract = await ethers.getContractAt("ArbitratorRegistry", registry);
  const FACTORY_ROLE_TREASURY = await treasuryContract.FACTORY_ROLE();
  const FACTORY_ROLE_REGISTRY = await registryContract.FACTORY_ROLE();

  const deployerIsTreasuryAdmin = await treasuryContract.hasRole(
    await treasuryContract.ADMIN_ROLE(),
    deployer.address,
  );
  if (deployerIsTreasuryAdmin) {
    await (await treasuryContract.grantRole(FACTORY_ROLE_TREASURY, factoryAddress)).wait();
    console.log(`  Treasury.FACTORY_ROLE → ${factoryAddress}`);
    await (await registryContract.grantRole(FACTORY_ROLE_REGISTRY, factoryAddress)).wait();
    console.log(`  Registry.FACTORY_ROLE → ${factoryAddress}`);
  } else {
    console.log("  Deployer lacks ADMIN_ROLE — sign these from the admin account/multisig:");
    console.log(`    Treasury(${treasury}).grantRole(${FACTORY_ROLE_TREASURY}, ${factoryAddress})`);
    console.log(`    Registry(${registry}).grantRole(${FACTORY_ROLE_REGISTRY}, ${factoryAddress})`);
  }

  // --- 6. Persist updated deployment file ----------------------------------
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);
  const out = {
    ...(deployment || { network: networkName }),
    timestamp: new Date().toISOString(),
    contracts: {
      ...(deployment?.contracts || {}),
      token,
      treasury,
      registry,
      implementation: implementationAddress,
      factory: factoryAddress,
    },
    previousFactories: [
      ...(deployment?.previousFactories || []),
      {
        factory: oldFactoryAddress,
        implementation: deployment?.contracts?.implementation || "unknown",
        retiredAt: new Date().toISOString(),
      },
    ],
  };
  fs.writeFileSync(deploymentFile, JSON.stringify(out, null, 2));
  console.log(`\nAddresses saved to ${deploymentFile}`);

  console.log("\nNext steps (docs/DEPLOYMENT_RUNBOOK.md §4):");
  console.log(`  1. npx hardhat verify --network ${networkName} ${implementationAddress}`);
  console.log("  2. Verify the factory with constructor args (see runbook).");
  console.log(`  3. Set ESCROW_FACTORY_ADDRESS=${factoryAddress} in the backend env and restart.`);
  console.log("  4. Run a smoke deal end-to-end before announcing.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
