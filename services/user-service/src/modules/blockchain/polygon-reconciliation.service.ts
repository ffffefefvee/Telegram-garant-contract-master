import { Injectable, Optional } from "@nestjs/common";
import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { BlockchainConfig } from "./blockchain.config";
import { PolygonFinalityService, evidenceHash } from "./polygon-finality.service";
import { PolygonReconciliationRecord } from "./entities/polygon-lifecycle.entity";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import {
  SettlementCircuitScope,
  SettlementIncidentKind,
} from "../safety/entities/settlement-circuit-breaker.entity";
import { RelayService } from "./relay.service";

interface ReconciliationCandidate {
  deal_id: string;
  escrow_address: string;
  buyer_wallet_address: string;
  seller_wallet_address: string;
  quote_chain_id: string;
  quote_asset_contract: string;
  amount_atomic: string;
  buyer_fee_atomic: string;
  total_funding_atomic: string;
}

export interface PolygonReconciliationReport {
  anchorBlock: number;
  scanned: number;
  matched: number;
  mismatched: number;
  relayerBalanceWei: string;
}

@Injectable()
export class PolygonReconciliationService {
  constructor(
    private readonly config: BlockchainConfig,
    private readonly finality: PolygonFinalityService,
    private readonly breakers: SettlementCircuitBreakerService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  async runOnce(limit = 100): Promise<PolygonReconciliationReport | null> {
    if (!this.config.polygonIndexerEnabled) return null;
    const db = this.db;
    const anchor = await this.finality.finalizedAnchor();
    const relayerBalance = await this.finality.relayerBalance(anchor);
    const candidates = (await db.query(
      `SELECT d.id AS deal_id, d.escrow_address, d.buyer_wallet_address,
        d.seller_wallet_address, q.chain_id AS quote_chain_id,
        q.asset_contract AS quote_asset_contract, q.amount_atomic,
        q.buyer_fee_atomic, q.total_funding_atomic
      FROM deals d
      JOIN settlement_quotes q ON q.id = d.settlement_quote_id
      WHERE d.settlement_network = 'polygon'
        AND d.escrow_address IS NOT NULL
        AND d.buyer_wallet_address IS NOT NULL
        AND d.seller_wallet_address IS NOT NULL
      ORDER BY d.updated_at ASC
      LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    )) as ReconciliationCandidate[];
    const report: PolygonReconciliationReport = {
      anchorBlock: anchor.blockNumber,
      scanned: 0,
      matched: 0,
      mismatched: 0,
      relayerBalanceWei: relayerBalance.toString(),
    };
    for (const candidate of candidates) {
      report.scanned += 1;
      const result = await this.finality.readEscrow(candidate.escrow_address, anchor);
      const observation = result.observation;
      const identityReason = this.identityMismatch(candidate, observation);
      const liabilities = expectedLiabilities(observation.status, candidate.total_funding_atomic, observation.balance);
      const balanceMatches = observation.balance === liabilities;
      const reason = identityReason ?? (balanceMatches ? null : "POLYGON_BALANCE_MISMATCH");
      const hash = evidenceHash({
        anchor: anchor.evidenceHash,
        observationEvidence: result.evidenceHash,
        dealId: candidate.deal_id,
        expected: candidate,
        liabilities,
        reason,
      });
      await db.getRepository(PolygonReconciliationRecord).save({
        dealId: candidate.deal_id,
        chainId: this.config.chainId!,
        escrowAddress: ethers.getAddress(candidate.escrow_address),
        finalizedBlock: String(anchor.blockNumber),
        finalizedBlockHash: anchor.blockHash,
        assetsAtomic: observation.balance,
        liabilitiesAtomic: liabilities,
        matches: reason === null,
        reasonCode: reason,
        evidenceHash: hash,
      });
      if (reason === null) {
        report.matched += 1;
        continue;
      }
      report.mismatched += 1;
      if (!balanceMatches) {
        await this.breakers.tripOnDiscrepancy({
          scope: SettlementCircuitScope.POLYGON,
          assetCode: "USDT",
          assetsAtomic: observation.balance,
          liabilitiesAtomic: liabilities,
          reasonCode: reason,
          evidenceHash: hash,
          actorId: "polygon.reconciliation.worker",
        });
      } else {
        await this.breakers.tripChainIncident({
          scope: SettlementCircuitScope.POLYGON,
          incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
          reasonCode: reason,
          assetCode: "USDT",
          evidenceHash: hash,
          actorId: "polygon.reconciliation.worker",
        });
      }
    }
    return report;
  }

  private identityMismatch(
    expected: ReconciliationCandidate,
    actual: Awaited<ReturnType<PolygonFinalityService["readEscrow"]>>["observation"],
  ): string | null {
    if (expected.quote_chain_id !== String(this.config.chainId)) return "POLYGON_CHAIN_ID_MISMATCH";
    if (ethers.getAddress(expected.quote_asset_contract) !== ethers.getAddress(this.config.tokenAddress)) {
      return "POLYGON_QUOTE_TOKEN_MISMATCH";
    }
    if (actual.dealId !== RelayService.toBytes32(expected.deal_id).toLowerCase()) {
      return "POLYGON_DEAL_ID_MISMATCH";
    }
    if (actual.buyer !== ethers.getAddress(expected.buyer_wallet_address)) {
      return "POLYGON_BUYER_MISMATCH";
    }
    if (actual.seller !== ethers.getAddress(expected.seller_wallet_address)) {
      return "POLYGON_SELLER_MISMATCH";
    }
    if (actual.amount !== expected.amount_atomic || actual.buyerFee !== expected.buyer_fee_atomic) {
      return "POLYGON_AMOUNT_MISMATCH";
    }
    return null;
  }

  private get db(): DataSource {
    if (!this.dataSource?.isInitialized) throw new Error("POLYGON_DATABASE_UNAVAILABLE");
    return this.dataSource;
  }
}

export function expectedLiabilities(
  status: number,
  totalFundingAtomic: string,
  _observedBalance: string,
): string {
  if (status === 1) return "0";
  if (status === 2 || status === 5) return totalFundingAtomic;
  if ([3, 4, 6, 7, 8].includes(status)) return "0";
  throw new Error("POLYGON_ESCROW_STATUS_INVALID");
}
