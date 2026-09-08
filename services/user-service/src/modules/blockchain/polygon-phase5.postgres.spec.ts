import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { databaseConfig } from "../../config/database";
import { BlockchainConfig } from "./blockchain.config";
import { BlockchainProvider } from "./blockchain.provider";
import { MoneyMovementGate } from "./money-movement.gate";
import { PolygonRelayNonceService } from "./polygon-relay-nonce.service";
import { PolygonRelayTransaction, PolygonRelayTxStatus } from "./entities/polygon-lifecycle.entity";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { PolygonLifecycleIngestionService } from "./polygon-lifecycle-ingestion.service";
import { PolygonFinalityService } from "./polygon-finality.service";

const runPostgres = process.env.RUN_PHASE5_POSTGRES === "true";
const describePostgres = runPostgres ? describe : describe.skip;
const ADDRESS = "0x0000000000000000000000000000000000000011";
const HASH = (digit: string) => `0x${digit.repeat(64)}`;

describePostgres("Phase 5 Polygon PostgreSQL durability gate", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ ...databaseConfig, synchronize: false, logging: false });
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: "each" });
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE TABLE polygon_reconciliations, polygon_chain_events, polygon_lifecycle_cursors,
        polygon_relay_transactions, polygon_relay_nonce_state RESTART IDENTITY CASCADE
    `);
  });

  it("deduplicates finalized logs and makes their evidence append-only", async () => {
    const id = randomUUID();
    const values = [
      id,
      80002,
      ADDRESS,
      "Funded",
      HASH("1"),
      0,
      100,
      HASH("2"),
      JSON.stringify([HASH("3")]),
      "0x",
      "a".repeat(64),
    ];
    await dataSource.query(
      `INSERT INTO polygon_chain_events (
        id, chain_id, contract_address, event_name, transaction_hash, log_index,
        block_number, block_hash, topics, data, status, evidence_hash, finalized_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'finalized',$11,now())`,
      values,
    );
    await expect(
      dataSource.query(
        `INSERT INTO polygon_chain_events (
          id, chain_id, contract_address, event_name, transaction_hash, log_index,
          block_number, block_hash, topics, data, status, evidence_hash, finalized_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'finalized',$11,now())`,
        [randomUUID(), ...values.slice(1)],
      ),
    ).rejects.toThrow(/polygon_chain_events_chain_id_transaction_hash_log_index/i);
    await expect(
      dataSource.query(`UPDATE polygon_chain_events SET block_hash = $2 WHERE id = $1`, [id, HASH("4")]),
    ).rejects.toThrow("polygon event evidence is immutable");
    await expect(
      dataSource.query(`DELETE FROM polygon_chain_events WHERE id = $1`, [id]),
    ).rejects.toThrow("immutable settlement evidence cannot be changed");
  });

  it("allocates distinct relay nonces under concurrent workers", async () => {
    const { service } = nonceHarness(dataSource, 11);
    const reservations = await Promise.all([
      service.reserve("escrow.notifyFunded", "deal-a"),
      service.reserve("escrow.notifyFunded", "deal-b"),
      service.reserve("factory.createEscrow", "deal-c"),
    ]);
    expect(reservations.map((entry) => entry.nonce).sort()).toEqual(["11", "12", "13"]);
    const state = await dataSource.query(
      `SELECT next_nonce FROM polygon_relay_nonce_state WHERE chain_id = 80002`,
    );
    expect(state[0].next_nonce).toBe("14");
  });

  it("returns one reservation for concurrent retries of the same logical operation", async () => {
    const { service } = nonceHarness(dataSource, 21);
    const reservations = await Promise.all([
      service.reserve("erc20.transfer", "payment-immutable-key"),
      service.reserve("erc20.transfer", "payment-immutable-key"),
    ]);
    expect(reservations[0].id).toBe(reservations[1].id);
    expect(reservations[0].nonce).toBe("21");
    const rows = await dataSource.query(`SELECT count(*)::int AS count FROM polygon_relay_transactions`);
    expect(rows[0].count).toBe(1);
  });

  it("persists fee-bumped replacement history for a stuck transaction", async () => {
    const { service, signer, provider } = nonceHarness(dataSource, 31);
    const reservation = await service.reserve("escrow.notifyFunded", "stuck-deal");
    await service.recordBroadcast(reservation.id, transactionResponse(HASH("5"), 31) as never);
    await dataSource.query(
      `UPDATE polygon_relay_transactions SET updated_at = now() - interval '10 minutes' WHERE id = $1`,
      [reservation.id],
    );
    provider.getTransactionReceipt.mockResolvedValue(null);
    signer.sendTransaction.mockResolvedValue(transactionResponse(HASH("6"), 31));

    const recovered = await Promise.all([service.recoverStuck(), service.recoverStuck()]);
    expect(recovered.reduce((sum, value) => sum + value, 0)).toBe(1);
    const record = await dataSource.getRepository(PolygonRelayTransaction).findOneByOrFail({
      id: reservation.id,
    });
    expect(record.status).toBe(PolygonRelayTxStatus.REPLACED);
    expect(record.currentTxHash).toBe(HASH("6"));
    expect(record.replacedTxHashes).toEqual([HASH("5")]);
    expect(record.attempts).toBe(2);
    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 31, maxFeePerGas: 125n, maxPriorityFeePerGas: 13n }),
    );
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("trips the Polygon circuit after bounded replacement attempts", async () => {
    const { service, breakers } = nonceHarness(dataSource, 41, 1);
    const reservation = await service.reserve("escrow.notifyFunded", "permanently-stuck");
    await service.recordBroadcast(reservation.id, transactionResponse(HASH("7"), 41) as never);
    await dataSource.query(
      `UPDATE polygon_relay_transactions SET updated_at = now() - interval '10 minutes' WHERE id = $1`,
      [reservation.id],
    );
    await expect(service.recoverStuck()).resolves.toBe(0);
    const record = await dataSource.getRepository(PolygonRelayTransaction).findOneByOrFail({
      id: reservation.id,
    });
    expect(record.status).toBe(PolygonRelayTxStatus.FAILED);
    expect(record.failureCode).toBe("STUCK_MAX_ATTEMPTS");
    expect(breakers.tripChainIncident).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "POLYGON_RELAY_STUCK" }),
    );
  });

  it("advances a finalized cursor and persists a later reorg incident before failing", async () => {
    const provider = {
      getLogs: jest.fn().mockResolvedValue([]),
      getBlock: jest.fn().mockResolvedValue({ hash: HASH("8") }),
    };
    const blockchain = { isReady: true, provider } as unknown as BlockchainProvider;
    const config = {
      polygonIndexerEnabled: true,
      chainId: 80002,
      polygonStartBlock: 50,
      polygonLogBatchSize: 10,
      factoryAddress: ADDRESS,
    } as BlockchainConfig;
    const finality = {
      finalizedAnchor: jest.fn().mockResolvedValue({
        chainId: 80002,
        blockNumber: 59,
        blockHash: HASH("8"),
        evidenceHash: "8".repeat(64),
        sources: 2,
      }),
    };
    const breakers = { tripChainIncident: jest.fn().mockResolvedValue(undefined) };
    const service = new PolygonLifecycleIngestionService(
      config,
      blockchain,
      finality as unknown as PolygonFinalityService,
      breakers as unknown as SettlementCircuitBreakerService,
      dataSource,
    );
    await expect(service.runOnce()).resolves.toEqual(
      expect.objectContaining({ fromBlock: 50, toBlock: 59 }),
    );
    const cursor = await dataSource.query(
      `SELECT next_block, last_finalized_block, last_finalized_hash
       FROM polygon_lifecycle_cursors WHERE chain_id = 80002`,
    );
    expect(cursor[0]).toEqual({
      next_block: "60",
      last_finalized_block: "59",
      last_finalized_hash: HASH("8"),
    });

    finality.finalizedAnchor.mockResolvedValue({
      chainId: 80002,
      blockNumber: 69,
      blockHash: HASH("9"),
      evidenceHash: "9".repeat(64),
      sources: 2,
    });
    provider.getBlock.mockResolvedValue({ hash: HASH("9") });
    await expect(service.runOnce()).rejects.toThrow("POLYGON_FINALIZED_REORG");
    expect(breakers.tripChainIncident).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "POLYGON_FINALIZED_REORG" }),
      expect.anything(),
    );
    const unchanged = await dataSource.query(
      `SELECT next_block FROM polygon_lifecycle_cursors WHERE chain_id = 80002`,
    );
    expect(unchanged[0].next_block).toBe("60");
  });
});

function nonceHarness(dataSource: DataSource, pendingNonce: number, maxAttempts = 5) {
  const signer = {
    getAddress: jest.fn().mockResolvedValue(ADDRESS),
    sendTransaction: jest.fn(),
  };
  const provider = {
    getTransactionCount: jest.fn().mockResolvedValue(pendingNonce),
    getTransactionReceipt: jest.fn().mockResolvedValue(null),
    getFeeData: jest.fn().mockResolvedValue({
      gasPrice: 100n,
      maxFeePerGas: 100n,
      maxPriorityFeePerGas: 10n,
    }),
  };
  const blockchain = { isReady: true, signer, provider } as unknown as BlockchainProvider;
  const config = {
    chainId: 80002,
    polygonRelayStuckSeconds: 30,
    polygonRelayMaxAttempts: maxAttempts,
  } as BlockchainConfig;
  const gate = { assertRelayOperationAllowed: jest.fn() };
  const breakers = {
    assertEgressAllowed: jest.fn().mockResolvedValue(undefined),
    tripChainIncident: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new PolygonRelayNonceService(
      config,
      blockchain,
      gate as unknown as MoneyMovementGate,
      breakers as unknown as SettlementCircuitBreakerService,
      dataSource,
    ),
    signer,
    provider,
    breakers,
  };
}

function transactionResponse(hash: string, nonce: number) {
  return {
    hash,
    to: "0x0000000000000000000000000000000000000022",
    data: "0x1234",
    value: 0n,
    gasLimit: 100_000n,
    gasPrice: null,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 10n,
    nonce,
  };
}
