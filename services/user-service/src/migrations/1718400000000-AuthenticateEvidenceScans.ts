import { MigrationInterface, QueryRunner } from "typeorm";

export class AuthenticateEvidenceScans1718400000000
  implements MigrationInterface
{
  name = "AuthenticateEvidenceScans1718400000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE evidence_file_manifests
      ADD COLUMN scanner_policy_version varchar(128),
      ADD COLUMN scanner_result_id varchar(128)
    `);
    await queryRunner.query(`
      UPDATE evidence_file_manifests
      SET scanner_policy_version = 'legacy-unverified',
          scanner_result_id = 'legacy-' || id::text
      WHERE scanner_policy_version IS NULL OR scanner_result_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE evidence_file_manifests
      ALTER COLUMN scanner_policy_version SET NOT NULL,
      ALTER COLUMN scanner_result_id SET NOT NULL,
      ADD CONSTRAINT UQ_evidence_scanner_result UNIQUE (scanner_result_id)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_evidence_manifest_rewrite()
      RETURNS trigger AS $$
      BEGIN
        IF ROW(
          NEW.evidence_id, NEW.storage_key, NEW.media_type, NEW.size,
          NEW.sha256, NEW.scanner_name, NEW.scanner_version,
          NEW.scanner_policy_version, NEW.scanner_result_id,
          NEW.scan_evidence_hash, NEW.manifest_hash, NEW.scanned_at,
          NEW.retention_until, NEW.created_at
        ) IS DISTINCT FROM ROW(
          OLD.evidence_id, OLD.storage_key, OLD.media_type, OLD.size,
          OLD.sha256, OLD.scanner_name, OLD.scanner_version,
          OLD.scanner_policy_version, OLD.scanner_result_id,
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
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE evidence_file_manifests DROP CONSTRAINT IF EXISTS UQ_evidence_scanner_result",
    );
    await queryRunner.query(`
      ALTER TABLE evidence_file_manifests
      DROP COLUMN IF EXISTS scanner_result_id,
      DROP COLUMN IF EXISTS scanner_policy_version
    `);
  }
}
