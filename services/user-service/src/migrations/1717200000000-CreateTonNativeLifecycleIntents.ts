import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTonNativeLifecycleIntents1717200000000
  implements MigrationInterface
{
  name = "CreateTonNativeLifecycleIntents1717200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_native_lifecycle_intents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "preparationId" uuid NOT NULL,
        "dealId" uuid NOT NULL,
        "action" varchar(40) NOT NULL,
        "expectedFromStatus" smallint NOT NULL,
        "expectedToStatus" smallint NOT NULL,
        "requesterUserId" uuid NOT NULL,
        "senderAddress" varchar(128) NOT NULL,
        "queryId" varchar(20) NOT NULL UNIQUE,
        "actionValueAtomic" varchar(78) NOT NULL,
        "payload" text NOT NULL,
        "payloadHash" varchar(64) NOT NULL,
        "reason" text NULL,
        "consumedByEventId" uuid NULL,
        "consumedAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_native_intent_preparation"
          FOREIGN KEY ("preparationId") REFERENCES "ton_native_escrow_preparations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ton_native_intent_deal"
          FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ton_native_intent_requester"
          FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_ton_native_lifecycle_intent_state_action"
          UNIQUE ("preparationId", "action", "expectedFromStatus", "requesterUserId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_native_intent_deal_created"
        ON "ton_native_lifecycle_intents" ("dealId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_native_lifecycle_intents"`,
    );
  }
}
