import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { MoneyLedgerEntry } from "./entities/money-ledger-entry.entity";
import { TonNativeLifecycleAction } from "../deal/ton-native-lifecycle";

const PG_UNIQUE_VIOLATION = "23505";

export interface RecordFundingEntry {
  operationId: string;
  dealId: string;
  paymentId: string;
  amountUsdt: number;
  transferTxHash: string | null;
  notifyTxHash: string | null;
}

export interface RecordNativeTonFundingEntry {
  chainEventId: string;
  dealId: string;
  buyerAddress: string;
  buyerTotalAtomic: string;
  requestValueAtomic: string;
  transactionHash: string;
  transactionLt: string;
  masterchainSeqno: number;
}

export interface RecordNativeTonSettlementEntry {
  chainEventId: string;
  dealId: string;
  action: TonNativeLifecycleAction;
  buyerAddress: string;
  sellerAddress: string;
  treasuryAddress: string;
  sellerPayoutAtomic: string;
  platformFeeAtomic: string;
  refundToBuyerAtomic: string;
  refundFeeAtomic: string;
  buyerAwardAtomic: string | null;
  sellerAwardAtomic: string | null;
  transactionHash: string;
  transactionLt: string;
}

/**
 * Append-only financial ledger. Reversals are represented by new entries;
 * this service intentionally exposes no update/delete API.
 */
@Injectable()
export class MoneyLedgerService {
  constructor(
    @InjectRepository(MoneyLedgerEntry)
    private readonly repo: Repository<MoneyLedgerEntry>,
  ) {}

  async recordEscrowFunding(
    input: RecordFundingEntry,
  ): Promise<MoneyLedgerEntry | null> {
    const idempotencyKey = `payment-operation:${input.operationId}:fund_escrow`;
    try {
      return await this.repo.save(
        this.repo.create({
          dealId: input.dealId,
          paymentId: input.paymentId,
          idempotencyKey,
          debitAccount: "relay_float_usdt",
          creditAccount: `escrow:${input.dealId}`,
          amount: String(input.amountUsdt),
          currency: "USDT",
          entryType: "escrow_funded",
          metadata: {
            transferTxHash: input.transferTxHash,
            notifyTxHash: input.notifyTxHash,
          },
        }),
      );
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        return null;
      }
      throw err;
    }
  }

  async recordNativeTonEscrowFunding(
    input: RecordNativeTonFundingEntry,
  ): Promise<MoneyLedgerEntry | null> {
    const idempotencyKey = `ton-native:${input.chainEventId}:fund`;
    try {
      return await this.repo.save(
        this.repo.create({
          dealId: input.dealId,
          paymentId: null,
          idempotencyKey,
          debitAccount: "external_buyer_ton",
          creditAccount: `escrow:${input.dealId}`,
          amount: nanoToDecimalTon(input.buyerTotalAtomic),
          currency: "TON",
          entryType: "native_ton_escrow_funded",
          metadata: {
            buyerAddress: input.buyerAddress,
            buyerTotalAtomic: input.buyerTotalAtomic,
            requestValueAtomic: input.requestValueAtomic,
            operationalReserveAtomic: (
              BigInt(input.requestValueAtomic) - BigInt(input.buyerTotalAtomic)
            ).toString(),
            transactionHash: input.transactionHash,
            transactionLt: input.transactionLt,
            masterchainSeqno: input.masterchainSeqno,
          },
        }),
      );
    } catch (err) {
      if (this.isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async recordNativeTonSettlement(
    input: RecordNativeTonSettlementEntry,
  ): Promise<void> {
    const isRelease =
      input.action === TonNativeLifecycleAction.RELEASE ||
      input.action === TonNativeLifecycleAction.RELEASE_AFTER_BUYER_TIMEOUT;
    const isRefund =
      input.action === TonNativeLifecycleAction.REFUND_BUYER ||
      input.action === TonNativeLifecycleAction.REFUND_AFTER_SELLER_TIMEOUT;
    const isResolution = input.action === TonNativeLifecycleAction.RESOLVE;
    if (!isRelease && !isRefund && !isResolution) return;

    const movements = isResolution
      ? [
          {
            key: "buyer-award",
            creditAccount: "external_buyer_ton",
            destination: input.buyerAddress,
            amountAtomic: requiredAtomic(input.buyerAwardAtomic),
          },
          {
            key: "seller-award",
            creditAccount: "external_seller_ton",
            destination: input.sellerAddress,
            amountAtomic: requiredAtomic(input.sellerAwardAtomic),
          },
          {
            key: "platform",
            creditAccount: "platform_treasury_ton",
            destination: input.treasuryAddress,
            amountAtomic: input.platformFeeAtomic,
          },
        ]
      : isRelease
        ? [
            {
              key: "seller",
              creditAccount: "external_seller_ton",
              destination: input.sellerAddress,
              amountAtomic: input.sellerPayoutAtomic,
            },
            {
              key: "platform",
              creditAccount: "platform_treasury_ton",
              destination: input.treasuryAddress,
              amountAtomic: input.platformFeeAtomic,
            },
          ]
        : [
            {
              key: "buyer",
              creditAccount: "external_buyer_ton",
              destination: input.buyerAddress,
              amountAtomic: input.refundToBuyerAtomic,
            },
            {
              key: "platform",
              creditAccount: "platform_treasury_ton",
              destination: input.treasuryAddress,
              amountAtomic: input.refundFeeAtomic,
            },
          ];
    for (const movement of movements) {
      if (BigInt(movement.amountAtomic) === 0n) continue;
      try {
        await this.repo.save(
          this.repo.create({
            dealId: input.dealId,
            paymentId: null,
            idempotencyKey: `ton-native:${input.chainEventId}:${movement.key}`,
            debitAccount: `escrow:${input.dealId}`,
            creditAccount: movement.creditAccount,
            amount: nanoToDecimalTon(movement.amountAtomic),
            currency: "TON",
            entryType: isRelease
              ? "native_ton_escrow_released"
              : isResolution
                ? "native_ton_escrow_resolved"
                : "native_ton_escrow_refunded",
            metadata: {
              action: input.action,
              destination: movement.destination,
              amountAtomic: movement.amountAtomic,
              transactionHash: input.transactionHash,
              transactionLt: input.transactionLt,
            },
          }),
        );
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
      }
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    if (err instanceof QueryFailedError) {
      return (
        (err as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION || /unique/i.test(err.message)
      );
    }
    return /unique/i.test(err instanceof Error ? err.message : "");
  }
}

function requiredAtomic(value: string | null): string {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error("Native TON resolution award is missing");
  }
  return value;
}

export function nanoToDecimalTon(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error("Invalid nanotons amount");
  const atomic = BigInt(value);
  if (atomic <= 0n) throw new Error("TON ledger amount must be positive");
  const whole = atomic / 1_000_000_000n;
  const fraction = (atomic % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
