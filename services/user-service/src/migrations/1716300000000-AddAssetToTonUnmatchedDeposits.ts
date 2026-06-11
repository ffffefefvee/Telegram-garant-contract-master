import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Toncoin rail brings native TON deposits into the unmatched ledger —
 * rows now record WHICH asset arrived ('USDT' jetton units or 'TON'
 * nanotons), so manual matching credits the right kind of units.
 *
 * Postgres-only (the sqlite dev mode uses TypeORM synchronize).
 */
export class AddAssetToTonUnmatchedDeposits1716300000000
  implements MigrationInterface
{
  name = 'AddAssetToTonUnmatchedDeposits1716300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(
      `ALTER TABLE "ton_unmatched_deposits" ADD COLUMN IF NOT EXISTS "asset" character varying(8) NOT NULL DEFAULT 'USDT'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(
      `ALTER TABLE "ton_unmatched_deposits" DROP COLUMN IF EXISTS "asset"`,
    );
  }
}
