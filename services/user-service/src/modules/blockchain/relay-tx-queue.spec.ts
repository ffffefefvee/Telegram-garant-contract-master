import { RelayTxQueue } from './relay-tx-queue';
import {
  MoneyMovementDisabledError,
  MoneyMovementGate,
} from './money-movement.gate';

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

describe('RelayTxQueue', () => {
  let queue: RelayTxQueue;
  let moneyMovementGate: { assertRelayOperationAllowed: jest.Mock };

  beforeEach(() => {
    moneyMovementGate = {
      assertRelayOperationAllowed: jest.fn(),
    };
    queue = new RelayTxQueue(moneyMovementGate as unknown as MoneyMovementGate);
  });

  it('runs tasks one at a time (no overlap) even when submitted concurrently', async () => {
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
      queue.submit('a', make(30)),
      queue.submit('b', make(5)),
      queue.submit('c', make(15)),
    ]);

    // If the queue serializes correctly, only one task is ever in-flight.
    expect(maxActive).toBe(1);
  });

  it('preserves submission order (FIFO)', async () => {
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
      queue.submit('first', make('first', 20)),
      queue.submit('second', make('second', 1)),
    ]);

    expect(order).toEqual(['first', 'second']);
  });

  it('returns the task result to the caller', async () => {
    await expect(queue.submit('x', async () => 42)).resolves.toBe(42);
    expect(moneyMovementGate.assertRelayOperationAllowed).toHaveBeenCalledWith('x');
  });

  it('never invokes a queued task while the money-egress safety stop is active', async () => {
    moneyMovementGate.assertRelayOperationAllowed.mockImplementation(() => {
      throw new MoneyMovementDisabledError('erc20.transfer');
    });
    const run = jest.fn(async () => 'tx-hash');

    await expect(queue.submit('erc20.transfer 1→0xabc', run)).rejects.toMatchObject({
      code: 'MONEY_EGRESS_DISABLED',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('propagates a task failure to its caller', async () => {
    await expect(
      queue.submit('boom', async () => {
        throw new Error('tx reverted');
      }),
    ).rejects.toThrow('tx reverted');
  });

  it('keeps the chain alive: a failing task does not block subsequent ones', async () => {
    const failing = queue
      .submit('fail', async () => {
        throw new Error('nonce too low');
      })
      .catch(() => 'caught');
    const next = queue.submit('ok', async () => 'ok');

    await expect(failing).resolves.toBe('caught');
    await expect(next).resolves.toBe('ok');
  });
});
