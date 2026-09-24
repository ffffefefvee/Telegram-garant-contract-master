import { AuditLogEntry } from "./entities/audit-log.entity";
import {
  canonicalJson,
  createAuditWormEnvelope,
  verifyAuditWormEnvelope,
} from "./audit-worm.service";

function row(sequence: number): AuditLogEntry {
  return Object.assign(new AuditLogEntry(), {
    id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    exportSequence: String(sequence),
    actorId: null,
    actorRole: "system",
    aggregateType: "probe",
    aggregateId: `probe-${sequence}`,
    action: "PROBE",
    details: { nested: { z: sequence, a: true } },
    createdAt: new Date(`2026-09-20T00:00:0${sequence}.000Z`),
  });
}

describe("audit WORM envelope", () => {
  it("canonicalizes object keys recursively", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });

  it("verifies a consecutive batch and its previous-manifest link", () => {
    const previous = "a".repeat(64);
    const envelope = createAuditWormEnvelope([row(7), row(8)], previous);
    expect(() => verifyAuditWormEnvelope(envelope, previous, 7n)).not.toThrow();
  });

  it("detects a gap or reordering", () => {
    const envelope = createAuditWormEnvelope([row(7), row(9)], "0".repeat(64));
    expect(() =>
      verifyAuditWormEnvelope(envelope, "0".repeat(64), 7n),
    ).toThrow("gap, duplicate or reordering");
  });

  it("detects record mutation and chain replay", () => {
    const envelope = createAuditWormEnvelope([row(1)], "0".repeat(64));
    envelope.records[0].action = "ALTERED";
    expect(() =>
      verifyAuditWormEnvelope(envelope, "0".repeat(64), 1n),
    ).toThrow("manifest or hash chain");

    const replay = createAuditWormEnvelope([row(1)], "0".repeat(64));
    expect(() => verifyAuditWormEnvelope(replay, "b".repeat(64), 1n)).toThrow(
      "manifest or hash chain",
    );
  });
});
