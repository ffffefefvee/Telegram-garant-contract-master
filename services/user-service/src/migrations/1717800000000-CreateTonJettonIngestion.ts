import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Storage only. Nothing registers a scheduler or enables the TON adapter in
 * this migration; Jetton ingestion remains an explicitly unwired capability.
 */
export class CreateTonJettonIngestion1717800000000 implements MigrationInterface {
  name = "CreateTonJettonIngestion1717800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_ingestion_cursors" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "network" varchar(16) NOT NULL,
        "accountAddress" varchar(128) NOT NULL,
        "lastFinalizedLt" varchar(20) NULL,
        "lastFinalizedTxHash" varchar(64) NULL,
        "lastFinalizedMcSeqno" integer NULL,
        "lastScannedAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_ton_jetton_cursor_account"
          UNIQUE ("network", "accountAddress")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_chain_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "network" varchar(16) NOT NULL,
        "accountAddress" varchar(128) NOT NULL,
        "transactionLt" varchar(20) NOT NULL,
        "transactionHash" varchar(64) NOT NULL,
        "masterchainSeqno" integer NOT NULL,
        "transactionTime" integer NOT NULL,
        "messageHash" varchar(64) NULL,
        "outcome" varchar(16) NOT NULL,
        "reasonCode" varchar(64) NOT NULL,
        "correlationKey" varchar(128) NULL,
        "evidence" jsonb NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_ton_jetton_chain_event_identity"
          UNIQUE ("network", "accountAddress", "transactionLt", "transactionHash")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_event_outcome_created"
        ON "ton_jetton_chain_events" ("outcome", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_event_applications" (
        "eventId" uuid PRIMARY KEY,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text NULL,
        "appliedAt" timestamp NULL,
        "manualReviewAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_application_event"
          FOREIGN KEY ("eventId") REFERENCES "ton_jetton_chain_events"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_ton_jetton_application_attempts"
          CHECK ("attempts" >= 0),
        CONSTRAINT "CHK_ton_jetton_application_terminal_state"
          CHECK (
            ("status" = 'pending' AND "appliedAt" IS NULL AND "manualReviewAt" IS NULL)
            OR ("status" = 'applied' AND "appliedAt" IS NOT NULL AND "manualReviewAt" IS NULL)
            OR ("status" = 'manual_review' AND "appliedAt" IS NULL AND "manualReviewAt" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_application_status_updated"
        ON "ton_jetton_event_applications" ("status", "updatedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_jetton_event_applications"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_jetton_chain_events"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_jetton_ingestion_cursors"`,
    );
  }
}
