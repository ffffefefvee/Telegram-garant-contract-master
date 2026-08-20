import { MigrationInterface, QueryRunner } from "typeorm";

export class ExtendTonNativeChainEvents1717300000000
  implements MigrationInterface
{
  name = "ExtendTonNativeChainEvents1717300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      ALTER TABLE "ton_native_chain_events"
        ADD COLUMN IF NOT EXISTS "eventType" varchar(40) NOT NULL DEFAULT 'fund',
        ADD COLUMN IF NOT EXISTS "intentId" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ton_native_chain_events"
        ADD CONSTRAINT "FK_ton_native_event_intent"
        FOREIGN KEY ("intentId") REFERENCES "ton_native_lifecycle_intents"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `ALTER TABLE "ton_native_chain_events" DROP CONSTRAINT IF EXISTS "FK_ton_native_event_intent"`,
    );
    await queryRunner.query(`
      ALTER TABLE "ton_native_chain_events"
        DROP COLUMN IF EXISTS "intentId",
        DROP COLUMN IF EXISTS "eventType"
    `);
  }
}
