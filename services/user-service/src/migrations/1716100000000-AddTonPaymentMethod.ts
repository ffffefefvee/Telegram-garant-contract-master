import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 'crypto_ton' value to payment_method_enum (Stage 2: TON rail).
 *
 * Note: `ALTER TYPE ... ADD VALUE` is allowed inside a transaction block
 * since PostgreSQL 12 (as long as the type wasn't created in the same
 * transaction). `IF NOT EXISTS` makes the migration idempotent.
 *
 * SQLite dev mode uses TypeORM simple-enum + synchronize, so we only act
 * on postgres here.
 */
export class AddTonPaymentMethod1716100000000 implements MigrationInterface {
  name = 'AddTonPaymentMethod1716100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(
      `ALTER TYPE "payment_method_enum" ADD VALUE IF NOT EXISTS 'crypto_ton'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot remove a value from an enum; recreating the type
    // would require rewriting the payments table. Intentionally a no-op.
  }
}
