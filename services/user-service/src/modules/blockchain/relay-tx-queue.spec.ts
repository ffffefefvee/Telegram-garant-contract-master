import { RelayTxQueue } from "./relay-tx-queue";
import {
  MoneyMovementDisabledError,
  MoneyMovementGate,
} from "./money-movement.gate";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { PolygonRelayNonceService } from "./polygon-relay-nonce.service";
import { BlockchainConfig } from "./blockchain.config";
import { PolygonRelayTxStatus } from "./entities/polygon-lifecycle.entity";
import { RelayTransactionPendingError } from "./relay-tx-queue";

/** Resolves after `ms`, recording start/end so we can assert non-overlap. */
function deferred(ms: number, onStart: () => void, onEnd: () => void) {
  return () =>
    new Promise<string>((resolve) => {
      onStart();
      setTimeout(() => {
        onEnd();
        resolve(`done-${ms}`);
      }, ms);
    });
}

describe("RelayTxQueue", () => {
  let queue: RelayTxQueue;
  let moneyMovementGate: { assertRelayOperationAllowed: jest.Mock };
  let circuitBreaker: { assertEgressAllowed: jest.Mock };

  beforeEach(() => {
    moneyMovementGate = {
      assertRelayOperationAllowed: jest.fn(),
    };
    circuitBreaker = {
      assertEgressAllowed: jest.fn().mockResolvedValue(undefined),
    };
    queue = new RelayTxQueue(
      moneyMovementGate as unknown as MoneyMovementGate,
      circuitBreaker as unknown as SettlementCircuitBreakerService,
    );
  });

  it("runs tasks one at a time (no overlap) even when submitted concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const make = (ms: number) =>
      deferred(
        ms,
        () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
        },
        () => {
          active -= 1;
        },
      );

    await Promise.all([
      queue.submit("a", make(30)),
      queue.submit("b", make(5)),
      queue.submit("c", make(15)),
    ]);

    // If the queue serializes correctly, only one task is ever in-flight.
    expect(maxActive).toBe(1);
  });

  it("preserves submission order (FIFO)", async () => {
    const order: string[] = [];
    const make = (label: string, ms: number) => () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(label);
          resolve();
        }, ms);
      });

    // Submit a slow task first; a fast one queued after must still run later.
    await Promise.all([
      queue.submit("first", make("first", 20)),
      queue.submit("second", make("second", 1)),
    ]);

    expect(order).toEqual(["first", "second"]);
  });

  it("returns the task result to the caller", async () => {
    await expect(queue.submit("x", async () => 42)).resolves.toBe(42);
    expect(moneyMovementGate.assertRelayOperationAllowed).toHaveBeenCalledWith(
      "x",
    );
    expect(circuitBreaker.assertEgressAllowed).toHaveBeenCalledTimes(1);
  });

  it("never invokes a queued task while the money-egress safety stop is active", async () => {
    moneyMovementGate.assertRelayOperationAllowed.mockImplementation(() => {
      throw new MoneyMovementDisabledError("erc20.transfer");
    });
    const run = jest.fn(async () => "tx-hash");

    await expect(
      queue.submit("erc20.transfer 1→0xabc", run),
    ).rejects.toMatchObject({
      code: "MONEY_EGRESS_DISABLED",
    });
    expect(run).not.toHaveBeenCalled();
    expect(circuitBreaker.assertEgressAllowed).not.toHaveBeenCalled();
  });

  it("never invokes a Polygon relay task while its durable circuit is tripped", async () => {
    circuitBreaker.assertEgressAllowed.mockRejectedValue(
      new Error("POLYGON_BREAKER_TRIPPED"),
    );
    const run = jest.fn(async () => "tx-hash");

    await expect(queue.submit("erc20.transfer", run)).rejects.toThrow(
      "POLYGON_BREAKER_TRIPPED",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("propagates a task failure to its caller", async () => {
    await expect(
      queue.submit("boom", async () => {
        throw new Error("tx reverted");
      }),
    ).rejects.toThrow("tx reverted");
  });

  it("keeps the chain alive: a failing task does not block subsequent ones", async () => {
    const failing = queue
      .submit("fail", async () => {
        throw new Error("nonce too low");
      })
      .catch(() => "caught");
    const next = queue.submit("ok", async () => "ok");

    await expect(failing).resolves.toBe("caught");
    await expect(next).resolves.toBe("ok");
  });

  it("durably reserves a nonce before broadcast and records confirmation", async () => {
    const durable = {
      reserve: jest.fn().mockResolvedValue({
        id: "reservation-1",
        nonce: "17",
        status: PolygonRelayTxStatus.RESERVED,
        currentTxHash: null,
      }),
      recordBroadcast: jest.fn().mockResolvedValue(undefined),
      recordConfirmed: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    const durableQueue = new RelayTxQueue(
      moneyMovementGate as unknown as MoneyMovementGate,
      circuitBreaker as unknown as SettlementCircuitBreakerService,
      durable as unknown as PolygonRelayNonceService,
      { polygonRelayTxTimeoutMs: 10_000 } as BlockchainConfig,
    );
    const receipt = { hash: "0x" + "2".repeat(64), status: 1, blockNumber: 42 };
    const response = {
      hash: "0x" + "1".repeat(64),
      wait: jest.fn().mockResolvedValue(receipt),
    };
    const run = jest.fn().mockResolvedValue(response);

    await expect(durableQueue.submit("escrow.notifyFunded 0xabc", run)).resolves.toBe(
      receipt.hash,
    );
    expect(run).toHaveBeenCalledWith({ nonce: 17 });
    expect(durable.recordBroadcast).toHaveBeenCalledWith("reservation-1", response);
    expect(durable.recordConfirmed).toHaveBeenCalledWith("reservation-1", receipt);
    expect(durable.recordFailure).not.toHaveBeenCalled();
  });

  it("returns the durable result for an already-confirmed idempotent operation", async () => {
    const hash = "0x" + "3".repeat(64);
    const durable = {
      reserve: jest.fn().mockResolvedValue({
        id: "reservation-2",
        nonce: "18",
        status: PolygonRelayTxStatus.CONFIRMED,
        currentTxHash: hash,
      }),
    };
    const durableQueue = new RelayTxQueue(
      moneyMovementGate as unknown as MoneyMovementGate,
      circuitBreaker as unknown as SettlementCircuitBreakerService,
      durable as unknown as PolygonRelayNonceService,
    );
    const run = jest.fn();
    await expect(durableQueue.submit("escrow.notifyFunded 0xdef", run)).resolves.toBe(hash);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not rebroadcast an operation that already has a pending hash", async () => {
    const hash = "0x" + "4".repeat(64);
    const durable = {
      reserve: jest.fn().mockResolvedValue({
        id: "reservation-3",
        nonce: "19",
        status: PolygonRelayTxStatus.BROADCAST,
        currentTxHash: hash,
      }),
    };
    const durableQueue = new RelayTxQueue(
      moneyMovementGate as unknown as MoneyMovementGate,
      circuitBreaker as unknown as SettlementCircuitBreakerService,
      durable as unknown as PolygonRelayNonceService,
    );
    const run = jest.fn();
    await expect(durableQueue.submit("factory.createEscrow deal", run)).rejects.toEqual(
      new RelayTransactionPendingError(hash),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("records pre-broadcast failures without consuming another nonce", async () => {
    const durable = {
      reserve: jest.fn().mockResolvedValue({
        id: "reservation-4",
        nonce: "20",
        status: PolygonRelayTxStatus.RESERVED,
        currentTxHash: null,
      }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    const durableQueue = new RelayTxQueue(
      moneyMovementGate as unknown as MoneyMovementGate,
      circuitBreaker as unknown as SettlementCircuitBreakerService,
      durable as unknown as PolygonRelayNonceService,
    );
    await expect(
      durableQueue.submit("erc20.transfer logical-payment", async () => {
        throw new Error("signer unavailable");
      }),
    ).rejects.toThrow("signer unavailable");
    expect(durable.recordFailure).toHaveBeenCalledWith("reservation-4", "Error");
  });
});
