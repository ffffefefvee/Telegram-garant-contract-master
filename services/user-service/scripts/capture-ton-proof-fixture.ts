import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { Address, Cell, loadShardIdent } from "@ton/core";
import {
  LiteClient,
  LiteRoundRobinEngine,
  LiteSingleEngine,
  type LiteEngine,
} from "ton-lite-client";
import { Codecs, Functions } from "ton-lite-client/dist/schema";
import type {
  liteServer_partialBlockProof,
  tonNode_blockIdExt,
} from "ton-lite-client/dist/schema";
import { TLWriteBuffer } from "ton-tl";

type Network = "mainnet" | "testnet";

interface CaptureArguments {
  network: Network;
  masterAddress: Address;
  ownerAddress: Address;
  walletAddress: Address;
  outputDirectory: string;
}

interface GlobalConfig {
  liteservers: Array<{
    ip: number;
    port: number;
    id: { "@type": "pub.ed25519"; key: string };
  }>;
  validator: {
    zero_state: {
      workchain: number;
      shard: number;
      seqno: number;
      root_hash: string;
      file_hash: string;
    };
  };
}

const NETWORKS = {
  mainnet: {
    globalId: -239,
    configUrl: "https://ton.org/global.config.json",
  },
  testnet: {
    globalId: -3,
    configUrl: "https://ton.org/testnet-global.config.json",
  },
} as const;

const MASTERCHAIN_SHARD = "-9223372036854775808";
const BLOCK_TAG = 0x11ef55aa;
const BLOCK_INFO_TAG = 0x9bc7a987;
const ORDINARY_SIGNATURE_SET_ID = 0xf644a6e6 | 0;
const SIMPLEX_SIGNATURE_SET_ID = 0xac249800 | 0;

function fail(message: string): never {
  throw new Error(`TON_FIXTURE_CAPTURE_FAILED: ${message}`);
}

function parseArguments(argv: string[]): CaptureArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("arguments must be --name value pairs");
    }
    if (values.has(key)) fail(`duplicate argument ${key}`);
    values.set(key, value);
  }
  const network = values.get("--network");
  if (network !== "mainnet" && network !== "testnet") {
    fail("--network must be mainnet or testnet");
  }
  const expected = ["--network", "--master", "--owner", "--wallet", "--output"];
  if (
    values.size !== expected.length ||
    expected.some((key) => !values.has(key))
  ) {
    fail(`required arguments: ${expected.join(" ")}`);
  }
  const address = (key: string): Address => {
    const raw = values.get(key)!;
    if (!/^-?\d+:[0-9a-f]{64}$/.test(raw)) {
      fail(`${key} must use canonical raw lowercase form`);
    }
    const parsed = Address.parseRaw(raw);
    if (parsed.toRawString() !== raw) fail(`${key} is not canonical`);
    return parsed;
  };
  return {
    network,
    masterAddress: address("--master"),
    ownerAddress: address("--owner"),
    walletAddress: address("--wallet"),
    outputDirectory: resolve(values.get("--output")!),
  };
}

function ipFromSignedInteger(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function blockId(value: tonNode_blockIdExt) {
  return {
    workchain: value.workchain,
    shard: value.shard,
    seqno: value.seqno,
    rootHash: value.rootHash.toString("hex"),
    fileHash: value.fileHash.toString("hex"),
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function previousKeyBlockSeqno(headerProof: Buffer): number {
  const roots = Cell.fromBoc(headerProof);
  if (roots.length !== 1 || roots[0].refs.length !== 1) {
    fail("masterchain header proof has an unexpected root shape");
  }
  const block = roots[0].refs[0].beginParse();
  if (block.loadUint(32) !== BLOCK_TAG) fail("header proof is not a TON Block");
  block.loadInt(32);
  const infoCell = block.loadRef();
  block.loadRef();
  block.loadRef();
  block.loadRef();
  block.endParse();

  const info = infoCell.beginParse();
  if (info.loadUint(32) !== BLOCK_INFO_TAG) fail("invalid BlockInfo tag");
  if (info.loadUint(32) !== 0) fail("unsupported BlockInfo version");
  info.loadBit();
  info.loadBit();
  info.loadBit();
  info.loadBit();
  info.loadBit();
  info.loadBit();
  info.loadBit();
  info.loadBit();
  const flags = info.loadUint(8);
  info.loadUint(32);
  info.loadUint(32);
  const shard = loadShardIdent(info);
  if (shard.workchainId !== -1 || shard.shardPrefixBits !== 0) {
    fail("header proof is not a masterchain block");
  }
  info.loadUint(32);
  info.loadUintBig(64);
  info.loadUintBig(64);
  info.loadUint(32);
  info.loadUint(32);
  info.loadUint(32);
  const previousKeyBlock = info.loadUint(32);
  if ((flags & 1) !== 0) {
    info.loadUint(8);
    info.loadUint(32);
    info.loadUintBig(64);
  }
  return previousKeyBlock;
}

function encodePartialBlockProof(value: liteServer_partialBlockProof): Buffer {
  const writer = new TLWriteBuffer();
  Codecs.liteServer_PartialBlockProof.encode(value, writer);
  return writer.build();
}

/**
 * ton-lite-client 3.1.1 predates the current LiteServer Simplex constructor.
 * Patch only its generated SignatureSet union codec using the authoritative
 * `lite_api.tl` field order. The captured raw bytes are independently decoded
 * and verified by the proof kernel; this compatibility shim is not a verifier.
 */
function installSimplexCaptureCodec(): void {
  const codec = Codecs.liteServer_SignatureSet as any;
  codec.decode = (decoder: any) => {
    const kind = decoder.readInt32();
    if (kind === ORDINARY_SIGNATURE_SET_ID) {
      return {
        kind: "liteServer.signatureSet.ordinary",
        validatorSetHash: decoder.readInt32(),
        catchainSeqno: decoder.readInt32(),
        signatures: decoder.readVector(Codecs.liteServer_signature.decode),
      };
    }
    if (kind === SIMPLEX_SIGNATURE_SET_ID) {
      return {
        kind: "liteServer.signatureSet.simplex",
        ccSeqno: decoder.readInt32(),
        validatorSetHash: decoder.readInt32(),
        signatures: decoder.readVector(Codecs.liteServer_signature.decode),
        sessionId: decoder.readInt256(),
        slot: decoder.readInt32(),
        candidate: decoder.readBuffer(),
      };
    }
    fail(`unsupported LiteServer SignatureSet constructor 0x${(kind >>> 0).toString(16)}`);
  };
  codec.encode = (value: any, encoder: TLWriteBuffer) => {
    if (value.kind === "liteServer.signatureSet.ordinary") {
      encoder.writeInt32(ORDINARY_SIGNATURE_SET_ID);
      encoder.writeInt32(value.validatorSetHash);
      encoder.writeInt32(value.catchainSeqno);
      encoder.writeVector(Codecs.liteServer_signature.encode, value.signatures);
      return;
    }
    if (value.kind === "liteServer.signatureSet.simplex") {
      encoder.writeInt32(SIMPLEX_SIGNATURE_SET_ID);
      encoder.writeInt32(value.ccSeqno);
      encoder.writeInt32(value.validatorSetHash);
      encoder.writeVector(Codecs.liteServer_signature.encode, value.signatures);
      encoder.writeInt256(value.sessionId);
      encoder.writeInt32(value.slot);
      encoder.writeBuffer(value.candidate);
      return;
    }
    fail("unsupported LiteServer SignatureSet value");
  };
}

async function storeArtifacts(
  outputDirectory: string,
  artifacts: Record<string, Buffer>,
): Promise<Record<string, { bytes: number; sha256: string }>> {
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  const manifest: Record<string, { bytes: number; sha256: string }> = {};
  for (const [name, value] of Object.entries(artifacts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!/^[a-z0-9][a-z0-9.-]{1,127}$/.test(name)) {
      fail(`artifact name ${name} is unsafe`);
    }
    await writeFile(resolve(outputDirectory, name), value, { flag: "wx" });
    manifest[name] = { bytes: value.length, sha256: sha256(value) };
  }
  return manifest;
}

async function capture(args: CaptureArguments): Promise<void> {
  const stage = (message: string): void => {
    process.stdout.write(`[ton-fixture:${args.network}] ${message}\n`);
  };
  const network = NETWORKS[args.network];
  installSimplexCaptureCodec();
  stage("downloading official global config");
  const configResponse = await fetch(network.configUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!configResponse.ok) fail(`global config returned ${configResponse.status}`);
  const configBytes = Buffer.from(await configResponse.arrayBuffer());
  const config = JSON.parse(configBytes.toString("utf8")) as GlobalConfig;
  if (!Array.isArray(config.liteservers) || config.liteservers.length < 2) {
    fail("global config does not contain an independent LiteServer pool");
  }
  const engines: LiteEngine[] = config.liteservers.map(
    (server) =>
      new LiteSingleEngine({
        host: `tcp://${ipFromSignedInteger(server.ip)}:${server.port}`,
        publicKey: Buffer.from(server.id.key, "base64"),
      }),
  );
  const engine = new LiteRoundRobinEngine(engines);
  const client = new LiteClient({ engine });
  try {
    const queryArgs = { timeout: 60_000 };
    stage(`querying ${engines.length} configured LiteServers`);
    const masterchain = await client.getMasterchainInfo(queryArgs);
    if (
      masterchain.last.workchain !== -1 ||
      masterchain.last.shard !== MASTERCHAIN_SHARD ||
      masterchain.init.rootHash.toString("base64") !==
        config.validator.zero_state.root_hash ||
      masterchain.init.fileHash.toString("base64") !==
        config.validator.zero_state.file_hash
    ) {
      fail("LiteServer masterchain identity does not match official config");
    }
    stage(`capturing masterchain ${masterchain.last.seqno}`);
    const targetHeader = await client.getBlockHeader(masterchain.last);
    const trustedSeqno = previousKeyBlockSeqno(targetHeader.headerProof);
    const trustedLookup = await client.lookupBlockByID({
      workchain: -1,
      shard: MASTERCHAIN_SHARD,
      seqno: trustedSeqno,
    });
    const checkpoint = await engine.query(
      Functions.liteServer_getBlockProof,
      {
        kind: "liteServer.getBlockProof",
        mode: 1,
        knownBlock: trustedLookup.id,
        targetBlock: masterchain.last,
      },
      queryArgs,
    );
    if (
      !checkpoint.complete ||
      checkpoint.from.seqno !== trustedSeqno ||
      checkpoint.to.seqno !== masterchain.last.seqno ||
      checkpoint.steps.length < 1
    ) {
      fail("LiteServer did not return a complete checkpoint proof");
    }
    stage(`verified complete checkpoint response with ${checkpoint.steps.length} link(s)`);
    const configInfo = await engine.query(
      Functions.liteServer_getConfigAll,
      { kind: "liteServer.getConfigAll", mode: 0, id: masterchain.last },
      queryArgs,
    );
    const allShards = await client.getAllShardsInfo(masterchain.last);
    const [masterAccount, walletAccount] = await Promise.all([
      client.getAccountStateRaw(args.masterAddress, masterchain.last, queryArgs),
      client.getAccountStateRaw(args.walletAddress, masterchain.last, queryArgs),
    ]);
    if (!masterAccount.state || !walletAccount.state) {
      fail("master and wallet accounts must both be active");
    }
    stage("captured active master and wallet account proofs");
    const [masterShardHeader, walletShardHeader] = await Promise.all([
      client.getBlockHeader(masterAccount.shardBlock),
      client.getBlockHeader(walletAccount.shardBlock),
    ]);
    const transactions = await engine.query(
      Functions.liteServer_listBlockTransactions,
      {
        kind: "liteServer.listBlockTransactions",
        id: walletAccount.shardBlock,
        mode: 1 + 2 + 4 + 32,
        count: 1,
        after: null,
        reverseOrder: null,
        wantProof: true,
      },
      queryArgs,
    );
    const selected = transactions.ids[0];
    if (!selected?.account || !selected.lt || !selected.hash) {
      fail("wallet shard top contains no complete transaction identity");
    }
    const transactionAddress = new Address(
      walletAccount.shardBlock.workchain,
      selected.account,
    );
    const transaction = await client.getAccountTransaction(
      transactionAddress,
      selected.lt,
      walletAccount.shardBlock,
      queryArgs,
    );
    const transactionRoots = Cell.fromBoc(transaction.transaction);
    if (
      transactionRoots.length !== 1 ||
      !transaction.id.rootHash.equals(walletAccount.shardBlock.rootHash) ||
      !transaction.id.fileHash.equals(walletAccount.shardBlock.fileHash) ||
      transaction.id.seqno !== walletAccount.shardBlock.seqno ||
      transactionRoots[0].hash(0).toString("hex") !== selected.hash.toString("hex")
    ) {
      fail("selected transaction response is not bound to the wallet shard block");
    }

    stage("writing immutable artifact set");

    const artifacts = await storeArtifacts(args.outputDirectory, {
      "official-global-config.json": configBytes,
      "checkpoint-proof.tl": encodePartialBlockProof(checkpoint),
      "masterchain-header-proof.boc": targetHeader.headerProof,
      "masterchain-config-state-proof.boc": configInfo.stateProof,
      "masterchain-config-proof.boc": configInfo.configProof,
      "masterchain-shards-proof.boc": allShards.proof,
      "masterchain-shards-data.boc": allShards.raw,
      "master-account-proof.boc": masterAccount.proof,
      "master-account-state.boc": masterAccount.raw,
      "master-account-shard-proof.boc": masterAccount.shardProof,
      "master-account-shard-header-proof.boc": masterShardHeader.headerProof,
      "wallet-account-proof.boc": walletAccount.proof,
      "wallet-account-state.boc": walletAccount.raw,
      "wallet-account-shard-proof.boc": walletAccount.shardProof,
      "wallet-account-shard-header-proof.boc": walletShardHeader.headerProof,
      "wallet-shard-transactions-proof.boc": transactions.proof,
      "transaction-inclusion-proof.boc": transaction.proof,
      "transaction.boc": transaction.transaction,
    });
    const manifest = {
      schemaVersion: 1,
      kind: "TON_CAPTURED_PROOF_FIXTURE",
      network: args.network,
      globalId: network.globalId,
      capturedAtUnix: Math.floor(Date.now() / 1000),
      source: {
        globalConfigUrl: network.configUrl,
        liteServerCount: config.liteservers.length,
        captureTool: "scripts/capture-ton-proof-fixture.ts",
      },
      zeroState: blockId({
        kind: "tonNode.blockIdExt",
        workchain: config.validator.zero_state.workchain,
        shard: config.validator.zero_state.shard.toString(),
        seqno: config.validator.zero_state.seqno,
        rootHash: Buffer.from(config.validator.zero_state.root_hash, "base64"),
        fileHash: Buffer.from(config.validator.zero_state.file_hash, "base64"),
      }),
      trustedKeyBlock: blockId(trustedLookup.id),
      targetMasterchainBlock: blockId(masterchain.last),
      masterAddress: args.masterAddress.toRawString(),
      ownerAddress: args.ownerAddress.toRawString(),
      walletAddress: args.walletAddress.toRawString(),
      masterShardBlock: blockId(masterAccount.shardBlock),
      walletShardBlock: blockId(walletAccount.shardBlock),
      masterLastTransaction: masterAccount.lastTx
        ? {
            lt: masterAccount.lastTx.lt,
            hash: masterAccount.lastTx.hash.toString(16).padStart(64, "0"),
          }
        : null,
      walletLastTransaction: walletAccount.lastTx
        ? {
            lt: walletAccount.lastTx.lt,
            hash: walletAccount.lastTx.hash.toString(16).padStart(64, "0"),
          }
        : null,
      selectedShardTransaction: {
        accountAddress: transactionAddress.toRawString(),
        lt: selected.lt,
        hash: selected.hash.toString("hex"),
      },
      artifacts,
    };
    await writeFile(
      resolve(args.outputDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );
    process.stdout.write(
      `Captured ${args.network} fixture at masterchain ${masterchain.last.seqno} in ${args.outputDirectory}\n`,
    );
  } finally {
    engine.close();
  }
}

void capture(parseArguments(process.argv.slice(2))).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
