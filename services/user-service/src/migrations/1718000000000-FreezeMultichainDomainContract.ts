import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 4 authoritative, append-only terms/quote confirmation boundary.
 * It does not enable either chain or grant any signer/broadcast capability.
 */
export class FreezeMultichainDomainContract1718000000000 implements MigrationInterface {
  name = "FreezeMultichainDomainContract1718000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;

    await queryRunner.query(`
      ALTER TABLE "deals"
        ALTER COLUMN "escrow_address" TYPE varchar(128)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settlement_quotes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "deal_id" uuid NOT NULL,
        "domain_version" smallint NOT NULL CHECK ("domain_version" = 1),
        "version" integer NOT NULL CHECK ("version" > 0),
        "terms_version" integer NOT NULL CHECK ("terms_version" > 0),
        "terms_hash" varchar(64) NOT NULL CHECK ("terms_hash" ~ '^[0-9a-f]{64}$'),
        "fee_model" fee_model_enum NOT NULL,
        "network" settlement_network_enum NOT NULL,
        "chain_id" varchar(64) NOT NULL CHECK (length(btrim("chain_id")) > 0),
        "asset" settlement_asset_enum NOT NULL CHECK (
          ("network" = 'ton' AND "asset" IN ('ton_usdt', 'ton_native'))
          OR ("network" = 'polygon' AND "asset" = 'polygon_usdt')
        ),
        "asset_contract" varchar(128) NULL,
        "decimals" smallint NOT NULL CHECK ("decimals" BETWEEN 0 AND 18),
        "amount_atomic" varchar(78) NOT NULL CHECK ("amount_atomic" ~ '^[1-9][0-9]*$'),
        "buyer_fee_atomic" varchar(78) NOT NULL CHECK ("buyer_fee_atomic" ~ '^(0|[1-9][0-9]*)$'),
        "seller_fee_atomic" varchar(78) NOT NULL CHECK ("seller_fee_atomic" ~ '^(0|[1-9][0-9]*)$'),
        "total_funding_atomic" varchar(78) NOT NULL CHECK ("total_funding_atomic" ~ '^[1-9][0-9]*$'),
        "seller_receives_atomic" varchar(78) NOT NULL CHECK ("seller_receives_atomic" ~ '^(0|[1-9][0-9]*)$'),
        "quoted_at" timestamptz NOT NULL,
        "expires_at" timestamptz NOT NULL CHECK ("expires_at" > "quoted_at"),
        "hash" varchar(64) NOT NULL CHECK ("hash" ~ '^[0-9a-f]{64}$'),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_settlement_quote_deal"
          FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_settlement_quote_deal_version" UNIQUE ("deal_id", "version"),
        CONSTRAINT "UQ_settlement_quote_deal_hash" UNIQUE ("deal_id", "hash"),
        CONSTRAINT "UQ_settlement_quote_pointer"
          UNIQUE ("deal_id", "id", "version", "hash", "fee_model"),
        CONSTRAINT "CHK_settlement_quote_asset_contract" CHECK (
          ("asset" = 'ton_native' AND "asset_contract" IS NULL)
          OR ("asset" <> 'ton_native' AND "asset_contract" IS NOT NULL)
        ),
        CONSTRAINT "CHK_settlement_quote_conservation" CHECK (
          "total_funding_atomic"::numeric =
            "amount_atomic"::numeric + "buyer_fee_atomic"::numeric
          AND "seller_receives_atomic"::numeric =
            "amount_atomic"::numeric - "seller_fee_atomic"::numeric
          AND "seller_fee_atomic"::numeric <= "amount_atomic"::numeric
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_settlement_quote_identity"
        ON "settlement_quotes" ("network", "chain_id", "asset")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_settlement_quote_immutable" ON "settlement_quotes";
      CREATE TRIGGER "TRG_settlement_quote_immutable"
        BEFORE UPDATE OR DELETE ON "settlement_quotes"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "settlement_confirmations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "deal_id" uuid NOT NULL,
        "quote_id" uuid NOT NULL,
        "party" varchar(8) NOT NULL CHECK ("party" IN ('buyer', 'seller')),
        "user_id" uuid NOT NULL,
        "domain_version" smallint NOT NULL CHECK ("domain_version" = 1),
        "terms_version" integer NOT NULL CHECK ("terms_version" > 0),
        "terms_hash" varchar(64) NOT NULL CHECK ("terms_hash" ~ '^[0-9a-f]{64}$'),
        "quote_version" integer NOT NULL CHECK ("quote_version" > 0),
        "quote_hash" varchar(64) NOT NULL CHECK ("quote_hash" ~ '^[0-9a-f]{64}$'),
        "network" settlement_network_enum NOT NULL,
        "chain_id" varchar(64) NOT NULL,
        "asset" settlement_asset_enum NOT NULL,
        "confirmed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_settlement_confirmation_deal"
          FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_settlement_confirmation_quote"
          FOREIGN KEY ("quote_id") REFERENCES "settlement_quotes"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_settlement_confirmation_quote_party" UNIQUE ("quote_id", "party")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_settlement_confirmation_deal_quote"
        ON "settlement_confirmations" ("deal_id", "quote_id")
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_settlement_confirmation_immutable"
        ON "settlement_confirmations";
      CREATE TRIGGER "TRG_settlement_confirmation_immutable"
        BEFORE UPDATE OR DELETE ON "settlement_confirmations"
        FOR EACH ROW EXECUTE FUNCTION reject_immutable_settlement_row()
    `);

    await queryRunner.query(`
      ALTER TABLE "deals"
        ADD COLUMN IF NOT EXISTS "settlement_quote_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "settlement_quote_version" integer NULL,
        ADD COLUMN IF NOT EXISTS "settlement_quote_hash" varchar(64) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "deals"
        ADD CONSTRAINT "CHK_deal_settlement_quote_pointer"
          CHECK (
            ("settlement_quote_id" IS NULL
              AND "settlement_quote_version" IS NULL
              AND "settlement_quote_hash" IS NULL)
            OR ("settlement_quote_id" IS NOT NULL
              AND "settlement_quote_version" IS NOT NULL
              AND "settlement_quote_hash" IS NOT NULL)
          ),
        ADD CONSTRAINT "FK_deal_settlement_quote_pointer"
          FOREIGN KEY (
            "id", "settlement_quote_id", "settlement_quote_version",
            "settlement_quote_hash", "fee_model"
          ) REFERENCES "settlement_quotes" (
            "deal_id", "id", "version", "hash", "fee_model"
          )
          ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_deal_multichain_settlement_gate()
      RETURNS trigger AS $$
      DECLARE
        buyer_confirmed boolean;
        seller_confirmed boolean;
      BEGIN
        IF OLD."funded_at" IS NOT NULL OR OLD."paid_at" IS NOT NULL THEN
          IF ROW(
            NEW."settlement_network", NEW."settlement_chain_id",
            NEW."settlement_asset", NEW."asset_contract", NEW."settlement_mode",
            NEW."fee_model",
            NEW."terms_version", NEW."terms_hash", NEW."settlement_quote_id",
            NEW."settlement_quote_version", NEW."settlement_quote_hash"
          ) IS DISTINCT FROM ROW(
            OLD."settlement_network", OLD."settlement_chain_id",
            OLD."settlement_asset", OLD."asset_contract", OLD."settlement_mode",
            OLD."fee_model",
            OLD."terms_version", OLD."terms_hash", OLD."settlement_quote_id",
            OLD."settlement_quote_version", OLD."settlement_quote_hash"
          ) THEN
            RAISE EXCEPTION 'funded settlement identity is immutable'
              USING ERRCODE = '55000';
          END IF;
        END IF;

        IF NEW."settlement_network" IS NOT NULL
          AND NEW."settlement_mode" = 'native'
          AND (NEW."funded_at" IS NOT NULL OR NEW."paid_at" IS NOT NULL)
          AND OLD."funded_at" IS NULL AND OLD."paid_at" IS NULL THEN
          IF NEW."settlement_quote_id" IS NULL THEN
            RAISE EXCEPTION 'authoritative settlement quote is required before funding'
              USING ERRCODE = '55000';
          END IF;

          SELECT EXISTS (
            SELECT 1 FROM "settlement_confirmations" c
            WHERE c."deal_id" = NEW."id"
              AND c."quote_id" = NEW."settlement_quote_id"
              AND c."party" = 'buyer' AND c."user_id" = NEW."buyer_id"
              AND c."terms_version" = NEW."terms_version"
              AND c."terms_hash" = NEW."terms_hash"
              AND c."quote_version" = NEW."settlement_quote_version"
              AND c."quote_hash" = NEW."settlement_quote_hash"
              AND c."network" = NEW."settlement_network"
              AND c."chain_id" = NEW."settlement_chain_id"
              AND c."asset" = NEW."settlement_asset"
          ) INTO buyer_confirmed;
          SELECT EXISTS (
            SELECT 1 FROM "settlement_confirmations" c
            WHERE c."deal_id" = NEW."id"
              AND c."quote_id" = NEW."settlement_quote_id"
              AND c."party" = 'seller' AND c."user_id" = NEW."seller_id"
              AND c."terms_version" = NEW."terms_version"
              AND c."terms_hash" = NEW."terms_hash"
              AND c."quote_version" = NEW."settlement_quote_version"
              AND c."quote_hash" = NEW."settlement_quote_hash"
              AND c."network" = NEW."settlement_network"
              AND c."chain_id" = NEW."settlement_chain_id"
              AND c."asset" = NEW."settlement_asset"
          ) INTO seller_confirmed;
          IF NOT buyer_confirmed OR NOT seller_confirmed THEN
            RAISE EXCEPTION 'both parties must confirm exact terms and quote before funding'
              USING ERRCODE = '55000';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TRG_deal_multichain_settlement_gate" ON "deals";
      CREATE TRIGGER "TRG_deal_multichain_settlement_gate"
        BEFORE UPDATE ON "deals"
        FOR EACH ROW EXECUTE FUNCTION enforce_deal_multichain_settlement_gate()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_deal_multichain_settlement_gate" ON "deals"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS enforce_deal_multichain_settlement_gate()`,
    );
    await queryRunner.query(`
      ALTER TABLE "deals"
        DROP CONSTRAINT IF EXISTS "FK_deal_settlement_quote_pointer",
        DROP CONSTRAINT IF EXISTS "CHK_deal_settlement_quote_pointer",
        DROP COLUMN IF EXISTS "settlement_quote_hash",
        DROP COLUMN IF EXISTS "settlement_quote_version",
        DROP COLUMN IF EXISTS "settlement_quote_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "settlement_confirmations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "settlement_quotes"`);
  }
}
