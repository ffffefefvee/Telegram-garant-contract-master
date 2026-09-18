import { Injectable, Logger, Optional } from "@nestjs/common";
import { createHash } from "crypto";
import { ethers } from "ethers";
import { DataSource, EntityManager } from "typeorm";
import { BlockchainConfig } from "./blockchain.config";
import { BlockchainProvider } from "./blockchain.provider";
import {
  PolygonChainEvent,
  PolygonEventStatus,
  PolygonLifecycleCursor,
} from "./entities/polygon-lifecycle.entity";
import { Deal } from "../deal/entities/deal.entity";
import { SettlementNetwork } from "../deal/enums/deal.enum";
import { PolygonFinalityService, evidenceHash } from "./polygon-finality.service";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import {
  SettlementCircuitScope,
  SettlementIncidentKind,
} from "../safety/entities/settlement-circuit-breaker.entity";
import factoryAbi from "./abi/EscrowFactory.json";
import escrowAbi from "./abi/EscrowImplementation.json";

const ADDRESS_CHUNK = 100;

export interface PolygonIngestionReport {
  fromBlock: number;
  toBlock: number;
  finalizedHead: number;
  logsSeen: number;
  inserted: number;
  duplicate: number;
}

function normalizeAbi(value: unknown): ethers.InterfaceAbi {
  if (Array.isArray(value)) return value;
  const nested = (value as { default?: unknown })?.default;
  if (Array.isArray(nested)) return nested;
  const entries = value && typeof value === "object" ? Object.values(value) : [];
  if (
    entries.length > 0 &&
    entries.every(
      (entry) => entry && typeof entry === "object" && typeof (entry as { type?: unknown }).type === "string",
    )
  ) {
    return entries as ethers.InterfaceAbi;
  }
  throw new Error("POLYGON_ABI_UNAVAILABLE");
}

/**
 * Durable, bounded Polygon log ingestion. Only blocks agreed by independent RPC
 * sources and buried under the configured finality depth are persisted.
 */
@Injectable()
export class PolygonLifecycleIngestionService {
  private readonly logger = new Logger(PolygonLifecycleIngestionService.name);

  constructor(
    private readonly config: BlockchainConfig,
    private readonly blockchain: BlockchainProvider,
    private readonly finality: PolygonFinalityService,
    private readonly breakers: SettlementCircuitBreakerService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  async runOnce(): Promise<PolygonIngestionReport | null> {
    if (!this.config.polygonIndexerEnabled || !this.blockchain.isReady) return null;
    const anchor = await this.finality.finalizedAnchor();
    let finalizedReorg = false;
    const report = await this.db.transaction(async (manager) => {
      const cursor = await this.lockCursor(manager);
      if (!(await this.assertCursorCanonical(manager, cursor))) {
        finalizedReorg = true;
        return null;
      }
      const fromBlock = Number(cursor.nextBlock);
      if (fromBlock > anchor.blockNumber) {
        return {
          fromBlock,
          toBlock: fromBlock - 1,
          finalizedHead: anchor.blockNumber,
          logsSeen: 0,
          inserted: 0,
          duplicate: 0,
        };
      }
      const toBlock = Math.min(
        anchor.blockNumber,
        fromBlock + this.config.polygonLogBatchSize - 1,
      );
      const addresses = await this.watchedAddresses(manager);
      let logs = await this.readLogs(addresses, fromBlock, toBlock);
      const known = new Set(addresses.map((address) => address.toLowerCase()));
      const discovered = logs
        .filter((log) => log.address.toLowerCase() === this.config.factoryAddress.toLowerCase())
        .map((log) => this.decodeLog(log))
        .filter((decoded) => decoded.eventName === "EscrowCreated" && decoded.escrowAddress)
        .map((decoded) => decoded.escrowAddress!)
        .filter((address) => !known.has(address.toLowerCase()));
      if (discovered.length > 0) {
        logs = deduplicateLogs([
          ...logs,
          ...(await this.readLogs([...new Set(discovered)], fromBlock, toBlock)),
        ]);
      }
      const report: PolygonIngestionReport = {
        fromBlock,
        toBlock,
        finalizedHead: anchor.blockNumber,
        logsSeen: logs.length,
        inserted: 0,
        duplicate: 0,
      };
      const eventRepo = manager.getRepository(PolygonChainEvent);
      const finalizedAt = new Date();
      for (const log of logs) {
        if (!log.blockHash || !log.transactionHash || log.index < 0) {
          throw new Error("POLYGON_LOG_IDENTITY_INCOMPLETE");
        }
        const decoded = this.decodeLog(log);
        const raw = {
          chainId: this.config.chainId!,
          contractAddress: ethers.getAddress(log.address),
          escrowAddress: decoded.escrowAddress,
          eventName: decoded.eventName,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: log.index,
          blockNumber: String(log.blockNumber),
          blockHash: log.blockHash.toLowerCase(),
          topics: [...log.topics].map((topic) => topic.toLowerCase()),
          data: log.data.toLowerCase(),
          decodedPayload: decoded.payload,
        };
        const result = await eventRepo
          .createQueryBuilder()
          .insert()
          .values({
            ...raw,
            status: PolygonEventStatus.FINALIZED,
            evidenceHash: evidenceHash(raw),
            finalizedAt,
            appliedAt: null,
            orphanedAt: null,
            rejectionReason: null,
          })
          .orIgnore()
          .execute();
        if ((result.identifiers?.length ?? 0) > 0) report.inserted += 1;
        else report.duplicate += 1;
      }
      const endBlockHash = await this.finality.agreedBlockHash(toBlock);
      cursor.nextBlock = String(toBlock + 1);
      cursor.lastFinalizedBlock = String(toBlock);
      cursor.lastFinalizedHash = endBlockHash;
      cursor.revision += 1;
      await manager.getRepository(PolygonLifecycleCursor).save(cursor);
      this.logger.log(
        `Polygon finalized logs ${fromBlock}-${toBlock}: inserted=${report.inserted}, duplicate=${report.duplicate}`,
      );
      return report;
    });
    if (finalizedReorg) throw new Error("POLYGON_FINALIZED_REORG");
    return report;
  }

  /** Apply exactly one finalized event while holding its database lock. */
  async applyNext(
    apply: (event: PolygonChainEvent, manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    return this.db.transaction(async (manager) => {
      let query = manager
        .getRepository(PolygonChainEvent)
        .createQueryBuilder("event")
        .where("event.status = :status", { status: PolygonEventStatus.FINALIZED })
        .orderBy("event.blockNumber", "ASC")
        .addOrderBy("event.logIndex", "ASC")
        .limit(1);
      if (this.db.options.type === "postgres") {
        query = query.setLock("pessimistic_write").setOnLocked("skip_locked");
      }
      const event = await query.getOne();
      if (!event) return false;
      await apply(event, manager);
      event.status = PolygonEventStatus.APPLIED;
      event.appliedAt = new Date();
      await manager.getRepository(PolygonChainEvent).save(event);
      return true;
    });
  }

  private async lockCursor(manager: EntityManager): Promise<PolygonLifecycleCursor> {
    const repo = manager.getRepository(PolygonLifecycleCursor);
    let query = repo
      .createQueryBuilder("cursor")
      .where("cursor.chainId = :chainId", { chainId: this.config.chainId });
    if (this.db.options.type === "postgres") query = query.setLock("pessimistic_write");
    let cursor = await query.getOne();
    if (!cursor) {
      cursor = repo.create({
        chainId: this.config.chainId!,
        nextBlock: String(this.config.polygonStartBlock),
        lastFinalizedBlock: null,
        lastFinalizedHash: null,
        revision: 0,
      });
      await repo.insert(cursor);
    }
    return cursor;
  }

  private async assertCursorCanonical(
    manager: EntityManager,
    cursor: PolygonLifecycleCursor,
  ): Promise<boolean> {
    if (cursor.lastFinalizedBlock === null || cursor.lastFinalizedHash === null) return true;
    const actualBlockHash = await this.finality.agreedBlockHash(
      Number(cursor.lastFinalizedBlock),
    );
    if (actualBlockHash === cursor.lastFinalizedHash.toLowerCase()) return true;

    const detectedAt = new Date();
    await manager
      .getRepository(PolygonChainEvent)
      .createQueryBuilder()
      .update()
      .set({ status: PolygonEventStatus.ORPHANED, orphanedAt: detectedAt })
      .where("chain_id = :chainId", { chainId: cursor.chainId })
      .andWhere("block_number >= :block", { block: cursor.lastFinalizedBlock })
      .andWhere("status = :status", { status: PolygonEventStatus.FINALIZED })
      .execute();
    const hash = evidenceHash({
      chainId: cursor.chainId,
      blockNumber: cursor.lastFinalizedBlock,
      expected: cursor.lastFinalizedHash,
      actual: actualBlockHash,
    });
    await this.breakers.tripChainIncident(
      {
        scope: SettlementCircuitScope.POLYGON,
        incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
        reasonCode: "POLYGON_FINALIZED_REORG",
        assetCode: "USDT",
        evidenceHash: hash,
        actorId: "polygon.lifecycle.indexer",
      },
      manager,
    );
    return false;
  }

  private async watchedAddresses(manager: EntityManager): Promise<string[]> {
    const rows = await manager
      .getRepository(Deal)
      .createQueryBuilder("deal")
      .select("deal.escrowAddress", "address")
      .where("deal.settlementNetwork = :network", { network: SettlementNetwork.POLYGON })
      .andWhere("deal.escrowAddress IS NOT NULL")
      .getRawMany<{ address: string }>();
    const addresses = [this.config.factoryAddress, ...rows.map((row) => row.address)]
      .filter((address) => ethers.isAddress(address))
      .map((address) => ethers.getAddress(address));
    return [...new Set(addresses)];
  }

  private async readLogs(
    addresses: string[],
    fromBlock: number,
    toBlock: number,
  ): Promise<ethers.Log[]> {
    const output: ethers.Log[] = [];
    for (let offset = 0; offset < addresses.length; offset += ADDRESS_CHUNK) {
      const chunk = addresses.slice(offset, offset + ADDRESS_CHUNK);
      if (chunk.length === 0) continue;
      output.push(...(await this.finality.agreedLogs({ address: chunk, fromBlock, toBlock })));
    }
    return output.sort(
      (left, right) => left.blockNumber - right.blockNumber || left.index - right.index,
    );
  }

  private decodeLog(log: ethers.Log): {
    eventName: string;
    escrowAddress: string | null;
    payload: Record<string, string> | null;
  } {
    const isFactory =
      log.address.toLowerCase() === this.config.factoryAddress.toLowerCase();
    try {
      const parsed = new ethers.Interface(
        normalizeAbi(isFactory ? factoryAbi : escrowAbi),
      ).parseLog(log);
      if (!parsed) throw new Error("unknown event");
      const payload: Record<string, string> = {};
      parsed.fragment.inputs.forEach((input, index) => {
        payload[input.name || String(index)] = String(parsed.args[index]);
      });
      const escrowAddress = isFactory && parsed.name === "EscrowCreated"
        ? ethers.getAddress(String(parsed.args.escrow))
        : isFactory
          ? null
          : ethers.getAddress(log.address);
      return { eventName: parsed.name, escrowAddress, payload };
    } catch {
      return {
        eventName: `UNKNOWN_${createHash("sha256").update(log.topics[0] ?? "0x").digest("hex").slice(0, 16)}`,
        escrowAddress: isFactory ? null : ethers.getAddress(log.address),
        payload: null,
      };
    }
  }

  private get db(): DataSource {
    if (!this.dataSource?.isInitialized) throw new Error("POLYGON_DATABASE_UNAVAILABLE");
    return this.dataSource;
  }
}

function deduplicateLogs(logs: ethers.Log[]): ethers.Log[] {
  const unique = new Map<string, ethers.Log>();
  for (const log of logs) {
    unique.set(`${log.transactionHash.toLowerCase()}:${log.index}`, log);
  }
  return [...unique.values()].sort(
    (left, right) => left.blockNumber - right.blockNumber || left.index - right.index,
  );
}
