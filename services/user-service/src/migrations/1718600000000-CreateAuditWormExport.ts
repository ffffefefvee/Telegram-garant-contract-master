import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditWormExport1718600000000 implements MigrationInterface {
  name = "CreateAuditWormExport1718600000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE SEQUENCE audit_log_export_sequence_seq");
    await queryRunner.query(`
      ALTER TABLE audit_log
      ADD COLUMN export_sequence bigint NOT NULL
      DEFAULT nextval('audit_log_export_sequence_seq')
    `);
    await queryRunner.query(`
      ALTER SEQUENCE audit_log_export_sequence_seq OWNED BY audit_log.export_sequence
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_audit_log_export_sequence ON audit_log (export_sequence)
    `);
    await queryRunner.query(`
      CREATE TABLE audit_export_checkpoints (
        id varchar(32) PRIMARY KEY,
        last_sequence bigint NOT NULL CHECK (last_sequence >= 0),
        last_manifest_hash char(64) NOT NULL CHECK (last_manifest_hash ~ '^[0-9a-f]{64}$'),
        version bigint NOT NULL CHECK (version >= 0),
        updated_at timestamp NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO audit_export_checkpoints
      (id, last_sequence, last_manifest_hash, version, updated_at)
      VALUES ('primary', 0, repeat('0', 64), 0, now())
    `);
    await queryRunner.query(`
      CREATE TABLE audit_export_receipts (
        id bigserial PRIMARY KEY,
        object_key varchar(256) NOT NULL UNIQUE,
        receipt_object_key varchar(256) NOT NULL UNIQUE,
        first_sequence bigint NOT NULL,
        last_sequence bigint NOT NULL UNIQUE,
        record_count integer NOT NULL CHECK (record_count > 0),
        previous_manifest_hash char(64) NOT NULL CHECK (previous_manifest_hash ~ '^[0-9a-f]{64}$'),
        manifest_hash char(64) NOT NULL UNIQUE CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
        destination_version_id varchar(256) NOT NULL,
        destination_etag varchar(256) NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CHECK (last_sequence >= first_sequence),
        CHECK (last_sequence - first_sequence + 1 = record_count)
      )
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION protect_audit_export_state()
      RETURNS trigger AS $$
      BEGIN
        IF TG_TABLE_NAME = 'audit_export_receipts' THEN
          RAISE EXCEPTION 'audit export receipts are append-only';
        END IF;
        IF TG_OP = 'DELETE' OR NEW.version <> OLD.version + 1
          OR NEW.last_sequence < OLD.last_sequence
          OR NEW.updated_at < OLD.updated_at THEN
          RAISE EXCEPTION 'audit export checkpoint rollback or invalid advance';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_export_receipts_append_only
      BEFORE UPDATE OR DELETE ON audit_export_receipts
      FOR EACH ROW EXECUTE FUNCTION protect_audit_export_state()
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_export_checkpoint_monotonic
      BEFORE UPDATE OR DELETE ON audit_export_checkpoints
      FOR EACH ROW EXECUTE FUNCTION protect_audit_export_state()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS audit_export_receipts");
    await queryRunner.query("DROP TABLE IF EXISTS audit_export_checkpoints");
    await queryRunner.query("DROP FUNCTION IF EXISTS protect_audit_export_state()");
    await queryRunner.query("DROP INDEX IF EXISTS UQ_audit_log_export_sequence");
    await queryRunner.query("ALTER TABLE audit_log DROP COLUMN IF EXISTS export_sequence");
    await queryRunner.query("DROP SEQUENCE IF EXISTS audit_log_export_sequence_seq");
  }
}
