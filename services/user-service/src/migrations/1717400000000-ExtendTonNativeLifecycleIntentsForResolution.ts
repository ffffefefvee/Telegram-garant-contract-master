import { MigrationInterface, QueryRunner } from "typeorm";

export class ExtendTonNativeLifecycleIntentsForResolution1717400000000 implements MigrationInterface {
  name = "ExtendTonNativeLifecycleIntentsForResolution1717400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      ALTER TABLE "ton_native_lifecycle_intents"
        ADD COLUMN IF NOT EXISTS "decisionId" uuid NULL,
        ADD COLUMN IF NOT EXISTS "decisionHash" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "buyerAwardAtomic" varchar(78) NULL,
        ADD COLUMN IF NOT EXISTS "sellerAwardAtomic" varchar(78) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ton_native_lifecycle_intents"
        ADD CONSTRAINT "FK_ton_native_intent_decision"
        FOREIGN KEY ("decisionId") REFERENCES "arbitration_decisions"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ton_native_intent_decision"
        ON "ton_native_lifecycle_intents" ("decisionId")
        WHERE "decisionId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_ton_native_intent_decision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ton_native_lifecycle_intents" DROP CONSTRAINT IF EXISTS "FK_ton_native_intent_decision"`,
    );
    await queryRunner.query(`
      ALTER TABLE "ton_native_lifecycle_intents"
        DROP COLUMN IF EXISTS "sellerAwardAtomic",
        DROP COLUMN IF EXISTS "buyerAwardAtomic",
        DROP COLUMN IF EXISTS "decisionHash",
        DROP COLUMN IF EXISTS "decisionId"
    `);
  }
}
