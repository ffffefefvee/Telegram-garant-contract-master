import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { Web3SignerSigner } from "../src/modules/blockchain/web3signer.signer";

const CHAIN_ID = 80002;
const USDT_DECIMALS = 6;
const EXPECTED_DEPLOYER = "0x97C2DdF6D747b9188e20578f06174D68db732a22";
const EXPECTED_RELAY = "0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf";
const DEFAULT_AMOUNT_USDT = "3.3";
const HALF_SECP256K1_ORDER = BigInt(
  "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0",
);

const factoryAbi = [
  "function RELAY_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function relay() view returns (address)",
  "function computeTotalFee(uint256) view returns (uint256)",
  "function splitFee(uint256,uint8) view returns (uint256 buyerFee,uint256 sellerFee)",
  "function createEscrow(bytes32,address,address,uint256,uint8,uint64) returns (address)",
  "function escrowOf(bytes32) view returns (address)",
];
const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];
const escrowAbi = [
  "function notifyFunded()",
  "function release()",
  "function status() view returns (uint8)",
  "function amount() view returns (uint256)",
  "function buyerFee() view returns (uint256)",
];
const treasuryAbi = [
  "function mainBalance() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
];

interface DeploymentManifest {
  network: { chainId: number };
  contracts: {
    escrowFactory: string;
    testUsdt: string;
    platformTreasury: string;
  };
  wallets: {
    deployer: { address: string };
    relay: { address: string };
    buyer: { address: string };
    seller: { address: string };
  };
}

interface TxEvidence {
  label: string;
  hash: string;
  explorer: string;
  blockNumber: number;
  gasUsed: string;
  gasPrice: string;
  feePol: string;
  signer: string;
  signature: { v: number; lowS: boolean };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requirePrivateKey(): string {
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("DEPLOYER_PRIVATE_KEY must be a 32-byte hex private key prefixed with 0x");
  }
  return privateKey;
}

function signatureSummary(tx: ethers.TransactionResponse): { v: number; lowS: boolean } {
  if (!tx.signature) throw new Error(`Transaction ${tx.hash} has no signature`);
  const signature = ethers.Signature.from(tx.signature);
  return { v: signature.v, lowS: BigInt(signature.s) <= HALF_SECP256K1_ORDER };
}

async function waitForSuccess(
  label: string,
  tx: ethers.ContractTransactionResponse,
  provider: ethers.JsonRpcProvider,
  localDryRun = false,
): Promise<TxEvidence> {
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`Transaction ${tx.hash} did not succeed`);
  const onChainTx = await provider.getTransaction(tx.hash);
  if (!onChainTx || !onChainTx.from) throw new Error(`Transaction ${tx.hash} cannot be read back`);
  const gasPrice = receipt.gasPrice ?? 0n;
  return {
    label,
    hash: tx.hash,
    explorer: localDryRun ? `local-hardhat:${tx.hash}` : `https://amoy.polygonscan.com/tx/${tx.hash}`,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    gasPrice: gasPrice.toString(),
    feePol: ethers.formatEther(receipt.gasUsed * gasPrice),
    signer: ethers.getAddress(onChainTx.from),
    signature: signatureSummary(onChainTx),
  };
}

function assertAddress(actual: string, expected: string, label: string): void {
  if (ethers.getAddress(actual) !== ethers.getAddress(expected)) {
    throw new Error(`${label} ${actual} does not match expected ${expected}`);
  }
}

async function main(): Promise<void> {
  const localDryRun = process.env.AMOY_ACCEPTANCE_LOCAL_DRY_RUN === "true";
  if (process.env.RUN_AMOY_WEB3SIGNER_E2E !== "true") {
    throw new Error("Refusing to move testnet funds. Set RUN_AMOY_WEB3SIGNER_E2E=true explicitly.");
  }
  if (process.env.MONEY_EGRESS_ENABLED !== "true") {
    throw new Error("MONEY_EGRESS_ENABLED=true is required for this explicit acceptance run");
  }

  const rpcUrl = requireEnv("BLOCKCHAIN_RPC_URL");
  if (localDryRun && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(rpcUrl)) {
    throw new Error("AMOY_ACCEPTANCE_LOCAL_DRY_RUN is allowed only with a loopback HTTP RPC URL");
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(requirePrivateKey(), provider);
  const network = await provider.getNetwork();
  const expectedChainId = localDryRun ? 31337n : BigInt(CHAIN_ID);
  if (network.chainId !== expectedChainId) throw new Error(`Expected chain ${expectedChainId}, got ${network.chainId}`);
  if (!localDryRun) assertAddress(deployer.address, EXPECTED_DEPLOYER, "Deployer");

  let signer: ethers.Signer;
  if (localDryRun) {
    await provider.send("hardhat_impersonateAccount", [EXPECTED_RELAY]);
    await provider.send("hardhat_setBalance", [EXPECTED_RELAY, ethers.toBeHex(ethers.parseEther("10"))]);
    signer = new ethers.JsonRpcSigner(provider, EXPECTED_RELAY);
  } else {
    const web3Signer = new Web3SignerSigner(
      requireEnv("WEB3SIGNER_RPC_URL"),
      requireEnv("WEB3SIGNER_ADDRESS"),
      CHAIN_ID,
      provider,
    );
    await web3Signer.assertConfiguredAccount();
    signer = web3Signer;
  }
  assertAddress(await signer.getAddress(), EXPECTED_RELAY, "Relay");

  const manifestPath = path.resolve(requireEnv("AMOY_DEPLOYMENT_OUTPUT"));
  const deployment = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as DeploymentManifest;
  if (deployment.network.chainId !== Number(expectedChainId)) throw new Error("Deployment manifest chain does not match");
  assertAddress(deployment.wallets.deployer.address, deployer.address, "Manifest deployer");
  assertAddress(deployment.wallets.relay.address, await signer.getAddress(), "Manifest relay");
  assertAddress(deployment.wallets.buyer.address, deployer.address, "Manifest buyer");

  const relay = await signer.getAddress();
  const buyer = deployer.address;
  const seller = ethers.getAddress(deployment.wallets.seller.address);
  const factory = new ethers.Contract(deployment.contracts.escrowFactory, factoryAbi, signer);
  const token = new ethers.Contract(deployment.contracts.testUsdt, erc20Abi, signer);
  const treasury = new ethers.Contract(deployment.contracts.platformTreasury, treasuryAbi, provider);
  const relayRole = await factory.RELAY_ROLE();
  if (!(await factory.hasRole(relayRole, relay))) throw new Error("Web3Signer relay lacks RELAY_ROLE");
  assertAddress(await factory.relay(), relay, "Factory relay");

  const amount = ethers.parseUnits(process.env.AMOY_ACCEPTANCE_AMOUNT_USDT ?? DEFAULT_AMOUNT_USDT, USDT_DECIMALS);
  const totalFee = await factory.computeTotalFee(amount);
  const [buyerFee, sellerFee] = await factory.splitFee(totalFee, 0);
  const requiredFloat = amount + buyerFee;
  const initialRelayUsdt = await token.balanceOf(relay);
  const initialRelayPol = await provider.getBalance(relay);
  const initialDeployerPol = await provider.getBalance(deployer.address);
  const initialSellerUsdt = await token.balanceOf(seller);
  const initialTreasuryUsdt = await token.balanceOf(deployment.contracts.platformTreasury);
  if (initialRelayUsdt < requiredFloat * 2n) {
    throw new Error(`Relay requires ${ethers.formatUnits(requiredFloat * 2n, USDT_DECIMALS)} test USDT for two deals`);
  }

  const transactions: TxEvidence[] = [];
  const createEscrow = async (label: string): Promise<string> => {
    const dealId = ethers.hexlify(randomBytes(32));
    const deadline = Math.floor(Date.now() / 1000) + 60 * 60;
    transactions.push(
      await waitForSuccess(
        `${label}:createEscrow`,
        await factory.createEscrow(dealId, buyer, seller, amount, 0, deadline),
        provider,
        localDryRun,
      ),
    );
    const address = await factory.escrowOf(dealId);
    if (address === ethers.ZeroAddress) throw new Error(`${label}: factory did not persist escrow`);
    return address;
  };

  const recoveryAwareForward = async (
    label: string,
    escrowAddress: string,
    stopAfterTransfer = false,
  ): Promise<{ transfer: TxEvidence | null; notify: TxEvidence | null; alreadyFunded: boolean }> => {
    const escrow = new ethers.Contract(escrowAddress, escrowAbi, signer);
    const status = (await escrow.status()) as bigint;
    if (status >= 2n && status <= 7n) return { transfer: null, notify: null, alreadyFunded: true };
    const authoritativeRequired = ((await escrow.amount()) as bigint) + ((await escrow.buyerFee()) as bigint);
    const balance = (await token.balanceOf(escrowAddress)) as bigint;
    let transfer: TxEvidence | null = null;
    if (balance < authoritativeRequired) {
      transfer = await waitForSuccess(
        `${label}:transfer`,
        await token.transfer(escrowAddress, authoritativeRequired - balance),
        provider,
        localDryRun,
      );
      transactions.push(transfer);
    }
    if (stopAfterTransfer) return { transfer, notify: null, alreadyFunded: false };
    const notify = await waitForSuccess(`${label}:notifyFunded`, await escrow.notifyFunded(), provider, localDryRun);
    transactions.push(notify);
    return { transfer, notify, alreadyFunded: false };
  };

  const happyEscrow = await createEscrow("happy");
  await recoveryAwareForward("happy", happyEscrow);
  const happyContract = new ethers.Contract(happyEscrow, escrowAbi, deployer);
  transactions.push(await waitForSuccess("happy:release", await happyContract.release(), provider, localDryRun));

  const recoveryEscrow = await createEscrow("recovery");
  const relayBeforeInjectedTransfer = (await token.balanceOf(relay)) as bigint;
  const interrupted = await recoveryAwareForward("recovery", recoveryEscrow, true);
  if (!interrupted.transfer || interrupted.notify) throw new Error("Injected interruption did not stop after transfer");
  const relayAfterInjectedTransfer = (await token.balanceOf(relay)) as bigint;
  if (relayBeforeInjectedTransfer - relayAfterInjectedTransfer !== requiredFloat) {
    throw new Error("Injected recovery transfer did not debit exactly one required float");
  }
  const recovered = await recoveryAwareForward("recovery", recoveryEscrow);
  if (recovered.transfer || !recovered.notify) throw new Error("Recovery must skip transfer and perform only notifyFunded");
  const replay = await recoveryAwareForward("recovery-replay", recoveryEscrow);
  if (!replay.alreadyFunded || replay.transfer || replay.notify) throw new Error("Funded replay was not a complete no-op");
  if ((await token.balanceOf(relay)) !== relayAfterInjectedTransfer) {
    throw new Error("Recovery or replay debited the relay a second time");
  }

  const finalRelayUsdt = (await token.balanceOf(relay)) as bigint;
  const finalSellerUsdt = (await token.balanceOf(seller)) as bigint;
  const finalTreasuryUsdt = (await token.balanceOf(deployment.contracts.platformTreasury)) as bigint;
  const finalTreasuryMain = (await treasury.mainBalance()) as bigint;
  const finalTreasuryReserve = (await treasury.reserveBalance()) as bigint;
  const happyStatus = (await new ethers.Contract(happyEscrow, escrowAbi, provider).status()) as bigint;
  const recoveryStatus = (await new ethers.Contract(recoveryEscrow, escrowAbi, provider).status()) as bigint;
  if (happyStatus !== 3n || recoveryStatus !== 2n) throw new Error("Final escrow statuses do not match RELEASED/FUNDED");
  if (finalSellerUsdt - initialSellerUsdt !== amount - sellerFee) throw new Error("Seller payout is incorrect");
  if (finalTreasuryUsdt - initialTreasuryUsdt !== totalFee) throw new Error("Treasury fee receipt is incorrect");
  if (initialRelayUsdt - finalRelayUsdt !== requiredFloat * 2n) throw new Error("Relay float debit is not exactly two deals");
  if (transactions.some((tx) => !tx.signature.lowS)) throw new Error("At least one transaction has a high-s signature");

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    result: "PASS",
    network: localDryRun ? "hardhat-local-dry-run" : "polygon-amoy",
    chainId: Number(network.chainId),
    wallets: { deployer: deployer.address, relay, buyer, seller },
    contracts: deployment.contracts,
    amounts: {
      dealUsdt: ethers.formatUnits(amount, USDT_DECIMALS),
      totalFeeUsdt: ethers.formatUnits(totalFee, USDT_DECIMALS),
      buyerFeeUsdt: ethers.formatUnits(buyerFee, USDT_DECIMALS),
      sellerFeeUsdt: ethers.formatUnits(sellerFee, USDT_DECIMALS),
      requiredFloatPerDealUsdt: ethers.formatUnits(requiredFloat, USDT_DECIMALS),
    },
    escrows: {
      happy: { address: happyEscrow, finalStatus: Number(happyStatus) },
      recovery: { address: recoveryEscrow, finalStatus: Number(recoveryStatus) },
    },
    assertions: {
      web3SignerAccountMatched: true,
      relayRoleMatched: true,
      happyPathReleased: true,
      sellerPayoutMatched: true,
      treasuryFeeMatched: true,
      recoverySkippedSecondTransfer: true,
      fundedReplayWasNoOp: true,
      allSignaturesLowS: true,
    },
    balances: {
      relayUsdtBefore: ethers.formatUnits(initialRelayUsdt, USDT_DECIMALS),
      relayUsdtAfter: ethers.formatUnits(finalRelayUsdt, USDT_DECIMALS),
      sellerUsdtDelta: ethers.formatUnits(finalSellerUsdt - initialSellerUsdt, USDT_DECIMALS),
      treasuryUsdtDelta: ethers.formatUnits(finalTreasuryUsdt - initialTreasuryUsdt, USDT_DECIMALS),
      treasuryMainUsdt: ethers.formatUnits(finalTreasuryMain, USDT_DECIMALS),
      treasuryReserveUsdt: ethers.formatUnits(finalTreasuryReserve, USDT_DECIMALS),
      relayPolBefore: ethers.formatEther(initialRelayPol),
      relayPolAfter: ethers.formatEther(await provider.getBalance(relay)),
      deployerPolBefore: ethers.formatEther(initialDeployerPol),
      deployerPolAfter: ethers.formatEther(await provider.getBalance(deployer.address)),
    },
    transactions,
  };

  const reportPath = path.resolve(
    process.env.AMOY_ACCEPTANCE_REPORT ?? path.join(__dirname, "..", "..", "..", ".local-e2e", "amoy-acceptance-report.json"),
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
