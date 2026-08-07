import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { MoneyLedgerEntry } from "./entities/money-ledger-entry.entity";

const PG_UNIQUE_VIOLATION = "23505";

export interface RecordFundingEntry {
  operationId: string;
  dealId: string;
  paymentId: string;
  amountUsdt: number;
  transferTxHash: string | null;
  notifyTxHash: string | null;
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
