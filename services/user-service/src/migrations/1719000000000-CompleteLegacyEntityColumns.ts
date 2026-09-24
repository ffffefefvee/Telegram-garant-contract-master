import { MigrationInterface, QueryRunner } from 'typeorm';

/** Nullable entity fields missing from the historical PostgreSQL migrations. */
export class CompleteLegacyEntityColumns1719000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "enforced_at" timestamp');
    await queryRunner.query('ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "tx_id" varchar(255)');
    await queryRunner.query('ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "escrow_address" varchar(255)');
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Retain potentially populated columns during rollback.
  }
}
