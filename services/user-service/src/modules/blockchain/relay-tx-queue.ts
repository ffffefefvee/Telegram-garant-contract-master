import { Injectable, Logger, Optional } from "@nestjs/common";
import { ethers } from "ethers";
import { MoneyMovementGate } from "./money-movement.gate";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { SettlementCircuitScope } from "../safety/entities/settlement-circuit-breaker.entity";
import { PolygonRelayNonceService } from "./polygon-relay-nonce.service";
import { BlockchainConfig } from "./blockchain.config";
import { PolygonRelayTxStatus } from "./entities/polygon-lifecycle.entity";

export class RelayTransactionPendingError extends Error {
  readonly code = "POLYGON_RELAY_TRANSACTION_PENDING";

  constructor(readonly transactionHash: string | null) {
    super(`Polygon relay transaction is pending confirmation: ${transactionHash ?? "unbroadcast"}`);
    this.name = RelayTransactionPendingError.name;
  }
}

export class RelayTransactionFailedError extends Error {
  readonly code = "POLYGON_RELAY_TRANSACTION_FAILED";

  constructor(readonly transactionHash: string, readonly failureCode: string | null) {
    super(`Polygon relay transaction failed terminally: ${failureCode ?? "UNKNOWN_FAILURE"}`);
    this.name = RelayTransactionFailedError.name;
  }
}

/**
 * Serializes every transaction signed by the shared relay hot-wallet.
 *
 * The relay signer is used concurrently by several callers — the Cryptomus
 * webhook, the direct-deposit watcher, the reconciliation cron and the
 * treasury reconcile cron. If two of them broadcast at the same time, ethers
 * fetches the same `pending` nonce for both, and the node rejects the second
 * with "nonce too low" / "replacement transaction underpriced" — silently
 * dropping a fund-forwarding tx.
 *
 * This queue runs relay transactions one at a time: a task is not started
 * until the previous one has fully settled (broadcast AND confirmation), so
 * each tx observes the updated on-chain nonce of its predecessor. Throughput
 * is intentionally traded for correctness — relay volume is low, and a dropped
 * USDT transfer is far costlier than a few seconds of queueing.
 *
 * Only relay-signed writes go through here. User/arbitrator-signed txs (e.g.
 * `resolve()` from an arbitrator wallet) use a different signer and nonce
 * sequence, so they must NOT be enqueued.
 */
@Injectable()
export class RelayTxQueue {
  private readonly logger = new Logger(RelayTxQueue.name);

  /**
   * Tail of the serialization chain. Always resolves (never rejects) once the
   * current task settles, so a failing task can't break the chain for the
   * next one.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly moneyMovementGate: MoneyMovementGate,
    private readonly circuitBreaker: SettlementCircuitBreakerService,
    @Optional() private readonly durableNonce?: PolygonRelayNonceService,
    @Optional() private readonly config?: BlockchainConfig,
  ) {}

  /**
   * Enqueue a relay transaction. `run` must perform the full broadcast +
   * `wait()` so the nonce is consumed on-chain before the next task starts.
   *
   * @param label human-readable tag for logs/diagnostics
   * @param run   the broadcast-and-confirm work
   * @returns whatever `run` resolves to (typically the tx hash)
   */
  submit(
    label: string,
    run: (overrides?: ethers.TransactionRequest) => Promise<ethers.TransactionResponse>,
  ): Promise<string>;
  submit<T>(
    label: string,
    run: (overrides?: ethers.TransactionRequest) => Promise<T>,
  ): Promise<T>;
  submit<T>(
    label: string,
    run: (overrides?: ethers.TransactionRequest) => Promise<T>,
  ): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    return previous
      .then(async () => {
        // This check is deliberately inside the queued task, immediately
        // before the signer is used. It protects work that was queued before
        // a future dynamic safety stop is activated as well as new work.
        this.moneyMovementGate.assertRelayOperationAllowed(label);
        await this.circuitBreaker.assertEgressAllowed(
          SettlementCircuitScope.POLYGON,
        );
        return this.execute(label, run);
      })
      .finally(() => release());
  }

  private async execute<T>(
    label: string,
    run: (overrides?: ethers.TransactionRequest) => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    this.logger.debug(`relay tx start: ${label}`);
    if (!this.durableNonce) {
      try {
        const result = await run();
        this.logger.debug(`relay tx done: ${label} (${Date.now() - startedAt}ms)`);
        return result;
      } catch (err) {
        this.logger.warn(`relay tx failed: ${label}: ${(err as Error).message}`);
        throw err;
      }
    }

    const operationKind = label.split(/\s+/, 1)[0] || "relay.write";
    const reservation = await this.durableNonce.reserve(operationKind, label);
    if (
      reservation.status === PolygonRelayTxStatus.CONFIRMED &&
      reservation.currentTxHash
    ) {
      return reservation.currentTxHash as T;
    }
    if (
      reservation.status === PolygonRelayTxStatus.BROADCAST ||
      reservation.status === PolygonRelayTxStatus.REPLACING ||
      reservation.status === PolygonRelayTxStatus.REPLACED
    ) {
      throw new RelayTransactionPendingError(reservation.currentTxHash);
    }
    if (
      reservation.status === PolygonRelayTxStatus.FAILED &&
      reservation.currentTxHash
    ) {
      throw new RelayTransactionFailedError(
        reservation.currentTxHash,
        reservation.failureCode,
      );
    }
    let broadcasted = false;
    try {
      const result = await run({ nonce: Number(reservation.nonce) });
      if (!isTransactionResponse(result)) {
        throw new Error("DURABLE_RELAY_REQUIRES_TRANSACTION_RESPONSE");
      }
      await this.durableNonce.recordBroadcast(reservation.id, result);
      broadcasted = true;
      const receipt = await result.wait(
        1,
        this.config?.polygonRelayTxTimeoutMs ?? 120_000,
      );
      if (!receipt) throw new RelayTransactionPendingError(result.hash);
      if (receipt.status !== 1) {
        await this.durableNonce.recordFailure(reservation.id, "TRANSACTION_REVERTED");
        throw new Error("POLYGON_RELAY_TRANSACTION_REVERTED");
      }
      await this.durableNonce.recordConfirmed(reservation.id, receipt);
      this.logger.debug(
        `relay tx done: ${label} (${Date.now() - startedAt}ms)`,
      );
      return receipt.hash as T;
    } catch (err) {
      if (!broadcasted) {
        await this.durableNonce.recordFailure(
          reservation.id,
          (err as { code?: string }).code ?? (err as Error).name,
        );
      }
      this.logger.warn(`relay tx failed: ${label}: ${(err as Error).message}`);
      throw err;
    }
  }
}

function isTransactionResponse(value: unknown): value is ethers.TransactionResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ethers.TransactionResponse).hash === "string" &&
      typeof (value as ethers.TransactionResponse).wait === "function",
  );
}
