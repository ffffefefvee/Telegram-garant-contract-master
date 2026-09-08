import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePolygonLifecycleHardening1718100000000 implements MigrationInterface {
  name = "CreatePolygonLifecycleHardening1718100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "polygon_lifecycle_cursors" (
        "chain_id" integer PRIMARY KEY,
        "next_block" bigint NOT NULL CHECK ("next_block" >= 0),
        "last_finalized_block" bigint,
        "last_finalized_hash" varchar(66),
        "revision" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CHECK (("last_finalized_block" IS NULL) = ("last_finalized_hash" IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "polygon_chain_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "chain_id" integer NOT NULL,
        "contract_address" varchar(42) NOT NULL,
        "escrow_address" varchar(42),
        "event_name" varchar(64) NOT NULL,
        "transaction_hash" varchar(66) NOT NULL,
        "log_index" integer NOT NULL CHECK ("log_index" >= 0),
        "block_number" bigint NOT NULL CHECK ("block_number" >= 0),
        "block_hash" varchar(66) NOT NULL,
        "topics" jsonb NOT NULL,
        "data" text NOT NULL,
        "decoded_payload" jsonb,
        "status" varchar(16) NOT NULL CHECK ("status" IN ('finalized','orphaned','applied','rejected')),
        "evidence_hash" varchar(64) NOT NULL CHECK ("evidence_hash" ~ '^[0-9a-f]{64}$'),
        "finalized_at" timestamp NOT NULL,
        "applied_at" timestamp,
        "orphaned_at" timestamp,
        "rejection_reason" varchar(128),
        "created_at" timestamp NOT NULL DEFAULT now(),
        UNIQUE ("chain_id", "transaction_hash", "log_index")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_polygon_events_scan" ON "polygon_chain_events" ("chain_id", "block_number", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_polygon_events_escrow" ON "polygon_chain_events" ("escrow_address", "block_number")`);
    await queryRunner.query(`
      CREATE TABLE "polygon_relay_nonce_state" (
        "chain_id" integer NOT NULL,
        "signer_address" varchar(42) NOT NULL,
        "next_nonce" bigint NOT NULL CHECK ("next_nonce" >= 0),
        "revision" integer NOT NULL DEFAULT 0,
        "updated_at" timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY ("chain_id", "signer_address")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "polygon_relay_transactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "operation_key" varchar(64) NOT NULL UNIQUE CHECK ("operation_key" ~ '^[0-9a-f]{64}$'),
        "operation_kind" varchar(64) NOT NULL,
        "chain_id" integer NOT NULL,
        "signer_address" varchar(42) NOT NULL,
        "nonce" bigint NOT NULL CHECK ("nonce" >= 0),
        "status" varchar(16) NOT NULL CHECK ("status" IN ('reserved','broadcast','replacing','replaced','confirmed','failed')),
        "current_tx_hash" varchar(66),
        "tx_to" varchar(42),
        "tx_data" text,
        "tx_value" varchar(78),
        "gas_limit" varchar(78),
        "gas_price" varchar(78),
        "max_fee_per_gas" varchar(78),
        "max_priority_fee_per_gas" varchar(78),
        "replaced_tx_hashes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
        "broadcast_at" timestamp,
        "confirmed_at" timestamp,
        "confirmed_block" bigint,
        "failure_code" varchar(128),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        UNIQUE ("chain_id", "signer_address", "nonce")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_polygon_relay_recovery" ON "polygon_relay_transactions" ("chain_id", "status", "updated_at")`);
    await queryRunner.query(`
      CREATE TABLE "polygon_reconciliations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "deal_id" uuid NOT NULL REFERENCES deals(id) ON DELETE RESTRICT,
        "chain_id" integer NOT NULL,
        "escrow_address" varchar(42) NOT NULL,
        "finalized_block" bigint NOT NULL,
        "finalized_block_hash" varchar(66) NOT NULL,
        "assets_atomic" varchar(78) NOT NULL CHECK ("assets_atomic" ~ '^(0|[1-9][0-9]*)$'),
        "liabilities_atomic" varchar(78) NOT NULL CHECK ("liabilities_atomic" ~ '^(0|[1-9][0-9]*)$'),
        "matches" boolean NOT NULL,
        "reason_code" varchar(128),
        "evidence_hash" varchar(64) NOT NULL CHECK ("evidence_hash" ~ '^[0-9a-f]{64}$'),
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_polygon_reconciliation_deal" ON "polygon_reconciliations" ("deal_id", "created_at")`);
    await queryRunner.query(`
      CREATE TRIGGER polygon_reconciliations_immutable
      BEFORE UPDATE OR DELETE ON polygon_reconciliations
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      CREATE TRIGGER polygon_chain_events_immutable
      BEFORE DELETE ON polygon_chain_events
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_polygon_event_update() RETURNS trigger AS $$
      BEGIN
        IF (NEW.chain_id, NEW.contract_address, NEW.escrow_address, NEW.event_name,
            NEW.transaction_hash, NEW.log_index, NEW.block_number, NEW.block_hash,
            NEW.topics, NEW.data, NEW.decoded_payload, NEW.evidence_hash, NEW.finalized_at,
            NEW.created_at)
           IS DISTINCT FROM
           (OLD.chain_id, OLD.contract_address, OLD.escrow_address, OLD.event_name,
            OLD.transaction_hash, OLD.log_index, OLD.block_number, OLD.block_hash,
            OLD.topics, OLD.data, OLD.decoded_payload, OLD.evidence_hash, OLD.finalized_at,
            OLD.created_at) THEN
          RAISE EXCEPTION 'polygon event evidence is immutable';
        END IF;
        IF OLD.status IN ('applied','rejected','orphaned') AND NEW.status IS DISTINCT FROM OLD.status THEN
          RAISE EXCEPTION 'terminal polygon event status is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER polygon_chain_events_update_guard
      BEFORE UPDATE ON polygon_chain_events
      FOR EACH ROW EXECUTE FUNCTION enforce_polygon_event_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS polygon_reconciliations_immutable ON polygon_reconciliations`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_polygon_reconciliation_deal"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "polygon_reconciliations"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS polygon_chain_events_update_guard ON polygon_chain_events`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS polygon_chain_events_immutable ON polygon_chain_events`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_polygon_event_update()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_polygon_relay_recovery"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "polygon_relay_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "polygon_relay_nonce_state"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_polygon_events_escrow"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_polygon_events_scan"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "polygon_chain_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "polygon_lifecycle_cursors"`);
  }
}
