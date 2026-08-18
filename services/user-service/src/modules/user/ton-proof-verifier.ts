import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  Address,
  Cell,
  contractAddress,
  domainSignVerify,
  loadStateInit,
  Slice,
  StateInit,
  WalletContractV1R1,
  WalletContractV1R2,
  WalletContractV1R3,
  WalletContractV2R1,
  WalletContractV2R2,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
} from "@ton/ton";
import { TonNetwork } from "./entities/ton-wallet-binding.entity";
import { TonConnectAccountDto, TonProofDto } from "./ton-wallet.dto";

const TON_PROOF_PREFIX = Buffer.from("ton-proof-item-v2/", "utf8");
const TON_CONNECT_PREFIX = Buffer.from("ton-connect", "utf8");
const MAX_DOMAIN_BYTES = 128;
const MAX_PAYLOAD_BYTES = 128;
const MAX_COMBINED_BYTES = 222;

export class TonProofVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TonProofVerificationError";
  }
}

export interface VerifyTonProofOptions {
  expectedDomain: string;
  expectedNetwork: TonNetwork;
  expectedPayload: string;
  maxAgeSeconds: number;
  futureSkewSeconds: number;
  nowSeconds?: number;
}

export interface VerifiedTonProof {
  address: string;
  network: TonNetwork;
  publicKey: string;
  walletStateInit: string;
  timestamp: number;
}

type WalletPublicKeyLoader = (slice: Slice) => Buffer;

function loadV1(slice: Slice): Buffer {
  slice.loadUint(32);
  return slice.loadBuffer(32);
}

function loadV2(slice: Slice): Buffer {
  slice.loadUint(32);
  return slice.loadBuffer(32);
}

function loadV3(slice: Slice): Buffer {
  slice.loadUint(32);
  slice.loadUint(32);
  return slice.loadBuffer(32);
}

function loadV4(slice: Slice): Buffer {
  slice.loadUint(32);
  slice.loadUint(32);
  return slice.loadBuffer(32);
}

function loadV5(slice: Slice): Buffer {
  slice.loadBoolean();
  slice.loadUint(32);
  slice.loadUint(32);
  return slice.loadBuffer(32);
}

// This list and the version-specific data parsers follow the official TON
// Connect backend example. Unknown wallet contracts deliberately fail closed;
// a trusted on-chain get_public_key resolver can be added later.
const KNOWN_WALLETS: Array<{ code: Cell; load: WalletPublicKeyLoader }> = [
  { contract: WalletContractV1R1, load: loadV1 },
  { contract: WalletContractV1R2, load: loadV1 },
  { contract: WalletContractV1R3, load: loadV1 },
  { contract: WalletContractV2R1, load: loadV2 },
  { contract: WalletContractV2R2, load: loadV2 },
  { contract: WalletContractV3R1, load: loadV3 },
  { contract: WalletContractV3R2, load: loadV3 },
  { contract: WalletContractV4, load: loadV4 },
  { contract: WalletContractV5R1, load: loadV5 },
].map(({ contract, load }) => ({
  code: contract.create({ workchain: 0, publicKey: Buffer.alloc(32) }).init
    .code,
  load,
}));

export function tryExtractTonWalletPublicKey(
  stateInit: StateInit,
): Buffer | null {
  if (!stateInit.code || !stateInit.data) return null;

  for (const wallet of KNOWN_WALLETS) {
    try {
      if (wallet.code.equals(stateInit.code)) {
        return wallet.load(stateInit.data.beginParse());
      }
    } catch {
      // A matching code with malformed data is not accepted. Continue only so
      // the helper has one uniform fail-closed return path.
    }
  }
  return null;
}

@Injectable()
export class TonProofVerifier {
  verify(
    account: TonConnectAccountDto,
    proof: TonProofDto,
    options: VerifyTonProofOptions,
  ): VerifiedTonProof {
    if (account.chain !== options.expectedNetwork) {
      throw new TonProofVerificationError("Unexpected TON network");
    }
    if (proof.domain.value !== options.expectedDomain) {
      throw new TonProofVerificationError("Unexpected TON proof domain");
    }
    if (proof.payload !== options.expectedPayload) {
      throw new TonProofVerificationError("Unexpected TON proof payload");
    }

    const domainBytes = Buffer.from(proof.domain.value, "utf8");
    const payloadBytes = Buffer.from(proof.payload, "utf8");
    if (
      proof.domain.lengthBytes !== domainBytes.length ||
      domainBytes.length > MAX_DOMAIN_BYTES
    ) {
      throw new TonProofVerificationError("Invalid TON proof domain length");
    }
    if (
      payloadBytes.length > MAX_PAYLOAD_BYTES ||
      domainBytes.length + payloadBytes.length > MAX_COMBINED_BYTES
    ) {
      throw new TonProofVerificationError("TON proof payload is too long");
    }

    const timestamp = normalizeTimestamp(proof.timestamp);
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (timestamp < now - options.maxAgeSeconds) {
      throw new TonProofVerificationError("TON proof has expired");
    }
    if (timestamp > now + options.futureSkewSeconds) {
      throw new TonProofVerificationError(
        "TON proof timestamp is in the future",
      );
    }

    let address: Address;
    let stateInit: StateInit;
    try {
      address = Address.parse(account.address);
      if (address.workChain !== 0) {
        throw new Error("wallet is not in the base workchain");
      }
      stateInit = loadStateInit(
        Cell.fromBase64(account.walletStateInit).beginParse(),
      );
    } catch {
      throw new TonProofVerificationError("Invalid TON account data");
    }

    const derivedAddress = contractAddress(address.workChain, stateInit);
    if (!derivedAddress.equals(address)) {
      throw new TonProofVerificationError(
        "TON wallet StateInit does not match the account address",
      );
    }

    const extractedPublicKey = tryExtractTonWalletPublicKey(stateInit);
    if (!extractedPublicKey) {
      throw new TonProofVerificationError("Unsupported TON wallet contract");
    }
    const reportedPublicKey = decodeHexPublicKey(account.publicKey);
    if (!timingSafeEqual(extractedPublicKey, reportedPublicKey)) {
      throw new TonProofVerificationError("TON wallet public key mismatch");
    }

    const signature = decodeBase64Signature(proof.signature);
    const digest = buildTonProofDigest(
      address,
      proof,
      domainBytes,
      payloadBytes,
    );
    const validSignature = domainSignVerify({
      data: digest,
      signature,
      publicKey: extractedPublicKey,
      // Current TON mainnet and testnet use the empty signature domain.
      domain: { type: "empty" },
    });
    if (!validSignature) {
      throw new TonProofVerificationError("Invalid TON proof signature");
    }

    return {
      address: address.toRawString().toLowerCase(),
      network: account.chain,
      publicKey: extractedPublicKey.toString("hex"),
      walletStateInit: account.walletStateInit,
      timestamp,
    };
  }
}

export function buildTonProofDigest(
  address: Address,
  proof: Pick<TonProofDto, "timestamp" | "domain" | "payload">,
  domainBytes = Buffer.from(proof.domain.value, "utf8"),
  payloadBytes = Buffer.from(proof.payload, "utf8"),
): Buffer {
  const timestamp = normalizeTimestamp(proof.timestamp);
  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workChain, 0);
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(proof.domain.lengthBytes, 0);
  const timestampBytes = Buffer.alloc(8);
  timestampBytes.writeBigUInt64LE(BigInt(timestamp), 0);

  const message = Buffer.concat([
    TON_PROOF_PREFIX,
    workchain,
    Buffer.from(address.hash),
    domainLength,
    domainBytes,
    timestampBytes,
    payloadBytes,
  ]);
  const innerHash = createHash("sha256").update(message).digest();
  return createHash("sha256")
    .update(
      Buffer.concat([Buffer.from([0xff, 0xff]), TON_CONNECT_PREFIX, innerHash]),
    )
    .digest();
}

function normalizeTimestamp(value: number | string): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^\d+$/.test(value))
  ) {
    throw new TonProofVerificationError("Invalid TON proof timestamp");
  }
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TonProofVerificationError("Invalid TON proof timestamp");
  }
  return timestamp;
}

function decodeHexPublicKey(value: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new TonProofVerificationError("Invalid TON wallet public key");
  }
  return Buffer.from(value, "hex");
}

function decodeBase64Signature(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new TonProofVerificationError("Invalid TON proof signature encoding");
  }
  const signature = Buffer.from(value, "base64");
  if (signature.length !== 64) {
    throw new TonProofVerificationError("Invalid TON proof signature length");
  }
  return signature;
}
