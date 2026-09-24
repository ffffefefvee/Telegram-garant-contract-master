import { EvidenceRetentionScheduler } from "./evidence-retention.scheduler";

describe("EvidenceRetentionScheduler", () => {
  const manifest = {
    id: "manifest-1",
    evidenceId: "evidence-1",
    storageKey: "clean/object-1",
    sha256: "a".repeat(64),
    retentionUntil: new Date("2025-01-01T00:00:00Z"),
    deletedAt: null,
    deletionReason: null,
    deletionAttempts: 0,
    deletionNextAttemptAt: null,
    deletionLastError: null,
    deletionDeadLetterAt: null,
  };
  const manifests = {
    find: jest.fn(),
    update: jest.fn(),
  };
  const storage = { delete: jest.fn() };
  const locked = { ...manifest };
  const repo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const manager = { getRepository: jest.fn(() => repo) };
  const dataSource = { transaction: jest.fn((callback) => callback(manager)) };
  const audit = { writeRequired: jest.fn() };
  const config = { get: jest.fn(() => "true") };
  const scheduler = new EvidenceRetentionScheduler(
    manifests as any,
    storage as any,
    dataSource as any,
    audit as any,
    config as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    manifests.find.mockResolvedValue([{ ...manifest }]);
    storage.delete.mockResolvedValue(undefined);
    repo.findOne.mockResolvedValue({ ...locked });
    repo.save.mockImplementation(async (value) => value);
    audit.writeRequired.mockResolvedValue({ id: "audit-1" });
  });

  it("deletes expired bytes and atomically records a tombstone and audit", async () => {
    await scheduler.run();
    expect(storage.delete).toHaveBeenCalledWith("clean/object-1");
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: expect.any(Date),
        deletionReason: "retention_expired",
        deletionAttempts: 1,
      }),
    );
    expect(audit.writeRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EVIDENCE_RETENTION_DELETED",
        manager,
      }),
    );
  });

  it("schedules a bounded retry without writing a false tombstone", async () => {
    storage.delete.mockRejectedValue(new Error("storage timeout\nsecret detail"));
    await scheduler.run();
    expect(repo.save).not.toHaveBeenCalled();
    expect(manifests.update).toHaveBeenCalledWith(
      "manifest-1",
      expect.objectContaining({
        deletionAttempts: 1,
        deletionLastError: "storage timeout secret detail",
        deletionNextAttemptAt: expect.any(Date),
        deletionDeadLetterAt: null,
      }),
    );
  });
});
