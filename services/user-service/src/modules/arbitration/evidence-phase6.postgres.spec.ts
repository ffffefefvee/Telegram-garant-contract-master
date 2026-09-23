import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { databaseConfig } from "../../config/database";

const runPostgres = process.env.RUN_PHASE6_POSTGRES === "true";
const describePostgres = runPostgres ? describe : describe.skip;

describePostgres("Phase 6 evidence manifest PostgreSQL gate", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      ...databaseConfig,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: "each" });
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("installs the manifest table and immutable-field trigger", async () => {
    const rows = await dataSource.query(`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_table = 'evidence_file_manifests'
        AND trigger_name = 'evidence_manifest_immutable'
    `);
    expect(rows).toHaveLength(1);
  });

  it("rejects manifest rewrites and permits only one deletion tombstone", async () => {
    await dataSource.query(`
      CREATE TEMP TABLE phase6_manifest_probe
      (LIKE evidence_file_manifests INCLUDING ALL)
      ON COMMIT PRESERVE ROWS
    `);
    await dataSource.query(`
      CREATE TRIGGER phase6_manifest_probe_immutable
      BEFORE UPDATE ON phase6_manifest_probe
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_manifest_rewrite()
    `);

    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO phase6_manifest_probe (
        id, evidence_id, storage_key, media_type, size, sha256,
        scanner_name, scanner_version, scanner_policy_version,
        scanner_result_id, scan_evidence_hash, manifest_hash,
        scanned_at, retention_until
      ) VALUES ($1,$2,$3,'image/png',12,$4,'scanner-a','1.0','policy-v1',$5,$6,$7,now(),now() + interval '365 days')`,
      [
        id,
        randomUUID(),
        `clean/${id}`,
        "a".repeat(64),
        `scan-${id}`,
        "b".repeat(64),
        "c".repeat(64),
      ],
    );

    await expect(
      dataSource.query(
        "UPDATE phase6_manifest_probe SET sha256 = $2 WHERE id = $1",
        [id, "d".repeat(64)],
      ),
    ).rejects.toThrow("evidence manifest fields are immutable");

    await expect(
      dataSource.query(
        "UPDATE phase6_manifest_probe SET deleted_at = now(), deletion_reason = 'retention expired' WHERE id = $1",
        [id],
      ),
    ).resolves.toBeDefined();
    await expect(
      dataSource.query(
        "UPDATE phase6_manifest_probe SET deletion_reason = 'rewritten' WHERE id = $1",
        [id],
      ),
    ).rejects.toThrow("evidence deletion tombstone is immutable");
  });

  it("enforces append-only audit records in PostgreSQL", async () => {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO audit_log (
        id, "aggregateType", "aggregateId", action, details
      ) VALUES ($1,'phase6_probe',$2,'PHASE6_AUDIT_PROBE','{}'::jsonb)`,
      [id, id],
    );

    await expect(
      dataSource.query(
        "UPDATE audit_log SET action = 'REWRITTEN' WHERE id = $1",
        [id],
      ),
    ).rejects.toThrow("audit log is append-only");
    await expect(
      dataSource.query("DELETE FROM audit_log WHERE id = $1", [id]),
    ).rejects.toThrow("audit log is append-only");
  });

  it("assigns a unique monotonic export sequence to audit rows", async () => {
    const first = randomUUID();
    const second = randomUUID();
    await dataSource.query(
      `INSERT INTO audit_log
      (id, "aggregateType", "aggregateId", action, details)
      VALUES ($1,'phase6_probe',$3,'WORM_SEQUENCE_PROBE','{}'::jsonb),
             ($2,'phase6_probe',$4,'WORM_SEQUENCE_PROBE','{}'::jsonb)`,
      [first, second, first, second],
    );
    const rows = await dataSource.query(
      `SELECT export_sequence FROM audit_log
       WHERE id IN ($1, $2) ORDER BY export_sequence`,
      [first, second],
    );
    expect(rows).toHaveLength(2);
    expect(BigInt(rows[1].export_sequence)).toBe(
      BigInt(rows[0].export_sequence) + 1n,
    );
  });

  it("rejects WORM receipt mutation and checkpoint rollback", async () => {
    const suffix = randomUUID();
    const base = await dataSource.query(
      "SELECT last_sequence, version FROM audit_export_checkpoints WHERE id = 'primary'",
    );
    const sequence = BigInt(base[0].last_sequence) + 1n;
    await dataSource.query(
      `INSERT INTO audit_export_receipts (
        object_key, first_sequence, last_sequence, record_count,
        receipt_object_key,
        previous_manifest_hash, manifest_hash,
        destination_version_id, destination_etag
      ) VALUES ($1,$2,$2,1,$3,$4,$5,$6,$7)`,
      [
        `audit/v1/probe-${suffix}.json`,
        sequence.toString(),
        `audit-receipts/v1/probe-${suffix}.json`,
        "0".repeat(64),
        suffix.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        `version-${suffix}`,
        `etag-${suffix}`,
      ],
    );
    await expect(
      dataSource.query(
        "UPDATE audit_export_receipts SET destination_etag = 'rewritten' WHERE object_key = $1",
        [`audit/v1/probe-${suffix}.json`],
      ),
    ).rejects.toThrow("audit export receipts are append-only");
    await expect(
      dataSource.query(
        `UPDATE audit_export_checkpoints
         SET version = version + 1, last_sequence = last_sequence - 1,
             updated_at = now()
         WHERE id = 'primary'`,
      ),
    ).rejects.toThrow("checkpoint rollback or invalid advance");
  });

  it("installs the single-pending immutable two-person recovery ledger", async () => {
    const triggers = await dataSource.query(`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_table = 'ton_unmatched_recovery_requests'
        AND trigger_name = 'ton_unmatched_recovery_immutable'
    `);
    const indexes = await dataSource.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE tablename = 'ton_unmatched_recovery_requests'
        AND indexname = 'uq_ton_unmatched_pending_recovery'
    `);
    expect(triggers).toHaveLength(1);
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain("WHERE");
    expect(indexes[0].indexdef).toContain("pending");
  });

  it("hardens native TON recovery with expiry, session separation and immutability", async () => {
    const columns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'ton_native_recovery_requests'
        AND column_name IN ('requesterJti','requesterSid','intentHash','expiresAt')
    `);
    const triggers = await dataSource.query(`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_table = 'ton_native_recovery_requests'
        AND trigger_name = 'ton_native_recovery_immutable'
    `);
    const indexes = await dataSource.query(`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'ton_native_recovery_requests'
        AND indexname = 'UQ_ton_native_pending_recovery'
    `);
    expect(columns).toHaveLength(4);
    expect(triggers).toHaveLength(1);
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain("pending");

    await dataSource.query(`CREATE TEMP TABLE phase6_native_recovery_probe
      (LIKE ton_native_recovery_requests INCLUDING ALL) ON COMMIT PRESERVE ROWS`);
    await dataSource.query(`CREATE TRIGGER phase6_native_recovery_probe_immutable
      BEFORE UPDATE ON phase6_native_recovery_probe FOR EACH ROW
      EXECUTE FUNCTION protect_ton_native_recovery_intent()`);
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO phase6_native_recovery_probe (
        id, "eventId", "requestedBy", "requesterJti", "requesterSid",
        status, reason, "expectedLastError", "intentHash", "expiresAt"
      ) VALUES ($1,$2,$3,'jti-a','sid-a','pending',$4,'HTTP_503',$5,now() + interval '5 minutes')`,
      [
        id,
        randomUUID(),
        randomUUID(),
        "Independent provider recovered; replay through normal reconciliation.",
        id.replace(/-/g, "").repeat(2),
      ],
    );
    await expect(
      dataSource.query(
        `UPDATE phase6_native_recovery_probe SET status = 'expired', "updatedAt" = now() WHERE id = $1`,
        [id],
      ),
    ).resolves.toBeDefined();
    await expect(
      dataSource.query(
        `UPDATE phase6_native_recovery_probe SET reason = 'rewritten' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/native recovery (intent|request) is immutable/);
  });
});
