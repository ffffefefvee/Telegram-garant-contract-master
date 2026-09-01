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
  DELIVERED: 2,
  DISPUTED: 3,
  SETTLEMENT_PENDING: 4,
  RECOVERY_REQUIRED: 5,
  SETTLED_FINALIZED: 6,
} as const;

export const TON_JETTON_ESCROW_OUTCOME = {
  RELEASE: 1,
  REFUND: 2,
  RESOLUTION: 3,
} as const;

export const TON_JETTON_ESCROW_LEG = {
  BUYER: 1,
  SELLER: 2,
  TREASURY: 4,
} as const;

export const TON_JETTON_ESCROW_OP = {
  SEAL_CANONICAL_JETTON_WALLET: 0x6a736561,
  TRANSFER_NOTIFICATION: 0x7362d09c,
  MARK_DELIVERED: 0x64656c76,
  RELEASE: 0x72656c73,
  REFUND_BUYER: 0x72656664,
  REFUND_AFTER_SELLER_TIMEOUT: 0x73746d6f,
  RELEASE_AFTER_BUYER_TIMEOUT: 0x62746d6f,
  OPEN_DISPUTE: 0x64737074,
  RESOLVE: 0x72736c76,
  RECONCILE_ATTEMPT: 0x72636e63,
  RETRY_FAILED_LEGS: 0x72747279,
  FINALIZE_SETTLEMENT: 0x666e6c7a,
  JETTON_TRANSFER: 0x0f8a7ea5,
} as const;

const UINT64_LIMIT = 1n << 64n;
const UINT256_LIMIT = 1n << 256n;
const COINS_LIMIT = 1n << 120n;

export type TonJettonEscrowConfig = {
  dealId: bigint;
  termsHash: bigint;
  quoteHash: bigint;
  fundingDeadline: bigint;
  deliveryDeadline: bigint;
  confirmationDeadline: bigint;
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

export type TonJettonSettlementCommand = {
  queryId: bigint;
  settlementId: bigint;
  buyerQueryId: bigint;
  sellerQueryId: bigint;
  treasuryQueryId: bigint;
};

export type TonJettonReconciliation = {
  queryId: bigint;
  settlementId: bigint;
  attempt: number;
  activeMask: number;
  confirmedMask: number;
  failedMask: number;
  evidenceHash: bigint;
};

export type TonJettonRetry = TonJettonSettlementCommand & {
  previousAttempt: number;
};

export type TonJettonFinalization = {
  queryId: bigint;
  settlementId: bigint;
  attempt: number;
  evidenceHash: bigint;
};

export type TonJettonResolution = TonJettonSettlementCommand & {
  buyerAward: bigint;
  sellerAward: bigint;
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
  assertUint("deliveryDeadline", config.deliveryDeadline, UINT64_LIMIT, true);
  assertUint(
    "confirmationDeadline",
    config.confirmationDeadline,
    UINT64_LIMIT,
    true,
  );
  if (
    config.fundingDeadline >= config.deliveryDeadline ||
    config.deliveryDeadline >= config.confirmationDeadline
  ) {
    throw new Error(
      "deadlines must satisfy fundingDeadline < deliveryDeadline < confirmationDeadline",
    );
  }
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
    .storeUint(config.deliveryDeadline, 64)
    .storeUint(config.confirmationDeadline, 64)
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

function validateSettlementIdentity(queryId: bigint, settlementId: bigint): void {
  assertUint("queryId", queryId, UINT64_LIMIT, true);
  assertUint("settlementId", settlementId, UINT256_LIMIT, true);
}

function validateSettlementCommand(command: TonJettonSettlementCommand): void {
  validateSettlementIdentity(command.queryId, command.settlementId);
  assertUint("buyerQueryId", command.buyerQueryId, UINT64_LIMIT);
  assertUint("sellerQueryId", command.sellerQueryId, UINT64_LIMIT);
  assertUint("treasuryQueryId", command.treasuryQueryId, UINT64_LIMIT);
}

export function tonJettonQueryBody(opcode: number, queryId: bigint): Cell {
  assertUint("queryId", queryId, UINT64_LIMIT, true);
  return beginCell().storeUint(opcode, 32).storeUint(queryId, 64).endCell();
}

export function tonJettonSettlementCommandBody(
  opcode: number,
  command: TonJettonSettlementCommand,
): Cell {
  validateSettlementCommand(command);
  return beginCell()
    .storeUint(opcode, 32)
    .storeUint(command.queryId, 64)
    .storeUint(command.settlementId, 256)
    .storeUint(command.buyerQueryId, 64)
    .storeUint(command.sellerQueryId, 64)
    .storeUint(command.treasuryQueryId, 64)
    .endCell();
}

export function tonJettonResolutionBody(
  resolution: TonJettonResolution,
): Cell {
  validateSettlementCommand(resolution);
  assertCoins("buyerAward", resolution.buyerAward);
  assertCoins("sellerAward", resolution.sellerAward);
  return beginCell()
    .storeUint(TON_JETTON_ESCROW_OP.RESOLVE, 32)
    .storeUint(resolution.queryId, 64)
    .storeUint(resolution.settlementId, 256)
    .storeCoins(resolution.buyerAward)
    .storeCoins(resolution.sellerAward)
    .storeUint(resolution.buyerQueryId, 64)
    .storeUint(resolution.sellerQueryId, 64)
    .storeUint(resolution.treasuryQueryId, 64)
    .endCell();
}

export function tonJettonReconcileAttemptBody(
  reconciliation: TonJettonReconciliation,
): Cell {
  validateSettlementIdentity(
    reconciliation.queryId,
    reconciliation.settlementId,
  );
  assertUint("attempt", BigInt(reconciliation.attempt), 1n << 32n);
  for (const [name, mask] of [
    ["activeMask", reconciliation.activeMask],
    ["confirmedMask", reconciliation.confirmedMask],
    ["failedMask", reconciliation.failedMask],
  ] as const) {
    assertUint(name, BigInt(mask), 1n << 8n);
  }
  assertUint("evidenceHash", reconciliation.evidenceHash, UINT256_LIMIT, true);
  if ((reconciliation.activeMask & ~7) !== 0) {
    throw new RangeError("activeMask contains an unknown leg");
  }
  if ((reconciliation.confirmedMask & reconciliation.failedMask) !== 0) {
    throw new Error("confirmedMask and failedMask must be disjoint");
  }
  if (
    (reconciliation.confirmedMask | reconciliation.failedMask) !==
    reconciliation.activeMask
  ) {
    throw new Error("reconciliation masks must completely classify activeMask");
  }
  return beginCell()
    .storeUint(TON_JETTON_ESCROW_OP.RECONCILE_ATTEMPT, 32)
    .storeUint(reconciliation.queryId, 64)
    .storeUint(reconciliation.settlementId, 256)
    .storeUint(reconciliation.attempt, 32)
    .storeUint(reconciliation.activeMask, 8)
    .storeUint(reconciliation.confirmedMask, 8)
    .storeUint(reconciliation.failedMask, 8)
    .storeUint(reconciliation.evidenceHash, 256)
    .endCell();
}

export function tonJettonRetryFailedLegsBody(retry: TonJettonRetry): Cell {
  validateSettlementCommand(retry);
  assertUint("previousAttempt", BigInt(retry.previousAttempt), 1n << 32n);
  return beginCell()
    .storeUint(TON_JETTON_ESCROW_OP.RETRY_FAILED_LEGS, 32)
    .storeUint(retry.queryId, 64)
    .storeUint(retry.settlementId, 256)
    .storeUint(retry.previousAttempt, 32)
    .storeUint(retry.buyerQueryId, 64)
    .storeUint(retry.sellerQueryId, 64)
    .storeUint(retry.treasuryQueryId, 64)
    .endCell();
}

export function tonJettonFinalizeSettlementBody(
  finalization: TonJettonFinalization,
): Cell {
  validateSettlementIdentity(finalization.queryId, finalization.settlementId);
  assertUint("attempt", BigInt(finalization.attempt), 1n << 32n);
  assertUint("evidenceHash", finalization.evidenceHash, UINT256_LIMIT, true);
  return beginCell()
    .storeUint(TON_JETTON_ESCROW_OP.FINALIZE_SETTLEMENT, 32)
    .storeUint(finalization.queryId, 64)
    .storeUint(finalization.settlementId, 256)
    .storeUint(finalization.attempt, 32)
    .storeUint(finalization.evidenceHash, 256)
    .endCell();
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

  private async sendBody(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    body: Cell,
  ): Promise<void> {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendMarkDelivered(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & { queryId: bigint },
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonQueryBody(TON_JETTON_ESCROW_OP.MARK_DELIVERED, options.queryId),
    );
  }

  async sendRelease(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonSettlementCommand,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonSettlementCommandBody(TON_JETTON_ESCROW_OP.RELEASE, options),
    );
  }

  async sendRefundBuyer(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonSettlementCommand,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonSettlementCommandBody(TON_JETTON_ESCROW_OP.REFUND_BUYER, options),
    );
  }

  async sendRefundAfterSellerTimeout(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonSettlementCommand,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonSettlementCommandBody(
        TON_JETTON_ESCROW_OP.REFUND_AFTER_SELLER_TIMEOUT,
        options,
      ),
    );
  }

  async sendReleaseAfterBuyerTimeout(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonSettlementCommand,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonSettlementCommandBody(
        TON_JETTON_ESCROW_OP.RELEASE_AFTER_BUYER_TIMEOUT,
        options,
      ),
    );
  }

  async sendOpenDispute(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & { queryId: bigint },
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonQueryBody(TON_JETTON_ESCROW_OP.OPEN_DISPUTE, options.queryId),
    );
  }

  async sendResolve(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonResolution,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonResolutionBody(options),
    );
  }

  async sendReconcileAttempt(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonReconciliation,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonReconcileAttemptBody(options),
    );
  }

  async sendRetryFailedLegs(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonRetry,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonRetryFailedLegsBody(options),
    );
  }

  async sendFinalizeSettlement(
    provider: ContractProvider,
    via: Sender,
    options: SendOptions & TonJettonFinalization,
  ): Promise<void> {
    await this.sendBody(
      provider,
      via,
      options.value,
      tonJettonFinalizeSettlementBody(options),
    );
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

  async getSettlementHash(provider: ContractProvider): Promise<bigint> {
    return (
      await provider.get("getJettonSettlementHash", [])
    ).stack.readBigNumber();
  }
}
