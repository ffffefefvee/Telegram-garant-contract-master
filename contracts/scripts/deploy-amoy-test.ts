import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";

const AMOY_CHAIN_ID = 80002n;
const RELAY_ADDRESS = "0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf";
const USDT_DECIMALS = 6;
const BUYER_USDT = "100";
const DEFAULT_RELAY_FLOAT_USDT = "10";

const MIN_DEAL = 3_300_000n;
const TARIFF = {
  threshold: 11_000_000n,
  flatFee: 550_000n,
  percentFeeBps: 500n,
};
const FINE = {
  fineBps: 1000n,
  fineMin: 1_100_000n,
  fineMax: 11_000_000n,
};
const ARB_MIN_STAKE = 200_000_000n;
const ARB_SENIOR_MIN_STAKE = 100_000_000n;

function requirePrivateKey(): string {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("DEPLOYER_PRIVATE_KEY must be a 32-byte hex private key prefixed with 0x");
  }
  return privateKey;
}

function parseAmount(name: string, value: string | undefined, fallback: string): bigint {
  const amount = value ?? fallback;
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error(`${name} must be a positive decimal amount with at most ${USDT_DECIMALS} places`);
  }
  return ethers.parseUnits(amount, USDT_DECIMALS);
}

async function deployContract(name: string, signer: Signer, args: unknown[] = []): Promise<Contract> {
  const factory = await ethers.getContractFactory(name, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract as unknown as Contract;
}

async function main() {
  const deployerPrivateKey = requirePrivateKey();
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL ?? "https://rpc-amoy.polygon.technology";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(deployerPrivateKey, provider);
  const network = await provider.getNetwork();
  if (network.chainId !== AMOY_CHAIN_ID) {
    throw new Error(`BLOCKCHAIN_RPC_URL must point to Polygon Amoy (chain ${AMOY_CHAIN_ID}), got ${network.chainId}`);
  }

  const balance = await provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error(`Deployer ${deployer.address} has no POL for gas`);
  }

  const relayFloat = parseAmount("RELAY_TEST_USDT_AMOUNT", process.env.RELAY_TEST_USDT_AMOUNT, DEFAULT_RELAY_FLOAT_USDT);
  const buyer = ethers.Wallet.createRandom();
  const seller = ethers.Wallet.createRandom();

  const testUsdt = await deployContract("TestUSDT", deployer);
  const governance = await deployContract("TestGovernance", deployer, [deployer.address]);
  const treasury = await deployContract("PlatformTreasury", deployer, [await testUsdt.getAddress(), await governance.getAddress()]);
  const registry = await deployContract("ArbitratorRegistry", deployer, [
    await testUsdt.getAddress(),
    await treasury.getAddress(),
    ARB_MIN_STAKE,
    ARB_SENIOR_MIN_STAKE,
    await governance.getAddress(),
  ]);
  const implementation = await deployContract("EscrowImplementation", deployer);
  const factory = await deployContract("EscrowFactory", deployer, [
    await implementation.getAddress(),
    await testUsdt.getAddress(),
    await treasury.getAddress(),
    await registry.getAddress(),
    RELAY_ADDRESS,
    await governance.getAddress(),
    MIN_DEAL,
    TARIFF,
    FINE,
  ]);

  const governanceContract = governance.connect(deployer) as Contract;
  const grantRole = async (contract: Contract, role: string, account: string) => {
    const data = contract.interface.encodeFunctionData("grantRole", [role, account]);
    const tx = await governanceContract.getFunction("execute")(await contract.getAddress(), data);
    await tx.wait();
  };

  await grantRole(treasury, await treasury.getFunction("FACTORY_ROLE")(), await factory.getAddress());
  await grantRole(registry, await registry.getFunction("FACTORY_ROLE")(), await factory.getAddress());
  await grantRole(treasury, await treasury.getFunction("REGISTRY_ROLE")(), await registry.getAddress());

  const relayRole = await factory.getFunction("RELAY_ROLE")();
  if (!(await factory.getFunction("hasRole")(relayRole, RELAY_ADDRESS))) {
    throw new Error("Relay role was not granted to the configured Web3Signer address");
  }

  const buyerMintAmount = ethers.parseUnits(BUYER_USDT, USDT_DECIMALS);
  await (await testUsdt.getFunction("mint")(buyer.address, buyerMintAmount)).wait();
  await (await testUsdt.getFunction("mint")(RELAY_ADDRESS, relayFloat)).wait();

  // This is deliberately the only successful stdout so it can be saved as JSON.
  console.log(JSON.stringify({
    network: { name: "polygon-amoy", chainId: Number(AMOY_CHAIN_ID), rpcUrl },
    contracts: {
      escrowFactory: await factory.getAddress(),
      testUsdt: await testUsdt.getAddress(),
      platformTreasury: await treasury.getAddress(),
      arbitratorRegistry: await registry.getAddress(),
      escrowImplementation: await implementation.getAddress(),
      testGovernance: await governance.getAddress(),
    },
    wallets: {
      deployer: { address: deployer.address },
      relay: { address: RELAY_ADDRESS },
      buyer: { address: buyer.address, privateKey: buyer.privateKey },
      seller: { address: seller.address, privateKey: seller.privateKey },
    },
    minted: {
      buyerUsdt: BUYER_USDT,
      relayUsdt: ethers.formatUnits(relayFloat, USDT_DECIMALS),
    },
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
