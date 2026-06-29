import { Injectable, Logger } from '@nestjs/common';

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

  /**
   * Enqueue a relay transaction. `run` must perform the full broadcast +
   * `wait()` so the nonce is consumed on-chain before the next task starts.
   *
   * @param label human-readable tag for logs/diagnostics
   * @param run   the broadcast-and-confirm work
   * @returns whatever `run` resolves to (typically the tx hash)
   */
  submit<T>(label: string, run: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    return previous
      .then(() => this.execute(label, run))
      .finally(() => release());
  }

  private async execute<T>(label: string, run: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    this.logger.debug(`relay tx start: ${label}`);
    try {
      const result = await run();
      this.logger.debug(`relay tx done: ${label} (${Date.now() - startedAt}ms)`);
      return result;
    } catch (err) {
      this.logger.warn(`relay tx failed: ${label}: ${(err as Error).message}`);
      throw err;
    }
  }
}
