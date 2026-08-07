import { randomBytes } from "crypto";
import { ethers } from "ethers";
import { Web3SignerSigner } from "../src/modules/blockchain/web3signer.signer";

const CHAIN_ID = 80002;
const USDT_DECIMALS = 6;
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
  "function status() view returns (uint8)",
  "function amount() view returns (uint256)",
  "function buyerFee() view returns (uint256)",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function signatureSummary(tx: ethers.TransactionResponse): {
  v: number;
  lowS: boolean;
} {
  if (!tx.signature) throw new Error(`Transaction ${tx.hash} has no signature`);
  const signature = ethers.Signature.from(tx.signature);
  return {
    v: signature.v,
    lowS: BigInt(signature.s) <= HALF_SECP256K1_ORDER,
  };
}

async function waitForSuccess(
  tx: ethers.ContractTransactionResponse,
  provider: ethers.JsonRpcProvider,
): Promise<{
  hash: string;
  gasUsed: string;
  status: number;
  signature: { v: number; lowS: boolean };
}> {
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction ${tx.hash} did not succeed`);
  }
  const onChainTx = await provider.getTransaction(tx.hash);
  if (!onChainTx) throw new Error(`Transaction ${tx.hash} cannot be read back`);
  return {
    hash: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    signature: signatureSummary(onChainTx),
  };
}

async function main(): Promise<void> {
  if (process.env.RUN_AMOY_WEB3SIGNER_E2E !== "true") {
    throw new Error(
      "Refusing to move testnet funds. Set RUN_AMOY_WEB3SIGNER_E2E=true explicitly.",
    );
  }
  if (process.env.MONEY_EGRESS_ENABLED !== "true") {
    throw new Error(
      "MONEY_EGRESS_ENABLED=true is required for this explicit acceptance run",
    );
  }

  const provider = new ethers.JsonRpcProvider(requireEnv("BLOCKCHAIN_RPC_URL"));
  const signer = new Web3SignerSigner(
    requireEnv("WEB3SIGNER_RPC_URL"),
    requireEnv("WEB3SIGNER_ADDRESS"),
    CHAIN_ID,
    provider,
  );
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(CHAIN_ID)) {
    throw new Error(`Expected Amoy chain ${CHAIN_ID}, got ${network.chainId}`);
  }
  await signer.assertConfiguredAccount();

  const relay = await signer.getAddress();
  const factory = new ethers.Contract(
    requireEnv("ESCROW_FACTORY_ADDRESS"),
    factoryAbi,
    signer,
  );
  const token = new ethers.Contract(
    requireEnv("USDT_CONTRACT_ADDRESS"),
    erc20Abi,
    signer,
  );
  const buyer = ethers.getAddress(requireEnv("AMOY_TEST_BUYER_ADDRESS"));
  const seller = ethers.getAddress(requireEnv("AMOY_TEST_SELLER_ADDRESS"));
  const amount = ethers.parseUnits(
    requireEnv("AMOY_ACCEPTANCE_AMOUNT_USDT"),
    USDT_DECIMALS,
  );
  const dealId =
    process.env.AMOY_ACCEPTANCE_DEAL_ID ?? ethers.hexlify(randomBytes(32));
  if (!ethers.isHexString(dealId, 32)) {
    throw new Error("AMOY_ACCEPTANCE_DEAL_ID must be a 32-byte hex value");
  }

  const relayRole = await factory.RELAY_ROLE();
  if ((await factory.relay()).toLowerCase() !== relay.toLowerCase()) {
    throw new Error("Factory relay address does not match Web3Signer address");
  }
  if (!(await factory.hasRole(relayRole, relay))) {
    throw new Error("Web3Signer address lacks the factory RELAY_ROLE");
  }

  const totalFee = await factory.computeTotalFee(amount);
  const [buyerFee] = await factory.splitFee(totalFee, 0); // SPLIT_50_50
  const requiredFloat = amount + buyerFee;
  const relayBalance = await token.balanceOf(relay);
  if (relayBalance < requiredFloat) {
    throw new Error(
      `Relay USDT float ${relayBalance} is less than required ${requiredFloat}`,
    );
  }

  const deadline = Math.floor(Date.now() / 1000) + 60 * 60;
  const createTx = await factory.createEscrow(
    dealId,
    buyer,
    seller,
    amount,
    0, // SPLIT_50_50
    deadline,
  );
  const createEscrow = await waitForSuccess(createTx, provider);
  const escrowAddress = await factory.escrowOf(dealId);
  if (escrowAddress === ethers.ZeroAddress) {
    throw new Error("EscrowFactory did not persist an escrow address");
  }

  const transferTx = await token.transfer(escrowAddress, requiredFloat);
  const transfer = await waitForSuccess(transferTx, provider);
  const escrow = new ethers.Contract(escrowAddress, escrowAbi, signer);
  const notifyTx = await escrow.notifyFunded();
  const notifyFunded = await waitForSuccess(notifyTx, provider);
  const status = await escrow.status();
  const onChainAmount = await escrow.amount();
  const onChainBuyerFee = await escrow.buyerFee();
  if (
    onChainAmount !== amount ||
    onChainBuyerFee !== buyerFee ||
    status !== 2n
  ) {
    throw new Error(
      "Escrow funded state or USDT float does not match expectations",
    );
  }

  console.log(
    JSON.stringify(
      {
        network: "polygon-amoy",
        chainId: Number(network.chainId),
        signer: relay,
        dealId,
        escrowAddress,
        amountUsdt: ethers.formatUnits(amount, USDT_DECIMALS),
        buyerFeeUsdt: ethers.formatUnits(buyerFee, USDT_DECIMALS),
        requiredFloatUsdt: ethers.formatUnits(requiredFloat, USDT_DECIMALS),
        createEscrow,
        forwardAndFund: {
          transfer,
          notifyFunded,
          escrowStatus: Number(status),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
