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
        scanner_name, scanner_version, scan_evidence_hash, manifest_hash,
        scanned_at, retention_until
      ) VALUES ($1,$2,$3,'image/png',12,$4,'scanner-a','1.0',$5,$6,now(),now() + interval '365 days')`,
      [
        id,
        randomUUID(),
        `clean/${id}`,
        "a".repeat(64),
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
});
