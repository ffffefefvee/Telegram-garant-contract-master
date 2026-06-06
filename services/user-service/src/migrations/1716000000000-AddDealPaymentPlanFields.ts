import { MigrationInterface, QueryRunner } from 'typeorm';
import { createPgEnum, dropPgEnum } from '../database/migration-enum.helper';

/**
 * Adds fields required by PRODUCT_PLAN §9, D3, D4, D5:
 *  - subcategory (DealSubcategory enum): digital-goods sub-type
 *  - quote_amount / quote_currency: price in the user-selected currency (RUB | USDT)
 *  - amount_usdt / fx_rate_locked_at: USDT equivalent locked at funding time
 *  - fee_model (FeeModel enum): commission distribution model (D4)
 *  - fee_buyer_usdt / fee_seller_usdt: per-side commission amounts (D5)
 */
export class AddDealPaymentPlanFields1716000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPgEnum(queryRunner, 'deal_subcategory_enum', [
      'account',
      'key_code',
      'file',
      'online_service',
      'subscription_transfer',
    ]);

    await createPgEnum(queryRunner, 'fee_model_enum', [
      'split_50_50',
      'buyer_pays',
      'seller_pays',
    ]);

    await queryRunner.query(`
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS subcategory deal_subcategory_enum,
        ADD COLUMN IF NOT EXISTS quote_amount NUMERIC(18,6),
        ADD COLUMN IF NOT EXISTS quote_currency VARCHAR(8),
        ADD COLUMN IF NOT EXISTS amount_usdt NUMERIC(18,6),
        ADD COLUMN IF NOT EXISTS fx_rate_locked_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS fee_model fee_model_enum NOT NULL DEFAULT 'buyer_pays',
        ADD COLUMN IF NOT EXISTS fee_buyer_usdt NUMERIC(18,6) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fee_seller_usdt NUMERIC(18,6) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE deals
        DROP COLUMN IF EXISTS subcategory,
        DROP COLUMN IF EXISTS quote_amount,
        DROP COLUMN IF EXISTS quote_currency,
        DROP COLUMN IF EXISTS amount_usdt,
        DROP COLUMN IF EXISTS fx_rate_locked_at,
        DROP COLUMN IF EXISTS fee_model,
        DROP COLUMN IF EXISTS fee_buyer_usdt,
        DROP COLUMN IF EXISTS fee_seller_usdt
    `);

    await dropPgEnum(queryRunner, 'fee_model_enum');
    await dropPgEnum(queryRunner, 'deal_subcategory_enum');
  }
}
