import { RelayTxQueue } from './relay-tx-queue';

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

  beforeEach(() => {
    queue = new RelayTxQueue();
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
