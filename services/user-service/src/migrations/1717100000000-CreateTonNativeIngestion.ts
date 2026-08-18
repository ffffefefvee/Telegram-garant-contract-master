import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTonNativeIngestion1717100000000
  implements MigrationInterface
{
  name = "CreateTonNativeIngestion1717100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `ALTER TABLE "money_ledger_entries" ALTER COLUMN "amount" TYPE numeric(36,18)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_native_escrow_watches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "preparationId" uuid NOT NULL UNIQUE,
        "dealId" uuid NOT NULL UNIQUE,
        "network" varchar(16) NOT NULL,
        "accountAddress" varchar(128) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'watching',
        "lastFinalizedLt" varchar(20) NULL,
        "lastFinalizedTxHash" varchar(128) NULL,
        "lastFinalizedMcSeqno" integer NULL,
        "lastScannedAt" timestamp NULL,
        "consecutiveFailures" integer NOT NULL DEFAULT 0,
        "lastError" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_native_watch_preparation"
          FOREIGN KEY ("preparationId") REFERENCES "ton_native_escrow_preparations"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_ton_native_watch_network_account" UNIQUE ("network", "accountAddress")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_native_watch_status_scan"
        ON "ton_native_escrow_watches" ("status", "lastScannedAt")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_native_chain_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "preparationId" uuid NOT NULL,
        "dealId" uuid NOT NULL,
        "network" varchar(16) NOT NULL,
        "accountAddress" varchar(128) NOT NULL,
        "transactionLt" varchar(20) NOT NULL,
        "transactionHash" varchar(128) NOT NULL,
        "masterchainSeqno" integer NOT NULL,
        "transactionTime" integer NOT NULL,
        "messageHash" varchar(128) NULL,
        "sourceAddress" varchar(128) NULL,
        "valueAtomic" varchar(78) NULL,
        "payloadHash" varchar(64) NULL,
        "postCodeHash" varchar(64) NULL,
        "postConfigHash" varchar(64) NULL,
        "outcome" varchar(16) NOT NULL,
        "reasonCode" varchar(64) NOT NULL,
        "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "applyAttempts" integer NOT NULL DEFAULT 0,
        "appliedAt" timestamp NULL,
        "automationStoppedAt" timestamp NULL,
        "lastApplyError" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_native_event_preparation"
          FOREIGN KEY ("preparationId") REFERENCES "ton_native_escrow_preparations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ton_native_event_deal"
          FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_ton_native_chain_event_identity"
          UNIQUE ("network", "accountAddress", "transactionLt", "transactionHash")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_native_event_outcome_applied"
        ON "ton_native_chain_events" ("outcome", "appliedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_native_event_deal_created"
        ON "ton_native_chain_events" ("dealId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_native_chain_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_native_escrow_watches"`);
    await queryRunner.query(
      `ALTER TABLE "money_ledger_entries" ALTER COLUMN "amount" TYPE numeric(24,8)`,
    );
  }
}
