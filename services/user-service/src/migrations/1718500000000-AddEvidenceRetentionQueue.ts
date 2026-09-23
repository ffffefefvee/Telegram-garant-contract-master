import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEvidenceRetentionQueue1718500000000
  implements MigrationInterface
{
  name = "AddEvidenceRetentionQueue1718500000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE evidence_file_manifests
      ADD COLUMN deletion_attempts integer NOT NULL DEFAULT 0 CHECK (deletion_attempts >= 0),
      ADD COLUMN deletion_next_attempt_at timestamp NULL,
      ADD COLUMN deletion_last_error text NULL,
      ADD COLUMN deletion_dead_letter_at timestamp NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IDX_evidence_retention_queue
      ON evidence_file_manifests (retention_until, deletion_next_attempt_at)
      WHERE deleted_at IS NULL AND deletion_dead_letter_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX IF EXISTS IDX_evidence_retention_queue");
    await queryRunner.query(`
      ALTER TABLE evidence_file_manifests
      DROP COLUMN IF EXISTS deletion_dead_letter_at,
      DROP COLUMN IF EXISTS deletion_last_error,
      DROP COLUMN IF EXISTS deletion_next_attempt_at,
      DROP COLUMN IF EXISTS deletion_attempts
    `);
  }
}
