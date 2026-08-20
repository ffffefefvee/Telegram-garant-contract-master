import { TonNativeChainEvent } from "./entities/ton-native-chain-event.entity";
import { TonNativeEventApplyLockService } from "./ton-native-event-apply-lock.service";

describe("TonNativeEventApplyLockService", () => {
  function setup(event: Partial<TonNativeChainEvent> | null) {
    const query = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(event),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    };
    const runner = {
      manager: { getRepository: jest.fn().mockReturnValue(repository) },
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
    };
    const dataSource = {
      options: { type: "postgres" },
      createQueryRunner: jest.fn().mockReturnValue(runner),
    } as any;
    return {
      query,
      runner,
      service: new TonNativeEventApplyLockService(dataSource),
    };
  }

  it("uses a skip-locked PostgreSQL row lock while applying an event", async () => {
    const event = { id: "event-1", appliedAt: null, automationStoppedAt: null };
    const { query, runner, service } = setup(event);
    const handler = jest.fn().mockResolvedValue("done");

    await expect(service.run(event.id, handler)).resolves.toEqual({
      status: "acquired",
      value: "done",
    });
    expect(query.setLock).toHaveBeenCalledWith("pessimistic_write");
    expect(query.setOnLocked).toHaveBeenCalledWith("skip_locked");
    expect(handler).toHaveBeenCalledWith(event, runner.manager);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it("reports a concurrently locked row as busy without running effects", async () => {
    const { runner, service } = setup(null);
    const handler = jest.fn();

    await expect(service.run("event-1", handler)).resolves.toEqual({
      status: "busy",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it("releases the database lock on a crashed application attempt", async () => {
    const event = { id: "event-1", appliedAt: null, automationStoppedAt: null };
    const { runner, service } = setup(event);

    await expect(
      service.run(event.id, async () => {
        throw new Error("simulated process failure");
      }),
    ).rejects.toThrow("simulated process failure");
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it("does not replay an event already marked applied", async () => {
    const event = {
      id: "event-1",
      appliedAt: new Date(),
      automationStoppedAt: null,
    };
    const { service } = setup(event);
    const handler = jest.fn();

    await expect(service.run(event.id, handler)).resolves.toEqual({
      status: "already_applied",
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
