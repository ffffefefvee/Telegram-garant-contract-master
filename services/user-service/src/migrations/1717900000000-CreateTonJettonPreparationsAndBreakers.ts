import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 3 immutable preparation records and fail-closed settlement circuits.
 * The TON adapter remains disabled; this migration only installs durable state.
 */
export class CreateTonJettonPreparationsAndBreakers1717900000000 implements MigrationInterface {
  name = "CreateTonJettonPreparationsAndBreakers1717900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_immutable_settlement_row()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'immutable settlement evidence cannot be changed'
          USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_escrow_preparations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "dealId" uuid NOT NULL,
        "version" integer NOT NULL CHECK ("version" > 0),
        "previousPreparationId" uuid NULL,
        "contentHash" varchar(64) NOT NULL,
        "network" varchar(16) NOT NULL CHECK ("network" IN ('-3', '-239')),
        "workchain" smallint NOT NULL CHECK ("workchain" IN (-1, 0)),
        "codeHash" varchar(64) NOT NULL,
        "configHash" varchar(64) NOT NULL,
        "escrowAddress" varchar(128) NOT NULL,
        "stateInit" text NOT NULL,
        "masterAddress" varchar(128) NOT NULL,
        "walletCodeHash" varchar(64) NOT NULL,
        "sealedWalletAddress" varchar(128) NOT NULL,
        "walletVerificationEvidenceHash" varchar(64) NOT NULL,
        "termsVersion" integer NOT NULL CHECK ("termsVersion" > 0),
        "termsHash" varchar(64) NOT NULL,
        "quoteVersion" integer NOT NULL CHECK ("quoteVersion" > 0),
        "quoteId" uuid NOT NULL,
        "quoteHash" varchar(64) NOT NULL,
        "buyerAddress" varchar(128) NOT NULL,
        "sellerAddress" varchar(128) NOT NULL,
        "arbitratorAddress" varchar(128) NOT NULL,
        "treasuryAddress" varchar(128) NOT NULL,
        "initializerAddress" varchar(128) NOT NULL,
        "reconciliationAddress" varchar(128) NOT NULL,
        "assetCode" varchar(32) NOT NULL CHECK ("assetCode" = 'USDT-TON'),
        "assetDecimals" smallint NOT NULL CHECK ("assetDecimals" = 6),
        "buyerTotalAtomic" varchar(78) NOT NULL,
        "sellerPayoutAtomic" varchar(78) NOT NULL,
        "platformFeeAtomic" varchar(78) NOT NULL,
        "refundToBuyerAtomic" varchar(78) NOT NULL,
        "refundFeeAtomic" varchar(78) NOT NULL,
        "fundingQueryId" varchar(20) NOT NULL,
        "fundingForwardPayloadHash" varchar(64) NOT NULL,
        "fundingDeadline" varchar(20) NOT NULL,
        "deliveryDeadline" varchar(20) NOT NULL,
        "confirmationDeadline" varchar(20) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_preparation_deal"
          FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ton_jetton_preparation_previous"
          FOREIGN KEY ("previousPreparationId")
          REFERENCES "ton_jetton_escrow_preparations"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_ton_jetton_preparation_deal_version"
          UNIQUE ("dealId", "version"),
        CONSTRAINT "UQ_ton_jetton_preparation_content_hash"
          UNIQUE ("contentHash"),
        CONSTRAINT "CHK_ton_jetton_preparation_release_conservation"
          CHECK (
            "buyerTotalAtomic"::numeric =
              "sellerPayoutAtomic"::numeric + "platformFeeAtomic"::numeric
          ),
        CONSTRAINT "CHK_ton_jetton_preparation_refund_conservation"
          CHECK (
            "buyerTotalAtomic"::numeric =
              "refundToBuyerAtomic"::numeric + "refundFeeAtomic"::numeric
          ),
        CONSTRAINT "CHK_ton_jetton_preparation_deadlines"
          CHECK (
            "fundingDeadline"::numeric < "deliveryDeadline"::numeric
            AND "deliveryDeadline"::numeric < "confirmationDeadline"::numeric
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_preparation_deal_version"
        ON "ton_jetton_escrow_preparations" ("dealId", "version")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_preparation_network_escrow"
        ON "ton_jetton_escrow_preparations" ("network", "escrowAddress")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_ton_jetton_preparation_immutable"
        ON "ton_jetton_escrow_preparations";
      CREATE TRIGGER "TRG_ton_jetton_preparation_immutable"
        BEFORE UPDATE OR DELETE ON "ton_jetton_escrow_preparations"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_escrow_watches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "preparationId" uuid NOT NULL UNIQUE,
        "dealId" uuid NOT NULL,
        "network" varchar(16) NOT NULL,
        "accountAddress" varchar(128) NOT NULL,
        "status" varchar(32) NOT NULL,
        "consecutiveFailures" integer NOT NULL DEFAULT 0
          CHECK ("consecutiveFailures" >= 0),
        "lastError" text NULL,
        "lastAppliedAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_watch_preparation"
          FOREIGN KEY ("preparationId")
          REFERENCES "ton_jetton_escrow_preparations"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ton_jetton_watch_deal"
          FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_ton_jetton_watch_status" CHECK (
          "status" IN (
            'awaiting_funding', 'funded', 'delivered', 'disputed',
            'settlement_pending', 'recovery_required', 'settled_finalized',
            'manual_review', 'superseded'
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ton_jetton_watch_network_account"
        ON "ton_jetton_escrow_watches" ("network", "accountAddress")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ton_jetton_watch_one_active_deal"
        ON "ton_jetton_escrow_watches" ("dealId")
        WHERE "status" <> 'superseded'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_watch_status_updated"
        ON "ton_jetton_escrow_watches" ("status", "updatedAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_action_intents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "preparationId" uuid NOT NULL,
        "dealId" uuid NOT NULL,
        "action" varchar(40) NOT NULL,
        "expectedFromStatus" varchar(32) NOT NULL,
        "expectedToStatus" varchar(32) NOT NULL,
        "requesterId" varchar(128) NOT NULL,
        "senderAddress" varchar(128) NOT NULL,
        "queryId" varchar(20) NOT NULL,
        "payload" text NOT NULL,
        "payloadHash" varchar(64) NOT NULL,
        "settlementId" varchar(128) NULL,
        "buyerAwardAtomic" varchar(78) NULL,
        "sellerAwardAtomic" varchar(78) NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_intent_preparation"
          FOREIGN KEY ("preparationId")
          REFERENCES "ton_jetton_escrow_preparations"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ton_jetton_intent_deal"
          FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_ton_jetton_intent_preparation_query"
          UNIQUE ("preparationId", "queryId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_intent_deal_created"
        ON "ton_jetton_action_intents" ("dealId", "createdAt")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_ton_jetton_action_intent_immutable"
        ON "ton_jetton_action_intents";
      CREATE TRIGGER "TRG_ton_jetton_action_intent_immutable"
        BEFORE UPDATE OR DELETE ON "ton_jetton_action_intents"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "ton_jetton_chain_events" LIMIT 1) THEN
          RAISE EXCEPTION
            'cannot bind legacy Jetton events: isolated table is not empty'
            USING ERRCODE = '55000';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "ton_jetton_chain_events"
        ADD COLUMN IF NOT EXISTS "preparationId" uuid,
        ADD COLUMN IF NOT EXISTS "actionIntentId" uuid NULL,
        ADD COLUMN IF NOT EXISTS "eventKind" varchar(40),
        ADD COLUMN IF NOT EXISTS "evidenceHash" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "ton_jetton_chain_events"
        ALTER COLUMN "preparationId" SET NOT NULL,
        ALTER COLUMN "eventKind" SET NOT NULL,
        ALTER COLUMN "evidenceHash" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "ton_jetton_chain_events"
        ADD CONSTRAINT "FK_ton_jetton_event_preparation"
          FOREIGN KEY ("preparationId")
          REFERENCES "ton_jetton_escrow_preparations"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_ton_jetton_event_intent"
          FOREIGN KEY ("actionIntentId")
          REFERENCES "ton_jetton_action_intents"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_event_preparation_created"
        ON "ton_jetton_chain_events" ("preparationId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_action_intent_consumptions" (
        "intentId" uuid PRIMARY KEY,
        "eventId" uuid NOT NULL UNIQUE,
        "consumedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_consumption_intent"
          FOREIGN KEY ("intentId") REFERENCES "ton_jetton_action_intents"("id")
            ON DELETE RESTRICT,
        CONSTRAINT "FK_ton_jetton_consumption_event"
          FOREIGN KEY ("eventId") REFERENCES "ton_jetton_chain_events"("id")
            ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_ton_jetton_consumption_immutable"
        ON "ton_jetton_action_intent_consumptions";
      CREATE TRIGGER "TRG_ton_jetton_consumption_immutable"
        BEFORE UPDATE OR DELETE ON "ton_jetton_action_intent_consumptions"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_ingestion_cursor_checkpoints" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "cursorId" uuid NOT NULL,
        "kind" varchar(16) NOT NULL CHECK ("kind" IN ('advance', 'recovery')),
        "previousLt" varchar(20) NULL,
        "previousHash" varchar(64) NULL,
        "previousMcSeqno" integer NULL,
        "nextLt" varchar(20) NULL,
        "nextHash" varchar(64) NULL,
        "nextMcSeqno" integer NULL,
        "reasonCode" varchar(64) NOT NULL,
        "actorId" varchar(128) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_cursor_checkpoint"
          FOREIGN KEY ("cursorId") REFERENCES "ton_jetton_ingestion_cursors"("id")
            ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_cursor_checkpoint_created"
        ON "ton_jetton_ingestion_cursor_checkpoints" ("cursorId", "createdAt")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_ton_jetton_cursor_checkpoint_immutable"
        ON "ton_jetton_ingestion_cursor_checkpoints";
      CREATE TRIGGER "TRG_ton_jetton_cursor_checkpoint_immutable"
        BEFORE UPDATE OR DELETE ON "ton_jetton_ingestion_cursor_checkpoints"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_application_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "eventId" uuid NOT NULL,
        "action" varchar(16) NOT NULL CHECK ("action" = 'requeue'),
        "previousAttempts" integer NOT NULL CHECK ("previousAttempts" > 0),
        "previousError" text NULL,
        "reasonCode" varchar(64) NOT NULL,
        "actorId" varchar(128) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_application_review_event"
          FOREIGN KEY ("eventId") REFERENCES "ton_jetton_chain_events"("id")
            ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_application_review_created"
        ON "ton_jetton_application_reviews" ("eventId", "createdAt")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_ton_jetton_application_review_immutable"
        ON "ton_jetton_application_reviews";
      CREATE TRIGGER "TRG_ton_jetton_application_review_immutable"
        BEFORE UPDATE OR DELETE ON "ton_jetton_application_reviews"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_jetton_ledger_reconciliations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "preparationId" uuid NOT NULL,
        "onChainAssetsAtomic" varchar(78) NOT NULL,
        "ledgerLiabilitiesAtomic" varchar(78) NOT NULL,
        "deltaAtomic" varchar(79) NOT NULL,
        "evidenceHash" varchar(64) NOT NULL,
        "breakerTripped" boolean NOT NULL,
        "actorId" varchar(128) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ton_jetton_ledger_reconciliation_preparation"
          FOREIGN KEY ("preparationId")
          REFERENCES "ton_jetton_escrow_preparations"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_jetton_ledger_reconciliation_created"
        ON "ton_jetton_ledger_reconciliations" ("preparationId", "createdAt")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_ton_jetton_ledger_reconciliation_immutable"
        ON "ton_jetton_ledger_reconciliations";
      CREATE TRIGGER "TRG_ton_jetton_ledger_reconciliation_immutable"
        BEFORE UPDATE OR DELETE ON "ton_jetton_ledger_reconciliations"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_ton_jetton_chain_event_immutable"
        ON "ton_jetton_chain_events";
      CREATE TRIGGER "TRG_ton_jetton_chain_event_immutable"
        BEFORE UPDATE OR DELETE ON "ton_jetton_chain_events"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settlement_circuit_breakers" (
        "scope" varchar(16) PRIMARY KEY,
        "state" varchar(16) NOT NULL,
        "incidentKind" varchar(40) NULL,
        "reasonCode" varchar(64) NULL,
        "assetCode" varchar(32) NULL,
        "discrepancyAtomic" varchar(78) NULL,
        "evidenceHash" varchar(64) NULL,
        "trippedAt" timestamp NULL,
        "revision" integer NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_settlement_circuit_scope"
          CHECK ("scope" IN ('ton', 'polygon', 'global')),
        CONSTRAINT "CHK_settlement_circuit_state"
          CHECK ("state" IN ('closed', 'tripped')),
        CONSTRAINT "CHK_settlement_circuit_trip_fields"
          CHECK (
            ("state" = 'closed' AND "incidentKind" IS NULL
              AND "reasonCode" IS NULL AND "trippedAt" IS NULL)
            OR
            ("state" = 'tripped' AND "incidentKind" IS NOT NULL
              AND "reasonCode" IS NOT NULL AND "evidenceHash" IS NOT NULL
              AND "trippedAt" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      INSERT INTO "settlement_circuit_breakers" ("scope", "state")
      VALUES ('ton', 'closed'), ('polygon', 'closed'), ('global', 'closed')
      ON CONFLICT ("scope") DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settlement_circuit_breaker_audit" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "scope" varchar(16) NOT NULL,
        "previousState" varchar(16) NOT NULL,
        "nextState" varchar(16) NOT NULL,
        "incidentKind" varchar(40) NOT NULL,
        "reasonCode" varchar(64) NOT NULL,
        "assetCode" varchar(32) NULL,
        "discrepancyAtomic" varchar(78) NULL,
        "evidenceHash" varchar(64) NOT NULL,
        "actorId" varchar(128) NOT NULL,
        "revision" integer NOT NULL CHECK ("revision" > 0),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_settlement_circuit_audit_scope"
          FOREIGN KEY ("scope") REFERENCES "settlement_circuit_breakers"("scope")
            ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_settlement_circuit_audit_scope_created"
        ON "settlement_circuit_breaker_audit" ("scope", "createdAt")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_settlement_circuit_audit_immutable"
        ON "settlement_circuit_breaker_audit";
      CREATE TRIGGER "TRG_settlement_circuit_audit_immutable"
        BEFORE UPDATE OR DELETE ON "settlement_circuit_breaker_audit"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_settlement_circuit_audit_immutable" ON "settlement_circuit_breaker_audit"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "settlement_circuit_breaker_audit"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "settlement_circuit_breakers"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_ton_jetton_ledger_reconciliation_immutable" ON "ton_jetton_ledger_reconciliations"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_jetton_ledger_reconciliations"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_ton_jetton_application_review_immutable" ON "ton_jetton_application_reviews"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_jetton_application_reviews"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_ton_jetton_cursor_checkpoint_immutable" ON "ton_jetton_ingestion_cursor_checkpoints"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_jetton_ingestion_cursor_checkpoints"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_ton_jetton_consumption_immutable" ON "ton_jetton_action_intent_consumptions"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_jetton_action_intent_consumptions"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_ton_jetton_chain_event_immutable" ON "ton_jetton_chain_events"`,
    );
    await queryRunner.query(`
      ALTER TABLE "ton_jetton_chain_events"
        DROP CONSTRAINT IF EXISTS "FK_ton_jetton_event_intent",
        DROP CONSTRAINT IF EXISTS "FK_ton_jetton_event_preparation",
        DROP COLUMN IF EXISTS "evidenceHash",
        DROP COLUMN IF EXISTS "eventKind",
        DROP COLUMN IF EXISTS "actionIntentId",
        DROP COLUMN IF EXISTS "preparationId"
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_ton_jetton_action_intent_immutable" ON "ton_jetton_action_intents"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_jetton_action_intents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_jetton_escrow_watches"`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_ton_jetton_preparation_immutable" ON "ton_jetton_escrow_preparations"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_jetton_escrow_preparations"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS reject_immutable_settlement_row()`,
    );
  }
}
