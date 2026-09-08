import { MigrationInterface, QueryRunner } from "typeorm";
import { createPgEnum, dropPgEnum } from "../database/migration-enum.helper";

/**
 * Adds nullable multichain deal fields without changing current money movement.
 * Existing EVM escrows are classified as Polygon. Existing deals funded via a
 * TON rail into Polygon escrow are explicitly marked as legacy hybrid.
 */
export class AddMultichainSettlementFields1716800000000 implements MigrationInterface {
  name = "AddMultichainSettlementFields1716800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Local SQLite uses TypeORM synchronize; enum DDL below is PostgreSQL-only.
    if (queryRunner.connection.options.type !== "postgres") return;

    await createPgEnum(queryRunner, "settlement_network_enum", [
      "ton",
      "polygon",
    ]);
    await createPgEnum(queryRunner, "settlement_asset_enum", [
      "ton_usdt",
      "ton_native",
      "polygon_usdt",
    ]);
    await createPgEnum(queryRunner, "settlement_mode_enum", [
      "native",
      "legacy_ton_to_polygon",
    ]);

    await queryRunner.query(`
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS escrow_address VARCHAR(64),
        ADD COLUMN IF NOT EXISTS settlement_network settlement_network_enum,
        ADD COLUMN IF NOT EXISTS settlement_chain_id VARCHAR(64),
        ADD COLUMN IF NOT EXISTS settlement_asset settlement_asset_enum,
        ADD COLUMN IF NOT EXISTS asset_contract VARCHAR(128),
        ADD COLUMN IF NOT EXISTS settlement_mode settlement_mode_enum,
        ADD COLUMN IF NOT EXISTS quote_id UUID,
        ADD COLUMN IF NOT EXISTS terms_version INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS terms_hash VARCHAR(64),
        ADD COLUMN IF NOT EXISTS buyer_wallet_address VARCHAR(128),
        ADD COLUMN IF NOT EXISTS seller_wallet_address VARCHAR(128),
        ADD COLUMN IF NOT EXISTS funded_at TIMESTAMP
    `);

    await queryRunner.query(`
      UPDATE deals
      SET settlement_network = 'polygon',
          settlement_asset = 'polygon_usdt',
          settlement_mode = CASE
            WHEN EXISTS (
              SELECT 1
              FROM payments p
              WHERE p.deal_id = deals.id
                AND p.payment_method::text IN ('crypto_ton', 'crypto_toncoin')
            ) THEN 'legacy_ton_to_polygon'::settlement_mode_enum
            ELSE 'native'::settlement_mode_enum
          END,
          funded_at = COALESCE(paid_at, funded_at)
      WHERE escrow_address IS NOT NULL
        AND settlement_network IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_deals_settlement_network
        ON deals (settlement_network)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;

    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_deals_settlement_network`,
    );
    await queryRunner.query(`
      ALTER TABLE deals
        DROP COLUMN IF EXISTS escrow_address,
        DROP COLUMN IF EXISTS funded_at,
        DROP COLUMN IF EXISTS seller_wallet_address,
        DROP COLUMN IF EXISTS buyer_wallet_address,
        DROP COLUMN IF EXISTS terms_hash,
        DROP COLUMN IF EXISTS terms_version,
        DROP COLUMN IF EXISTS quote_id,
        DROP COLUMN IF EXISTS settlement_mode,
        DROP COLUMN IF EXISTS asset_contract,
        DROP COLUMN IF EXISTS settlement_asset,
        DROP COLUMN IF EXISTS settlement_chain_id,
        DROP COLUMN IF EXISTS settlement_network
    `);

    await dropPgEnum(queryRunner, "settlement_mode_enum");
    await dropPgEnum(queryRunner, "settlement_asset_enum");
    await dropPgEnum(queryRunner, "settlement_network_enum");
  }
}
