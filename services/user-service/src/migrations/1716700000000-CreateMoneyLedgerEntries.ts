import { MigrationInterface, QueryRunner } from "typeorm";

/** Immutable ledger entries; no existing payment data is rewritten. */
export class CreateMoneyLedgerEntries1716700000000 implements MigrationInterface {
  name = "CreateMoneyLedgerEntries1716700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "money_ledger_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "dealId" uuid NULL,
        "paymentId" uuid NULL,
        "idempotencyKey" varchar(96) NOT NULL,
        "debitAccount" varchar(64) NOT NULL,
        "creditAccount" varchar(64) NOT NULL,
        "amount" numeric(24,8) NOT NULL CHECK ("amount" > 0),
        "currency" varchar(12) NOT NULL,
        "entryType" varchar(48) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_money_ledger_idempotency_key" UNIQUE ("idempotencyKey")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_money_ledger_deal_created" ON "money_ledger_entries" ("dealId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "money_ledger_entries"`);
  }
}
