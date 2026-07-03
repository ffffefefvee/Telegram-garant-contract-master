import { MigrationInterface, QueryRunner } from 'typeorm';
import { createPgEnum, dropPgEnum } from '../database/migration-enum.helper';

/**
 * Anti-scam feature tables.
 *
 * `scammer_records` — one row per accused Telegram account (keyed by
 * targetTelegramId). `scam_reports` — individual complaints.
 *
 * Anti-spam / dedup constraints (hybrid confirmation model):
 *  - UQ(scammer_record_id, reporter_user_id): one complaint per reporter/target.
 *  - UQ(contentHash): identical complaint text cannot be re-submitted anywhere.
 *
 * Column names are camelCase to match the entity definitions (this project has
 * no global snake_case naming strategy).
 */
export class CreateAntiScamTables1716500000000 implements MigrationInterface {
  name = 'CreateAntiScamTables1716500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPgEnum(queryRunner, 'scammer_records_status_enum', [
      'reported',
      'confirmed',
      'published',
      'rejected',
    ]);
    await createPgEnum(queryRunner, 'scam_reports_status_enum', [
      'pending',
      'approved',
      'rejected',
    ]);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scammer_records" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "targetTelegramId" bigint NOT NULL,
        "targetUsername" varchar(255) NULL,
        "targetDisplayName" varchar(255) NULL,
        "status" "scammer_records_status_enum" NOT NULL DEFAULT 'reported',
        "distinctReporterCount" integer NOT NULL DEFAULT 0,
        "confirmationSource" varchar(32) NULL,
        "confirmedAt" timestamp NULL,
        "moderatedById" uuid NULL,
        "publishedAt" timestamp NULL,
        "dbChannelMessageId" bigint NULL,
        "evidenceChannelMessageId" bigint NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "scammer_records" ADD CONSTRAINT "UQ_scammer_records_targetTelegramId" UNIQUE ("targetTelegramId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scammer_records_targetTelegramId" ON "scammer_records" ("targetTelegramId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scammer_records_targetUsername" ON "scammer_records" ("targetUsername")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scammer_records_status" ON "scammer_records" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scam_reports" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "scammer_record_id" uuid NOT NULL,
        "reporter_user_id" uuid NOT NULL,
        "reporterTelegramId" bigint NULL,
        "reason" text NOT NULL,
        "contentHash" varchar(64) NOT NULL,
        "screenshotFileIds" text NOT NULL DEFAULT '[]',
        "status" "scam_reports_status_enum" NOT NULL DEFAULT 'pending',
        "moderatedById" uuid NULL,
        "moderatedAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "scam_reports" ADD CONSTRAINT "UQ_scam_report_reporter" UNIQUE ("scammer_record_id","reporter_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "scam_reports" ADD CONSTRAINT "UQ_scam_report_content_hash" UNIQUE ("contentHash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "scam_reports" ADD CONSTRAINT "FK_scam_report_scammer_record" FOREIGN KEY ("scammer_record_id") REFERENCES "scammer_records"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scam_reports_scammer_record_id" ON "scam_reports" ("scammer_record_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scam_reports_reporter_user_id" ON "scam_reports" ("reporter_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_scam_reports_status" ON "scam_reports" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scam_reports_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scam_reports_reporter_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scam_reports_scammer_record_id"`);
    await queryRunner.query(
      `ALTER TABLE "scam_reports" DROP CONSTRAINT IF EXISTS "FK_scam_report_scammer_record"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scam_reports" DROP CONSTRAINT IF EXISTS "UQ_scam_report_content_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scam_reports" DROP CONSTRAINT IF EXISTS "UQ_scam_report_reporter"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "scam_reports"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scammer_records_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scammer_records_targetUsername"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scammer_records_targetTelegramId"`);
    await queryRunner.query(
      `ALTER TABLE "scammer_records" DROP CONSTRAINT IF EXISTS "UQ_scammer_records_targetTelegramId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "scammer_records"`);

    await dropPgEnum(queryRunner, 'scam_reports_status_enum');
    await dropPgEnum(queryRunner, 'scammer_records_status_enum');
  }
}
