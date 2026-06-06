import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute } from './entities/dispute.entity';
import { Deal } from '../deal/entities/deal.entity';
import { User } from '../user/entities/user.entity';
import { EscrowService } from '../escrow/escrow.service';
import { DealStatus } from '../deal/enums/deal.enum';

/**
 * Recorded on-chain side-effects for a dispute. Stored under
 * `dispute.metadata.onChain` so we don't need a migration to track them
 * — these are flags + tx hashes, all addressable via the JSONB column.
 */
export interface OnChainDisputeMetadata {
  /** Tx hash of the most recent successful `assignArbitrator()` call. */
  assignArbitratorTxHash?: string;
  /** Last attempted assignment failed; reconciliation should retry. */
  assignArbitratorPending?: boolean;
  /** Tx hash that the arbitrator's mini-app reported for `resolve()`. */
  resolveTxHash?: string;
  /** Buyer/seller share percentages submitted with the resolve tx. */
  resolveBuyerSharePct?: number;
  resolveSellerSharePct?: number;
  /** ISO timestamp of when we recorded the resolve tx. */
  resolveRecordedAt?: string;
}

export interface AssignArbitratorOnChainResult {
  disputeId: string;
  arbitratorWallet: string;
  txHash: string | null;
  /** True if the on-chain call succeeded; false if we logged a partial. */
  ok: boolean;
  notes: string[];
}

export interface RecordResolutionInput {
  txHash: string;
  buyerSharePct: number;
  sellerSharePct: number;
}

/**
 * Bridges off-chain Dispute records to on-chain escrow state.
 *
 * Two operations:
 *  1. `syncArbitratorAssignmentOnChain` — after we've assigned an arbitrator
 *     in the DB (`DisputeService.assignArbitrator`), call
 *     `EscrowService.assignArbitrator()` so the on-chain clone knows who
 *     can sign `resolve()`. The relay wallet is authorised by the contract
 *     to make this call.
 *  2. `recordResolutionTx` — after the arbitrator's mini-app has signed and
 *     broadcast `EscrowImplementation.resolve(buyerPct, sellerPct)`, record
 *     the tx hash + decision in `dispute.metadata.onChain` and transition
 *     the deal to DISPUTE_RESOLVED. We do NOT call resolve() ourselves —
 *     the contract enforces that only the assigned arbitrator's address can.
 */
@Injectable()
export class DisputeBlockchainService {
  private readonly logger = new Logger(DisputeBlockchainService.name);

  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly escrow: EscrowService,
  ) {}

  /**
   * Push the assignment to the chain. Best-effort: failures are logged and
   * recorded as `assignArbitratorPending=true` so reconciliation can retry.
   */
  async syncArbitratorAssignmentOnChain(
    disputeId: string,
  ): Promise<AssignArbitratorOnChainResult> {
    const dispute = await this.disputeRepo.findOne({ where: { id: disputeId } });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found`);
    }
    if (!dispute.arbitratorId) {
      throw new BadRequestException(
        `Dispute ${disputeId} has no arbitrator assigned`,
      );
    }

    const arbitrator = await this.userRepo.findOne({
      where: { id: dispute.arbitratorId },
    });
    if (!arbitrator) {
      throw new NotFoundException(
        `Arbitrator user ${dispute.arbitratorId} not found`,
      );
    }
    if (!arbitrator.walletAddress) {
      throw new BadRequestException(
        `Arbitrator ${arbitrator.id} has no wallet attached`,
      );
    }

    const notes: string[] = [];
    if (!this.escrow.isEnabled()) {
      notes.push('blockchain disabled (stub mode) — assignment not synced');
      await this.persistOnChain(dispute, {
        assignArbitratorPending: true,
      });
      return {
        disputeId,
        arbitratorWallet: arbitrator.walletAddress,
        txHash: null,
        ok: false,
        notes,
      };
    }

    try {
      const txHash = await this.escrow.assignArbitrator(
        dispute.dealId,
        arbitrator.walletAddress,
      );
      await this.persistOnChain(dispute, {
        assignArbitratorTxHash: txHash,
        assignArbitratorPending: false,
      });
      this.logger.log(
        `assignArbitrator on-chain ok dispute=${disputeId} wallet=${arbitrator.walletAddress} tx=${txHash}`,
      );
      return {
        disputeId,
        arbitratorWallet: arbitrator.walletAddress,
        txHash,
        ok: true,
        notes,
      };
    } catch (err) {
      this.logger.error(
        `assignArbitrator on-chain failed for dispute=${disputeId}: ${(err as Error).message}`,
      );
      notes.push(`on-chain assignArbitrator failed: ${(err as Error).message}`);
      await this.persistOnChain(dispute, { assignArbitratorPending: true });
      return {
        disputeId,
        arbitratorWallet: arbitrator.walletAddress,
        txHash: null,
        ok: false,
        notes,
      };
    }
  }

  /**
   * Record an arbitrator-signed `resolve()` tx hash. The mini-app calls
   * this after the arbitrator has broadcast the on-chain transaction with
   * their own wallet (we don't hold arbitrator keys; that's the whole
   * point of the stake / accountability model).
   *
   * We trust the tx hash provided here for now and verify it by polling
   * the chain in PR 6/6 (reconciliation). Callers can pass the share
   * percentages so we have a record of what the arbitrator said even if
   * the chain receipt later disagrees.
   */
  async recordResolutionTx(
    disputeId: string,
    input: RecordResolutionInput,
  ): Promise<{ disputeId: string; dealId: string; txHash: string }> {
    if (!input.txHash || !/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
      throw new BadRequestException('txHash must be a 32-byte hex (0x…)');
    }
    const total = input.buyerSharePct + input.sellerSharePct;
    if (total !== 100) {
      throw new BadRequestException(
        `buyerSharePct + sellerSharePct must equal 100 (got ${total})`,
      );
    }

    const dispute = await this.disputeRepo.findOne({ where: { id: disputeId } });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found`);
    }

    await this.persistOnChain(dispute, {
      resolveTxHash: input.txHash,
      resolveBuyerSharePct: input.buyerSharePct,
      resolveSellerSharePct: input.sellerSharePct,
      resolveRecordedAt: new Date().toISOString(),
    });

    const deal = await this.dealRepo.findOne({ where: { id: dispute.dealId } });
    if (deal && deal.status !== DealStatus.DISPUTE_RESOLVED) {
      deal.status = DealStatus.DISPUTE_RESOLVED;
      await this.dealRepo.save(deal);
    }

    this.logger.log(
      `Resolution recorded dispute=${disputeId} tx=${input.txHash} ${input.buyerSharePct}/${input.sellerSharePct}`,
    );
    return {
      disputeId,
      dealId: dispute.dealId,
      txHash: input.txHash,
    };
  }

  /**
   * Merge `patch` into `dispute.metadata.onChain` and save. Keeps existing
   * fields. Persists in a single trip.
   */
  private async persistOnChain(
    dispute: Dispute,
    patch: Partial<OnChainDisputeMetadata>,
  ): Promise<void> {
    const md = (dispute.metadata ?? {}) as Record<string, unknown>;
    const onChain = (md.onChain ?? {}) as OnChainDisputeMetadata;
    dispute.metadata = {
      ...md,
      onChain: { ...onChain, ...patch },
    };
    await this.disputeRepo.save(dispute);
  }
}
