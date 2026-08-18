import { ethers } from "hardhat";
import type {
  Contract,
  ContractFactory,
  ContractTransactionReceipt,
  ContractTransactionResponse,
} from "ethers";
import * as fs from "fs";
import * as path from "path";

const AMOY_CHAIN_ID = 80002n;
const EXPECTED_DEPLOYER_ADDRESS = "0x97C2DdF6D747b9188e20578f06174D68db732a22";
const RELAY_ADDRESS = "0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf";
const EXPECTED_INITIAL_NONCE = 0;
const USDT_DECIMALS = 6;
const DEFAULT_RELAY_FLOAT_USDT = "10";
const MIN_DEPLOYER_RESERVE_POL = ethers.parseEther("0.02");
const ESTIMATED_DEPLOYER_GAS = 7_443_662n;
const GAS_SAFETY_NUMERATOR = 150n;
const GAS_SAFETY_DENOMINATOR = 100n;

const MIN_DEAL = 3_300_000n;
const TARIFF = { threshold: 11_000_000n, flatFee: 550_000n, percentFeeBps: 500n };
const FINE = { fineBps: 1000n, fineMin: 1_100_000n, fineMax: 11_000_000n };
const ARB_MIN_STAKE = 200_000_000n;
const ARB_SENIOR_MIN_STAKE = 100_000_000n;

type ContractKey =
  | "testUsdt"
  | "testGovernance"
  | "platformTreasury"
  | "arbitratorRegistry"
  | "escrowImplementation"
  | "escrowFactory";

interface TxEvidence {
  label: string;
  hash: string | null;
  nonce: number;
  blockNumber: number | null;
  gasUsed: string | null;
  gasPrice: string | null;
  feePol: string | null;
  contractAddress: string | null;
  recoveredFromChain: boolean;
}

interface CheckpointStep {
  label: string;
  nonce: number;
  expectedContractAddress?: string;
  txHash?: string;
  evidence?: TxEvidence;
}

interface DeploymentCheckpoint {
  schemaVersion: 1;
  createdAt: string;
  chainId: number;
  deployer: string;
  relay: string;
  initialNonce: number;
  seller: string;
  contracts: Record<ContractKey, string>;
  steps: Record<string, CheckpointStep>;
}

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

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function transactionEvidence(
  step: CheckpointStep,
  receipt: ContractTransactionReceipt,
): TxEvidence {
  const gasPrice = receipt.gasPrice ?? 0n;
  return {
    label: step.label,
    hash: receipt.hash,
    nonce: step.nonce,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    gasPrice: gasPrice.toString(),
    feePol: ethers.formatEther(receipt.gasUsed * gasPrice),
    contractAddress: receipt.contractAddress,
    recoveredFromChain: false,
  };
}

function createCheckpoint(deployer: string, initialNonce: number): DeploymentCheckpoint {
  const contracts = {
    testUsdt: ethers.getCreateAddress({ from: deployer, nonce: initialNonce }),
    testGovernance: ethers.getCreateAddress({ from: deployer, nonce: initialNonce + 1 }),
    platformTreasury: ethers.getCreateAddress({ from: deployer, nonce: initialNonce + 2 }),
    arbitratorRegistry: ethers.getCreateAddress({ from: deployer, nonce: initialNonce + 3 }),
    escrowImplementation: ethers.getCreateAddress({ from: deployer, nonce: initialNonce + 4 }),
    escrowFactory: ethers.getCreateAddress({ from: deployer, nonce: initialNonce + 5 }),
  };
  const definitions: Array<[string, number, string?]> = [
    ["deploy:TestUSDT", 0, contracts.testUsdt],
    ["deploy:TestGovernance", 1, contracts.testGovernance],
    ["deploy:PlatformTreasury", 2, contracts.platformTreasury],
    ["deploy:ArbitratorRegistry", 3, contracts.arbitratorRegistry],
    ["deploy:EscrowImplementation", 4, contracts.escrowImplementation],
    ["deploy:EscrowFactory", 5, contracts.escrowFactory],
    ["grant:Treasury.FACTORY_ROLE", 6],
    ["grant:Registry.FACTORY_ROLE", 7],
    ["grant:Treasury.REGISTRY_ROLE", 8],
    ["mint:relay-test-usdt", 9],
  ];
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    chainId: Number(AMOY_CHAIN_ID),
    deployer,
    relay: ethers.getAddress(RELAY_ADDRESS),
    initialNonce,
    seller: ethers.Wallet.createRandom().address,
    contracts,
    steps: Object.fromEntries(
      definitions.map(([label, offset, expectedContractAddress]) => [
        label,
        { label, nonce: initialNonce + offset, expectedContractAddress },
      ]),
    ),
  };
}

function validateCheckpoint(
  checkpoint: DeploymentCheckpoint,
  deployer: string,
  expectedChainId: bigint,
): void {
  if (
    checkpoint.schemaVersion !== 1 ||
    checkpoint.chainId !== Number(expectedChainId) ||
    ethers.getAddress(checkpoint.deployer) !== deployer ||
    ethers.getAddress(checkpoint.relay) !== ethers.getAddress(RELAY_ADDRESS) ||
    checkpoint.initialNonce !== EXPECTED_INITIAL_NONCE
  ) {
    throw new Error("Existing deployment checkpoint does not match this acceptance run");
  }
  const expected = createCheckpoint(deployer, checkpoint.initialNonce).contracts;
  for (const key of Object.keys(expected) as ContractKey[]) {
    if (ethers.getAddress(checkpoint.contracts[key]) !== ethers.getAddress(expected[key])) {
      throw new Error(`Checkpoint address mismatch for ${key}`);
    }
  }
}

async function main() {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL ?? "https://rpc-amoy.polygon.technology";
  const localDryRun = process.env.AMOY_ACCEPTANCE_LOCAL_DRY_RUN === "true";
  if (localDryRun && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(rpcUrl)) {
    throw new Error("AMOY_ACCEPTANCE_LOCAL_DRY_RUN is allowed only with a loopback HTTP RPC URL");
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(requirePrivateKey(), provider);
  const expectedDeployer = localDryRun ? deployer.address : ethers.getAddress(EXPECTED_DEPLOYER_ADDRESS);
  if (deployer.address !== expectedDeployer) {
    throw new Error(`DEPLOYER_PRIVATE_KEY derives ${deployer.address}, expected ${expectedDeployer}`);
  }
  const network = await provider.getNetwork();
  const expectedChainId = localDryRun ? 31337n : AMOY_CHAIN_ID;
  if (network.chainId !== expectedChainId) {
    throw new Error(`Expected chain ${expectedChainId}, got ${network.chainId}`);
  }

  const outputPath = path.resolve(
    process.env.AMOY_DEPLOYMENT_OUTPUT ?? path.join(__dirname, "..", "deployments", "amoy-acceptance.json"),
  );
  const checkpointPath = path.resolve(
    process.env.AMOY_DEPLOYMENT_CHECKPOINT ??
      path.join(__dirname, "..", "..", ".local-e2e", "amoy-deployment-checkpoint.json"),
  );
  const checkpointExists = fs.existsSync(checkpointPath);
  const getTransactionCount = async (blockTag: "latest" | "pending") =>
    Number(
      BigInt(
        (await provider.send("eth_getTransactionCount", [
          deployer.address,
          blockTag,
        ])) as string,
      ),
    );
  let checkpoint: DeploymentCheckpoint;
  if (checkpointExists) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as DeploymentCheckpoint;
    validateCheckpoint(checkpoint, deployer.address, expectedChainId);
  } else {
    const latestNonce = await getTransactionCount("latest");
    const pendingNonce = await getTransactionCount("pending");
    if (latestNonce !== EXPECTED_INITIAL_NONCE || pendingNonce !== EXPECTED_INITIAL_NONCE) {
      throw new Error(
        `Fresh acceptance deployment requires latest=pending nonce ${EXPECTED_INITIAL_NONCE}; ` +
          `got latest=${latestNonce}, pending=${pendingNonce}. Refusing to create a second deployment.`,
      );
    }
    checkpoint = createCheckpoint(deployer.address, EXPECTED_INITIAL_NONCE);
    checkpoint.chainId = Number(expectedChainId);
  }

  const startingBalance = await provider.getBalance(deployer.address);
  const feeData = await provider.getFeeData();
  const budgetGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!budgetGasPrice || budgetGasPrice <= 0n) throw new Error("Amoy RPC did not return a usable gas price");
  if (!checkpointExists) {
    const estimatedCostWithMargin =
      (ESTIMATED_DEPLOYER_GAS * budgetGasPrice * GAS_SAFETY_NUMERATOR) /
      GAS_SAFETY_DENOMINATOR;
    const requiredStartingBalance = estimatedCostWithMargin + MIN_DEPLOYER_RESERVE_POL;
    if (startingBalance < requiredStartingBalance) {
      throw new Error(
        `Deployer ${deployer.address} has ${ethers.formatEther(startingBalance)} POL; ` +
          `${ethers.formatEther(requiredStartingBalance)} POL is required for measured gas, margin, and reserve`,
      );
    }
    writeJsonAtomic(checkpointPath, checkpoint);
  } else if (startingBalance < MIN_DEPLOYER_RESERVE_POL) {
    throw new Error("A resumed deployment is below the protected deployer POL reserve");
  }

  const relayFloat = parseAmount(
    "RELAY_TEST_USDT_AMOUNT",
    process.env.RELAY_TEST_USDT_AMOUNT,
    DEFAULT_RELAY_FLOAT_USDT,
  );
  const saveCheckpoint = () => writeJsonAtomic(checkpointPath, checkpoint);
  const getLatestCode = (address: string) =>
    provider.send("eth_getCode", [address, "latest"]) as Promise<string>;

  const reconcileStep = async (
    step: CheckpointStep,
    send: () => Promise<ContractTransactionResponse>,
  ): Promise<TxEvidence> => {
    if (step.evidence) return step.evidence;
    if (step.txHash) {
      const knownReceipt = await provider.getTransactionReceipt(step.txHash);
      if (!knownReceipt) {
        throw new Error(
          `${step.label} has pending/unknown tx ${step.txHash}; wait for resolution and rerun. ` +
            "The nonce will not be reused.",
        );
      }
      if (knownReceipt.status !== 1) throw new Error(`${step.label} transaction reverted: ${step.txHash}`);
      step.evidence = transactionEvidence(step, knownReceipt);
      saveCheckpoint();
      return step.evidence;
    }

    if (step.expectedContractAddress) {
      const code = await getLatestCode(step.expectedContractAddress);
      if (code !== "0x") {
        step.evidence = {
          label: step.label,
          hash: null,
          nonce: step.nonce,
          blockNumber: null,
          gasUsed: null,
          gasPrice: null,
          feePol: null,
          contractAddress: step.expectedContractAddress,
          recoveredFromChain: true,
        };
        saveCheckpoint();
        return step.evidence;
      }
    }

    const latestNonce = await getTransactionCount("latest");
    const pendingNonce = await getTransactionCount("pending");
    if (latestNonce !== step.nonce || pendingNonce !== step.nonce) {
      throw new Error(
        `${step.label} expects nonce ${step.nonce}, but latest=${latestNonce}, pending=${pendingNonce}. ` +
          "An untracked or pending transaction may exist; refusing an ambiguous resend.",
      );
    }
    const tx = await send();
    if (tx.nonce !== step.nonce) throw new Error(`${step.label} was submitted with unexpected nonce ${tx.nonce}`);
    step.txHash = tx.hash;
    saveCheckpoint();
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error(`${step.label} did not succeed`);
    step.evidence = transactionEvidence(step, receipt);
    saveCheckpoint();
    return step.evidence;
  };

  const deployOrAttach = async (
    key: ContractKey,
    contractName: string,
    args: unknown[],
  ): Promise<Contract> => {
    const step = checkpoint.steps[`deploy:${contractName}`];
    const factory = await ethers.getContractFactory(contractName, deployer);
    await reconcileStep(step, async () => {
      const contract = await factory.deploy(...args, { nonce: step.nonce });
      const transaction = contract.deploymentTransaction();
      if (!transaction) throw new Error(`${contractName} has no deployment transaction`);
      return transaction;
    });
    const actualCode = await getLatestCode(checkpoint.contracts[key]);
    if (actualCode === "0x") throw new Error(`${contractName} has no code at its planned address`);
    return factory.attach(checkpoint.contracts[key]).connect(deployer) as Contract;
  };

  const token = await deployOrAttach("testUsdt", "TestUSDT", []);
  const governance = await deployOrAttach("testGovernance", "TestGovernance", [deployer.address]);
  const treasury = await deployOrAttach("platformTreasury", "PlatformTreasury", [
    checkpoint.contracts.testUsdt,
    checkpoint.contracts.testGovernance,
  ]);
  const registry = await deployOrAttach("arbitratorRegistry", "ArbitratorRegistry", [
    checkpoint.contracts.testUsdt,
    checkpoint.contracts.platformTreasury,
    ARB_MIN_STAKE,
    ARB_SENIOR_MIN_STAKE,
    checkpoint.contracts.testGovernance,
  ]);
  await deployOrAttach("escrowImplementation", "EscrowImplementation", []);
  const factory = await deployOrAttach("escrowFactory", "EscrowFactory", [
    checkpoint.contracts.escrowImplementation,
    checkpoint.contracts.testUsdt,
    checkpoint.contracts.platformTreasury,
    checkpoint.contracts.arbitratorRegistry,
    RELAY_ADDRESS,
    checkpoint.contracts.testGovernance,
    MIN_DEAL,
    TARIFF,
    FINE,
  ]);

  const governanceContract = governance.connect(deployer) as Contract;
  const grantRole = async (label: string, contract: Contract, role: string, account: string) => {
    const step = checkpoint.steps[label];
    if (await contract.getFunction("hasRole")(role, account)) {
      if (!step.evidence) {
        step.evidence = {
          label,
          hash: step.txHash ?? null,
          nonce: step.nonce,
          blockNumber: null,
          gasUsed: null,
          gasPrice: null,
          feePol: null,
          contractAddress: null,
          recoveredFromChain: true,
        };
        saveCheckpoint();
      }
      return;
    }
    const data = contract.interface.encodeFunctionData("grantRole", [role, account]);
    await reconcileStep(step, () =>
      governanceContract.getFunction("execute")(
        awaitAddress(contract),
        data,
        { nonce: step.nonce },
      ) as Promise<ContractTransactionResponse>,
    );
  };
  const awaitAddress = async (contract: Contract) => contract.getAddress();

  await grantRole(
    "grant:Treasury.FACTORY_ROLE",
    treasury,
    await treasury.getFunction("FACTORY_ROLE")(),
    checkpoint.contracts.escrowFactory,
  );
  await grantRole(
    "grant:Registry.FACTORY_ROLE",
    registry,
    await registry.getFunction("FACTORY_ROLE")(),
    checkpoint.contracts.escrowFactory,
  );
  await grantRole(
    "grant:Treasury.REGISTRY_ROLE",
    treasury,
    await treasury.getFunction("REGISTRY_ROLE")(),
    checkpoint.contracts.arbitratorRegistry,
  );

  const relayRole = await factory.getFunction("RELAY_ROLE")();
  if (!(await factory.getFunction("hasRole")(relayRole, RELAY_ADDRESS))) {
    throw new Error("Relay role was not granted to the configured Web3Signer address");
  }

  const mintStep = checkpoint.steps["mint:relay-test-usdt"];
  const currentRelayBalance = (await token.getFunction("balanceOf")(RELAY_ADDRESS)) as bigint;
  if (currentRelayBalance > relayFloat) {
    throw new Error("Relay TestUSDT balance exceeds the planned mint; refusing to conceal unexpected state");
  }
  if (currentRelayBalance < relayFloat) {
    await reconcileStep(mintStep, () =>
      token.getFunction("mint")(RELAY_ADDRESS, relayFloat - currentRelayBalance, {
        nonce: mintStep.nonce,
      }) as Promise<ContractTransactionResponse>,
    );
  } else if (!mintStep.evidence) {
    mintStep.evidence = {
      label: mintStep.label,
      hash: mintStep.txHash ?? null,
      nonce: mintStep.nonce,
      blockNumber: null,
      gasUsed: null,
      gasPrice: null,
      feePol: null,
      contractAddress: null,
      recoveredFromChain: true,
    };
    saveCheckpoint();
  }

  const endingBalance = await provider.getBalance(deployer.address);
  if (endingBalance < MIN_DEPLOYER_RESERVE_POL) {
    throw new Error(`Deployment left ${ethers.formatEther(endingBalance)} POL, below the protected reserve`);
  }
  const requiredStartingBalance =
    (ESTIMATED_DEPLOYER_GAS * budgetGasPrice * GAS_SAFETY_NUMERATOR) /
      GAS_SAFETY_DENOMINATOR +
    MIN_DEPLOYER_RESERVE_POL;
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gitCommit: process.env.TEST_GIT_COMMIT ?? null,
    network: {
      name: localDryRun ? "hardhat-local-dry-run" : "polygon-amoy",
      chainId: Number(expectedChainId),
      rpcUrl,
    },
    contracts: checkpoint.contracts,
    wallets: {
      deployer: { address: deployer.address },
      relay: { address: ethers.getAddress(RELAY_ADDRESS) },
      buyer: { address: deployer.address },
      seller: { address: checkpoint.seller },
    },
    minted: { relayUsdt: ethers.formatUnits(relayFloat, USDT_DECIMALS) },
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
    },
    pol: {
      deployerStarting: ethers.formatEther(startingBalance),
      deployerEnding: ethers.formatEther(endingBalance),
      deployerSpentThisRun: ethers.formatEther(startingBalance - endingBalance),
      requiredReserve: ethers.formatEther(MIN_DEPLOYER_RESERVE_POL),
      budgetMaxFeePerGasGwei: ethers.formatUnits(budgetGasPrice, "gwei"),
      estimatedDeployerGas: ESTIMATED_DEPLOYER_GAS.toString(),
      requiredStartingForFreshRun: ethers.formatEther(requiredStartingBalance),
    },
    checkpointPath,
    transactions: Object.values(checkpoint.steps).map((step) => step.evidence),
  };
  writeJsonAtomic(outputPath, output);
  console.log(JSON.stringify({ outputPath, ...output }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
