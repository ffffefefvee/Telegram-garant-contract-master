import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the EVM wallet fields to `users`. Required for H1S2 escrow integration —
 * sellers receive payouts at `walletAddress`, arbitrators sign with it. NULL
 * until the user attaches a wallet via the mini-app.
 */
export class AddUserWallet1710200000000 implements MigrationInterface {
  name = 'AddUserWallet1710200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "walletAddress" varchar(42) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "walletAttachedAt" timestamp NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_walletAddress" ON "users" ("walletAddress")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_walletAddress"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "walletAttachedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "walletAddress"`);
  }
}
