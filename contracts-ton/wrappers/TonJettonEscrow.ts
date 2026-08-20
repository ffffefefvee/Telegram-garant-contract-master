import {
  Address,
  beginCell,
  Cell,
  Contract,
  ContractABI,
  contractAddress,
  ContractProvider,
  Sender,
  SendMode,
} from "@ton/core";

export const TON_JETTON_ESCROW_STATUS = {
  AWAITING_FUNDING: 0,
  FUNDED: 1,
} as const;

export const TON_JETTON_ESCROW_OP = {
  SEAL_CANONICAL_JETTON_WALLET: 0x6a736561,
  TRANSFER_NOTIFICATION: 0x7362d09c,
} as const;

const UINT64_LIMIT = 1n << 64n;
const UINT256_LIMIT = 1n << 256n;
const COINS_LIMIT = 1n << 120n;

export type TonJettonEscrowConfig = {
  dealId: bigint;
  termsHash: bigint;
  quoteHash: bigint;
  fundingDeadline: bigint;
  expectedQueryId: bigint;
  forwardPayloadHash: bigint;
  buyer: Address;
  seller: Address;
  arbitrator: Address;
  treasury: Address;
  initializer: Address;
  reconciliation: Address;
  master: Address;
  walletCodeHash: bigint;
  buyerTotal: bigint;
  sellerPayout: bigint;
  platformFee: bigint;
  refundToBuyer: bigint;
  refundFee: bigint;
};

export type TonJettonWalletSeal = {
  queryId: bigint;
  wallet: Address;
  walletCodeHash: bigint;
  verificationEvidenceHash: bigint;
};

export type TonJettonTransferNotification = {
  queryId: bigint;
  amount: bigint;
  sender: Address;
  forwardPayload: Cell;
  forwardPayloadByReference?: boolean;
};

type SendOptions = { value: bigint };

function assertUint(
  name: string,
  value: bigint,
  limit: bigint,
  nonZero = false,
): void {
  if (value < 0n || value >= limit || (nonZero && value === 0n)) {
    const range = nonZero ? `1..${limit - 1n}` : `0..${limit - 1n}`;
    throw new RangeError(`${name} must be in ${range}`);
  }
}

function assertCoins(name: string, value: bigint): void {
  assertUint(name, value, COINS_LIMIT);
}

function assertDistinctAddresses(
  entries: ReadonlyArray<readonly [string, Address]>,
): void {
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (entries[left][1].equals(entries[right][1])) {
        throw new Error(
          `${entries[left][0]} and ${entries[right][0]} must be distinct`,
        );
      }
    }
  }
}

export function validateTonJettonEscrowConfig(
  config: TonJettonEscrowConfig,
): void {
  assertUint("dealId", config.dealId, UINT256_LIMIT, true);
  assertUint("termsHash", config.termsHash, UINT256_LIMIT, true);
  assertUint("quoteHash", config.quoteHash, UINT256_LIMIT, true);
  assertUint("fundingDeadline", config.fundingDeadline, UINT64_LIMIT, true);
  assertUint("expectedQueryId", config.expectedQueryId, UINT64_LIMIT, true);
  if (config.expectedQueryId < 2n) {
    throw new RangeError(
      "expectedQueryId must be at least 2 so a positive seal query can precede it",
    );
  }
  assertUint(
    "forwardPayloadHash",
    config.forwardPayloadHash,
    UINT256_LIMIT,
    true,
  );
  assertUint("walletCodeHash", config.walletCodeHash, UINT256_LIMIT, true);

  assertCoins("buyerTotal", config.buyerTotal);
  assertCoins("sellerPayout", config.sellerPayout);
  assertCoins("platformFee", config.platformFee);
  assertCoins("refundToBuyer", config.refundToBuyer);
  assertCoins("refundFee", config.refundFee);
  if (config.buyerTotal === 0n) {
    throw new RangeError("buyerTotal must be positive");
  }
  if (config.sellerPayout + config.platformFee !== config.buyerTotal) {
    throw new Error("sellerPayout + platformFee must equal buyerTotal");
  }
  if (config.refundToBuyer + config.refundFee !== config.buyerTotal) {
    throw new Error("refundToBuyer + refundFee must equal buyerTotal");
  }

  assertDistinctAddresses([
    ["buyer", config.buyer],
    ["seller", config.seller],
    ["arbitrator", config.arbitrator],
    ["treasury", config.treasury],
    ["initializer", config.initializer],
    ["reconciliation", config.reconciliation],
    ["master", config.master],
  ]);
}

export function tonJettonEscrowRolesCell(config: TonJettonEscrowConfig): Cell {
  const tail = beginCell()
    .storeAddress(config.arbitrator)
    .storeAddress(config.treasury)
    .endCell();
  return beginCell()
    .storeAddress(config.buyer)
    .storeAddress(config.seller)
    .storeRef(tail)
    .endCell();
}

export function tonJettonEscrowAuthoritiesCell(
  config: TonJettonEscrowConfig,
): Cell {
  return beginCell()
    .storeAddress(config.initializer)
    .storeAddress(config.reconciliation)
    .endCell();
}

export function tonJettonEscrowAssetCell(config: TonJettonEscrowConfig): Cell {
  return beginCell()
    .storeAddress(config.master)
    .storeUint(config.walletCodeHash, 256)
    .endCell();
}

export function tonJettonEscrowEconomicsCell(
  config: TonJettonEscrowConfig,
): Cell {
  return beginCell()
    .storeCoins(config.buyerTotal)
    .storeCoins(config.sellerPayout)
    .storeCoins(config.platformFee)
    .storeCoins(config.refundToBuyer)
    .storeCoins(config.refundFee)
    .endCell();
}

export function tonJettonEscrowFundingCommitmentCell(
  config: TonJettonEscrowConfig,
): Cell {
  validateTonJettonEscrowConfig(config);
  return beginCell()
    .storeUint(config.expectedQueryId, 64)
    .storeUint(config.forwardPayloadHash, 256)
    .storeRef(tonJettonEscrowRolesCell(config))
    .storeRef(tonJettonEscrowAuthoritiesCell(config))
    .storeRef(tonJettonEscrowAssetCell(config))
    .storeRef(tonJettonEscrowEconomicsCell(config))
    .endCell();
}

export function tonJettonEscrowConfigCell(config: TonJettonEscrowConfig): Cell {
  return beginCell()
    .storeUint(config.dealId, 256)
    .storeUint(config.termsHash, 256)
    .storeUint(config.quoteHash, 256)
    .storeUint(config.fundingDeadline, 64)
    .storeRef(tonJettonEscrowFundingCommitmentCell(config))
    .endCell();
}

export function tonJettonEscrowDataCell(config: TonJettonEscrowConfig): Cell {
  return beginCell()
    .storeUint(TON_JETTON_ESCROW_STATUS.AWAITING_FUNDING, 8)
    .storeUint(0, 8)
    .storeCoins(0)
    .storeUint(0, 64)
    .storeRef(tonJettonEscrowConfigCell(config))
    .storeRef(beginCell().endCell())
    .endCell();
}

function validateWalletSeal(
  seal: TonJettonWalletSeal,
  config?: TonJettonEscrowConfig,
): void {
  assertUint("seal.queryId", seal.queryId, UINT64_LIMIT, true);
  assertUint("seal.walletCodeHash", seal.walletCodeHash, UINT256_LIMIT, true);
  assertUint(
    "seal.verificationEvidenceHash",
    seal.verificationEvidenceHash,
    UINT256_LIMIT,
    true,
  );
  if (config === undefined) {
    return;
  }
  validateTonJettonEscrowConfig(config);
  if (seal.queryId >= config.expectedQueryId) {
    throw new RangeError("seal.queryId must precede expectedQueryId");
  }
  if (seal.walletCodeHash !== config.walletCodeHash) {
    throw new Error("seal.walletCodeHash must equal the pinned walletCodeHash");
  }
  assertDistinctAddresses([
    ["sealed wallet", seal.wallet],
    ["buyer", config.buyer],
    ["seller", config.seller],
    ["arbitrator", config.arbitrator],
    ["treasury", config.treasury],
    ["initializer", config.initializer],
    ["reconciliation", config.reconciliation],
    ["master", config.master],
  ]);
}

export function tonJettonSealCanonicalWalletBody(
  seal: TonJettonWalletSeal,
  config?: TonJettonEscrowConfig,
): Cell {
  validateWalletSeal(seal, config);
  return beginCell()
    .storeUint(TON_JETTON_ESCROW_OP.SEAL_CANONICAL_JETTON_WALLET, 32)
    .storeUint(seal.queryId, 64)
    .storeAddress(seal.wallet)
    .storeUint(seal.walletCodeHash, 256)
    .storeUint(seal.verificationEvidenceHash, 256)
    .endCell();
}

function validateTransferNotification(
  notification: TonJettonTransferNotification,
  config?: TonJettonEscrowConfig,
): void {
  assertUint("notification.queryId", notification.queryId, UINT64_LIMIT, true);
  assertCoins("notification.amount", notification.amount);
  if (notification.amount === 0n) {
    throw new RangeError("notification.amount must be positive");
  }
  if (config === undefined) {
    return;
  }
  validateTonJettonEscrowConfig(config);
  if (notification.queryId !== config.expectedQueryId) {
    throw new Error("notification.queryId must equal expectedQueryId");
  }
  if (notification.amount !== config.buyerTotal) {
    throw new Error("notification.amount must equal buyerTotal");
  }
  if (!notification.sender.equals(config.buyer)) {
    throw new Error("notification.sender must equal buyer");
  }
  if (
    !notification.forwardPayload
      .hash()
      .equals(
        Buffer.from(
          config.forwardPayloadHash.toString(16).padStart(64, "0"),
          "hex",
        ),
      )
  ) {
    throw new Error(
      "notification.forwardPayload must match forwardPayloadHash",
    );
  }
}

export function tonJettonTransferNotificationBody(
  notification: TonJettonTransferNotification,
  config?: TonJettonEscrowConfig,
): Cell {
  validateTransferNotification(notification, config);
  const builder = beginCell()
    .storeUint(TON_JETTON_ESCROW_OP.TRANSFER_NOTIFICATION, 32)
    .storeUint(notification.queryId, 64)
    .storeCoins(notification.amount)
    .storeAddress(notification.sender);
  if (notification.forwardPayloadByReference === true) {
    builder.storeBit(1).storeRef(notification.forwardPayload);
  } else {
    builder.storeBit(0).storeSlice(notification.forwardPayload.beginParse());
  }
  return builder.endCell();
}

export class TonJettonEscrow implements Contract {
  abi: ContractABI = { name: "TonJettonEscrow" };

  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell },
    private readonly config?: TonJettonEscrowConfig,
  ) {}

  static createFromAddress(address: Address): TonJettonEscrow {
    return new TonJettonEscrow(address);
  }

  static createFromConfig(
    config: TonJettonEscrowConfig,
    code: Cell,
    workchain = 0,
  ): TonJettonEscrow {
    const init = { code, data: tonJettonEscrowDataCell(config) };
    return new TonJettonEscrow(contractAddress(workchain, init), init, config);
  }

  async sendDeploy(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
  ): Promise<void> {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    });
  }

  async sendSealCanonicalWallet(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonWalletSeal,
  ): Promise<void> {
    await provider.internal(via, {
      value: options.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: tonJettonSealCanonicalWalletBody(options, this.config),
    });
  }

  async sendTransferNotification(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonTransferNotification,
  ): Promise<void> {
    await provider.internal(via, {
      value: options.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: tonJettonTransferNotificationBody(options, this.config),
    });
  }

  async getStatus(provider: ContractProvider): Promise<number> {
    return (await provider.get("getJettonStatus", [])).stack.readNumber();
  }

  async getWalletSealed(provider: ContractProvider): Promise<number> {
    return (await provider.get("getJettonWalletSealed", [])).stack.readNumber();
  }

  async getFundedAmount(provider: ContractProvider): Promise<bigint> {
    return (
      await provider.get("getJettonFundedAmount", [])
    ).stack.readBigNumber();
  }

  async getLastQueryId(provider: ContractProvider): Promise<bigint> {
    return (
      await provider.get("getJettonLastQueryId", [])
    ).stack.readBigNumber();
  }

  async getConfigHash(provider: ContractProvider): Promise<bigint> {
    return (
      await provider.get("getJettonConfigHash", [])
    ).stack.readBigNumber();
  }

  async getSealedWalletHash(provider: ContractProvider): Promise<bigint> {
    return (
      await provider.get("getJettonSealedWalletHash", [])
    ).stack.readBigNumber();
  }
}
