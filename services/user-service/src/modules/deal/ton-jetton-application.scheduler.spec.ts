import { TonJettonApplicationScheduler } from "./ton-jetton-application.scheduler";

function harness(enabled: boolean, batch: string | number = 16) {
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === "TON_JETTON_APPLICATION_WORKER_ENABLED") return enabled;
      if (key === "TON_JETTON_APPLICATION_WORKER_BATCH") return batch;
      return fallback;
    }),
  };
  const application = { applyNext: jest.fn() };
  return {
    scheduler: new TonJettonApplicationScheduler(
      config as never,
      application as never,
    ),
    application,
  };
}

describe("TonJettonApplicationScheduler", () => {
  it("is fail-closed and does no work unless explicitly enabled", async () => {
    const h = harness(false);

    await expect(h.scheduler.tick()).resolves.toBe(0);
    expect(h.application.applyNext).not.toHaveBeenCalled();
  });

  it("drains a bounded batch until the worker reports idle", async () => {
    const h = harness(true, 3);
    h.application.applyNext
      .mockResolvedValueOnce({ status: "applied", eventId: "one" })
      .mockResolvedValueOnce({ status: "applied", eventId: "two" })
      .mockResolvedValueOnce({ status: "idle" });

    await expect(h.scheduler.tick()).resolves.toBe(2);
    expect(h.application.applyNext).toHaveBeenCalledTimes(3);
  });

  it("stops the tick after a failed attempt so retries are temporally bounded", async () => {
    const h = harness(true, 64);
    h.application.applyNext.mockResolvedValue({
      status: "retry_pending",
      eventId: "one",
      attempts: 1,
    });

    await expect(h.scheduler.tick()).resolves.toBe(0);
    expect(h.application.applyNext).toHaveBeenCalledTimes(1);
  });
});
