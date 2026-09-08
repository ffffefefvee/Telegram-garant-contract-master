import { Injectable, Optional } from "@nestjs/common";
import { createHash } from "crypto";
import { ethers } from "ethers";
import { DataSource, In, LessThan } from "typeorm";
import { BlockchainConfig } from "./blockchain.config";
import { BlockchainProvider } from "./blockchain.provider";
import {
  PolygonRelayNonceState,
  PolygonRelayTransaction,
  PolygonRelayTxStatus,
} from "./entities/polygon-lifecycle.entity";
import { MoneyMovementGate } from "./money-movement.gate";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import {
  SettlementCircuitScope,
  SettlementIncidentKind,
} from "../safety/entities/settlement-circuit-breaker.entity";
import { evidenceHash } from "./polygon-finality.service";

@Injectable()
export class PolygonRelayNonceService {
  constructor(
    private readonly config: BlockchainConfig,
    private readonly blockchain: BlockchainProvider,
    private readonly moneyGate: MoneyMovementGate,
    private readonly breakers: SettlementCircuitBreakerService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  async reserve(operationKind: string, identity: string): Promise<PolygonRelayTransaction> {
    if (!this.blockchain.isReady || this.config.chainId === null) {
      throw new Error("POLYGON_RELAY_UNAVAILABLE");
    }
    const signerAddress = ethers.getAddress(await this.blockchain.signer.getAddress());
    const operationKey = createHash("sha256")
      .update(`polygon-relay-v1\n${this.config.chainId}\n${signerAddress}\n${operationKind}\n${identity}`)
      .digest("hex");
    const pendingNonce = await this.blockchain.provider.getTransactionCount(
      signerAddress,
      "pending",
    );

    return this.db.transaction(async (manager) => {
      const txRepo = manager.getRepository(PolygonRelayTransaction);
      if (this.db.options.type === "postgres") {
        await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          operationKey,
        ]);
      }
      let existingQuery = txRepo
        .createQueryBuilder("relay")
        .where("relay.operationKey = :operationKey", { operationKey });
      if (this.db.options.type === "postgres") {
        existingQuery = existingQuery.setLock("pessimistic_write");
      }
      const existing = await existingQuery.getOne();
      if (existing) return existing;

      const stateRepo = manager.getRepository(PolygonRelayNonceState);
      await stateRepo
        .createQueryBuilder()
        .insert()
        .values({
          chainId: this.config.chainId!,
          signerAddress,
          nextNonce: String(pendingNonce),
          revision: 0,
        })
        .orIgnore()
        .execute();
      let stateQuery = stateRepo
        .createQueryBuilder("nonce")
        .where("nonce.chainId = :chainId", { chainId: this.config.chainId })
        .andWhere("nonce.signerAddress = :signerAddress", { signerAddress });
      if (this.db.options.type === "postgres") {
        stateQuery = stateQuery.setLock("pessimistic_write");
      }
      const state = await stateQuery.getOneOrFail();
      const nonce = BigInt(state.nextNonce) > BigInt(pendingNonce)
        ? BigInt(state.nextNonce)
        : BigInt(pendingNonce);
      state.nextNonce = String(nonce + 1n);
      state.revision += 1;
      await stateRepo.save(state);

      return txRepo.save(
        txRepo.create({
          operationKey,
          operationKind,
          chainId: this.config.chainId!,
          signerAddress,
          nonce: nonce.toString(),
          status: PolygonRelayTxStatus.RESERVED,
          currentTxHash: null,
          txTo: null,
          txData: null,
          txValue: null,
          gasLimit: null,
          gasPrice: null,
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          replacedTxHashes: [],
          attempts: 0,
          broadcastAt: null,
          confirmedAt: null,
          confirmedBlock: null,
          failureCode: null,
        }),
      );
    });
  }

  async recordBroadcast(
    reservationId: string,
    response: ethers.TransactionResponse,
  ): Promise<void> {
    await this.db.transaction(async (manager) => {
      const repo = manager.getRepository(PolygonRelayTransaction);
      let query = repo.createQueryBuilder("relay").where("relay.id = :id", { id: reservationId });
      if (this.db.options.type === "postgres") query = query.setLock("pessimistic_write");
      const record = await query.getOneOrFail();
      if (record.currentTxHash && record.currentTxHash !== response.hash.toLowerCase()) {
        record.replacedTxHashes = [...record.replacedTxHashes, record.currentTxHash];
      }
      record.currentTxHash = response.hash.toLowerCase();
      record.txTo = response.to ? ethers.getAddress(response.to) : null;
      record.txData = response.data;
      record.txValue = response.value.toString();
      record.gasLimit = response.gasLimit.toString();
      record.gasPrice = response.gasPrice?.toString() ?? null;
      record.maxFeePerGas = response.maxFeePerGas?.toString() ?? null;
      record.maxPriorityFeePerGas = response.maxPriorityFeePerGas?.toString() ?? null;
      record.attempts += 1;
      record.status = record.attempts === 1
        ? PolygonRelayTxStatus.BROADCAST
        : PolygonRelayTxStatus.REPLACED;
      record.broadcastAt = new Date();
      record.failureCode = null;
      await repo.save(record);
    });
  }

  async recordConfirmed(
    reservationId: string,
    receipt: ethers.TransactionReceipt,
  ): Promise<void> {
    const repo = this.db.getRepository(PolygonRelayTransaction);
    await repo.update(
      { id: reservationId },
      {
        status: PolygonRelayTxStatus.CONFIRMED,
        currentTxHash: receipt.hash.toLowerCase(),
        confirmedAt: new Date(),
        confirmedBlock: String(receipt.blockNumber),
        failureCode: null,
      },
    );
  }

  async recordFailure(reservationId: string, code: string): Promise<void> {
    await this.db.getRepository(PolygonRelayTransaction).update(
      { id: reservationId },
      { status: PolygonRelayTxStatus.FAILED, failureCode: sanitizeFailureCode(code) },
    );
  }

  async recoverStuck(): Promise<number> {
    if (!this.blockchain.isReady) return 0;
    const cutoff = new Date(Date.now() - this.config.polygonRelayStuckSeconds * 1000);
    const candidates = await this.db.getRepository(PolygonRelayTransaction).find({
      where: {
        status: In([
          PolygonRelayTxStatus.BROADCAST,
          PolygonRelayTxStatus.REPLACING,
          PolygonRelayTxStatus.REPLACED,
        ]),
        updatedAt: LessThan(cutoff),
      },
      order: { nonce: "ASC" },
      take: 20,
    });
    let recovered = 0;
    for (const candidate of candidates) {
      if (!candidate.currentTxHash) continue;
      const receipt = await this.blockchain.provider.getTransactionReceipt(candidate.currentTxHash);
      if (receipt) {
        if (receipt.status === 1) {
          await this.recordConfirmed(candidate.id, receipt);
          recovered += 1;
        } else {
          await this.recordFailure(candidate.id, "TRANSACTION_REVERTED");
        }
        continue;
      }
      const confirmedNonce = await this.blockchain.provider.getTransactionCount(
        candidate.signerAddress,
        "latest",
      );
      if (BigInt(confirmedNonce) > BigInt(candidate.nonce)) {
        const hash = evidenceHash({
          operationKey: candidate.operationKey,
          nonce: candidate.nonce,
          confirmedNonce,
          searchedHashes: [...candidate.replacedTxHashes, candidate.currentTxHash],
        });
        await this.recordFailure(candidate.id, "NONCE_CONSUMED_WITHOUT_RECEIPT");
        await this.breakers.tripChainIncident({
          scope: SettlementCircuitScope.POLYGON,
          incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
          reasonCode: "POLYGON_NONCE_AMBIGUOUS",
          assetCode: "MATIC",
          evidenceHash: hash,
          actorId: "polygon.relay.recovery",
        });
        continue;
      }
      if (candidate.attempts >= this.config.polygonRelayMaxAttempts) {
        const hash = evidenceHash({
          operationKey: candidate.operationKey,
          nonce: candidate.nonce,
          attempts: candidate.attempts,
          txHash: candidate.currentTxHash,
        });
        await this.recordFailure(candidate.id, "STUCK_MAX_ATTEMPTS");
        await this.breakers.tripChainIncident({
          scope: SettlementCircuitScope.POLYGON,
          incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
          reasonCode: "POLYGON_RELAY_STUCK",
          assetCode: "MATIC",
          evidenceHash: hash,
          actorId: "polygon.relay.recovery",
        });
        continue;
      }
      if (await this.replace(candidate)) recovered += 1;
    }
    return recovered;
  }

  private async replace(record: PolygonRelayTransaction): Promise<boolean> {
    if (!record.txTo || !record.txData || record.txValue === null || record.gasLimit === null) {
      await this.recordFailure(record.id, "REPLACEMENT_PAYLOAD_UNAVAILABLE");
      return false;
    }
    this.moneyGate.assertRelayOperationAllowed("polygon.relay.replace");
    await this.breakers.assertEgressAllowed(SettlementCircuitScope.POLYGON);
    const claimed = await this.db
      .getRepository(PolygonRelayTransaction)
      .createQueryBuilder()
      .update()
      .set({ status: PolygonRelayTxStatus.REPLACING, failureCode: null })
      .where("id = :id", { id: record.id })
      .andWhere("status = :expectedStatus", { expectedStatus: record.status })
      .andWhere("updated_at = :expectedUpdatedAt", { expectedUpdatedAt: record.updatedAt })
      .execute();
    if ((claimed.affected ?? 0) !== 1) return false;
    const fees = await this.blockchain.provider.getFeeData();
    const request: ethers.TransactionRequest = {
      to: record.txTo,
      data: record.txData,
      value: BigInt(record.txValue),
      gasLimit: BigInt(record.gasLimit),
      nonce: Number(record.nonce),
      chainId: record.chainId,
    };
    if (record.maxFeePerGas !== null) {
      request.maxFeePerGas = bumped(record.maxFeePerGas, fees.maxFeePerGas);
      request.maxPriorityFeePerGas = bumped(
        record.maxPriorityFeePerGas ?? "0",
        fees.maxPriorityFeePerGas,
      );
      request.type = 2;
    } else {
      request.gasPrice = bumped(record.gasPrice ?? "0", fees.gasPrice);
    }
    try {
      const replacement = await this.blockchain.signer.sendTransaction(request);
      await this.recordBroadcast(record.id, replacement);
      return true;
    } catch (error) {
      await this.db.getRepository(PolygonRelayTransaction).update(
        { id: record.id },
        {
          status: record.attempts > 1
            ? PolygonRelayTxStatus.REPLACED
            : PolygonRelayTxStatus.BROADCAST,
          failureCode: "REPLACEMENT_SEND_FAILED",
        },
      );
      throw error;
    }
  }

  private get db(): DataSource {
    if (!this.dataSource?.isInitialized) throw new Error("POLYGON_DATABASE_UNAVAILABLE");
    return this.dataSource;
  }
}

function bumped(previous: string, current: bigint | null): bigint {
  const previousBump = (BigInt(previous) * 1125n + 999n) / 1000n;
  const networkBump = current === null ? 0n : (current * 1250n + 999n) / 1000n;
  return previousBump > networkBump ? previousBump : networkBump;
}

function sanitizeFailureCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 128);
  return normalized || "UNKNOWN_FAILURE";
}
