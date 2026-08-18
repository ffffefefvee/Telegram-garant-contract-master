import { BadRequestException } from "@nestjs/common";
import { beginCell, Cell } from "@ton/ton";

export enum TonNativeLifecycleAction {
  MARK_DELIVERED = "mark_delivered",
  RELEASE = "release",
  OPEN_DISPUTE = "open_dispute",
  REFUND_BUYER = "refund_buyer",
  REFUND_AFTER_SELLER_TIMEOUT = "refund_after_seller_timeout",
  RELEASE_AFTER_BUYER_TIMEOUT = "release_after_buyer_timeout",
  RESOLVE = "resolve",
}

export const TON_NATIVE_LIFECYCLE_OPCODE: Record<
  TonNativeLifecycleAction,
  number
> = {
  [TonNativeLifecycleAction.MARK_DELIVERED]: 0x64656c76,
  [TonNativeLifecycleAction.RELEASE]: 0x72656c73,
  [TonNativeLifecycleAction.OPEN_DISPUTE]: 0x64737074,
  [TonNativeLifecycleAction.REFUND_BUYER]: 0x72656664,
  [TonNativeLifecycleAction.REFUND_AFTER_SELLER_TIMEOUT]: 0x73746d6f,
  [TonNativeLifecycleAction.RELEASE_AFTER_BUYER_TIMEOUT]: 0x62746d6f,
  [TonNativeLifecycleAction.RESOLVE]: 0x72736c76,
};

export const TON_NATIVE_CONTRACT_STATUS = {
  AWAITING_FUNDING: 0,
  FUNDED: 1,
  DELIVERED: 2,
  DISPUTED: 3,
  RELEASED: 4,
  REFUNDED: 5,
  RESOLVED: 6,
} as const;

export function buildTonNativeLifecyclePayload(
  action: TonNativeLifecycleAction,
  queryId: bigint,
  awards?: { buyerAward: bigint; sellerAward: bigint },
): string {
  if (queryId <= 0n || queryId >= 1n << 64n) {
    throw new BadRequestException("TON lifecycle query id is outside uint64");
  }
  const builder = beginCell()
    .storeUint(TON_NATIVE_LIFECYCLE_OPCODE[action], 32)
    .storeUint(queryId, 64);
  if (action === TonNativeLifecycleAction.RESOLVE) {
    if (!awards || awards.buyerAward < 0n || awards.sellerAward < 0n) {
      throw new BadRequestException("TON resolution awards are invalid");
    }
    builder.storeCoins(awards.buyerAward).storeCoins(awards.sellerAward);
  } else if (awards) {
    throw new BadRequestException("Awards are only valid for TON resolution");
  }
  return builder.endCell().toBoc().toString("base64");
}

export function parseTonNativeLifecyclePayload(value: string): {
  action: TonNativeLifecycleAction;
  queryId: bigint;
  buyerAward: bigint | null;
  sellerAward: bigint | null;
  hash: string;
} {
  const cell = parseSingleRootBoc(value);
  const slice = cell.beginParse();
  const opcode = slice.loadUint(32);
  const queryId = slice.loadUintBig(64);
  const action = Object.entries(TON_NATIVE_LIFECYCLE_OPCODE).find(
    ([, candidate]) => candidate === opcode,
  )?.[0] as TonNativeLifecycleAction | undefined;
  if (!action) throw new BadRequestException("Unknown TON lifecycle opcode");
  const buyerAward =
    action === TonNativeLifecycleAction.RESOLVE ? slice.loadCoins() : null;
  const sellerAward =
    action === TonNativeLifecycleAction.RESOLVE ? slice.loadCoins() : null;
  if (slice.remainingBits !== 0 || slice.remainingRefs !== 0) {
    throw new BadRequestException("TON lifecycle payload has trailing data");
  }
  return {
    action,
    queryId,
    buyerAward,
    sellerAward,
    hash: cell.hash().toString("hex"),
  };
}

function parseSingleRootBoc(value: string): Cell {
  try {
    const roots = Cell.fromBoc(Buffer.from(value, "base64"));
    if (roots.length !== 1) throw new Error("unexpected root count");
    return roots[0];
  } catch {
    throw new BadRequestException("TON lifecycle payload is not a valid BOC");
  }
}
