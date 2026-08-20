import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTonNativeReconciliationEvidence1717500000000 implements MigrationInterface {
  name = "AddTonNativeReconciliationEvidence1717500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      ALTER TABLE "ton_native_chain_events"
        ADD COLUMN IF NOT EXISTS "postStateHash" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "postDataHash" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "reconciledAt" timestamp NULL,
        ADD COLUMN IF NOT EXISTS "reconciliationSource" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "reconciliationEvidence" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "reconciliationError" text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      ALTER TABLE "ton_native_chain_events"
        DROP COLUMN IF EXISTS "reconciliationError",
        DROP COLUMN IF EXISTS "reconciliationEvidence",
        DROP COLUMN IF EXISTS "reconciliationSource",
        DROP COLUMN IF EXISTS "reconciledAt",
        DROP COLUMN IF EXISTS "postDataHash",
        DROP COLUMN IF EXISTS "postStateHash"
    `);
  }
}
