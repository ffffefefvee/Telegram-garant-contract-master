import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateEvidenceFileManifests1718200000000
  implements MigrationInterface
{
  name = "CreateEvidenceFileManifests1718200000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS evidence_file_manifests (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        evidence_id uuid NOT NULL UNIQUE REFERENCES evidence(id) ON DELETE RESTRICT,
        storage_key varchar(512) NOT NULL UNIQUE,
        media_type varchar(100) NOT NULL,
        size bigint NOT NULL CHECK (size > 0),
        sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        scanner_name varchar(100) NOT NULL,
        scanner_version varchar(128) NOT NULL,
        scan_evidence_hash char(64) NOT NULL CHECK (scan_evidence_hash ~ '^[0-9a-f]{64}$'),
        manifest_hash char(64) NOT NULL UNIQUE CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
        scanned_at timestamp NOT NULL,
        retention_until timestamp NOT NULL,
        deleted_at timestamp NULL,
        deletion_reason text NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (retention_until > scanned_at),
        CHECK ((deleted_at IS NULL) = (deletion_reason IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_evidence_file_manifests_sha256
      ON evidence_file_manifests (sha256)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_evidence_file_manifests_retention
      ON evidence_file_manifests (retention_until)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_evidence_manifest_rewrite()
      RETURNS trigger AS $$
      BEGIN
        IF ROW(
          NEW.evidence_id, NEW.storage_key, NEW.media_type, NEW.size,
          NEW.sha256, NEW.scanner_name, NEW.scanner_version,
          NEW.scan_evidence_hash, NEW.manifest_hash, NEW.scanned_at,
          NEW.retention_until, NEW.created_at
        ) IS DISTINCT FROM ROW(
          OLD.evidence_id, OLD.storage_key, OLD.media_type, OLD.size,
          OLD.sha256, OLD.scanner_name, OLD.scanner_version,
          OLD.scan_evidence_hash, OLD.manifest_hash, OLD.scanned_at,
          OLD.retention_until, OLD.created_at
        ) THEN
          RAISE EXCEPTION 'evidence manifest fields are immutable';
        END IF;
        IF OLD.deleted_at IS NOT NULL AND ROW(NEW.deleted_at, NEW.deletion_reason)
          IS DISTINCT FROM ROW(OLD.deleted_at, OLD.deletion_reason) THEN
          RAISE EXCEPTION 'evidence deletion tombstone is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS evidence_manifest_immutable ON evidence_file_manifests
    `);
    await queryRunner.query(`
      CREATE TRIGGER evidence_manifest_immutable
      BEFORE UPDATE ON evidence_file_manifests
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_manifest_rewrite()
    `);

    // Existing deployments may carry permissive legacy settings. Narrow the
    // configured list to formats for which the application has byte-level
    // signature checks; the pipeline still takes the intersection with its
    // built-in allowlist.
    await queryRunner.query(`
      UPDATE arbitration_settings
      SET value = '["image/jpeg","image/png","video/mp4","application/pdf"]',
          updated_at = CURRENT_TIMESTAMP
      WHERE key = 'allowed_file_types'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS evidence_file_manifests");
    await queryRunner.query(
      "DROP FUNCTION IF EXISTS reject_evidence_manifest_rewrite()",
    );
  }
}
