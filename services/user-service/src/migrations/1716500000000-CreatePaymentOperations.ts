import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Additive, online-safe state machine for external payment side effects.
 * Existing webhook rows remain untouched; rollback drops only this new table.
 */
export class CreatePaymentOperations1716500000000 implements MigrationInterface {
  name = "CreatePaymentOperations1716500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_operations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "eventKey" varchar(255) NOT NULL,
        "operationType" varchar(48) NOT NULL,
        "paymentId" uuid NULL,
        "dealId" uuid NULL,
        "status" varchar(24) NOT NULL DEFAULT 'processing',
        "attempts" integer NOT NULL DEFAULT 0,
        "leaseOwner" varchar(64) NULL,
        "leaseExpiresAt" timestamp NULL,
        "transferTxHash" varchar(255) NULL,
        "notifyTxHash" varchar(255) NULL,
        "lastErrorCode" varchar(64) NULL,
        "lastError" text NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_payment_operation_provider_key_type" UNIQUE ("provider", "eventKey", "operationType")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_operation_status_lease" ON "payment_operations" ("status", "leaseExpiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_operation_deal" ON "payment_operations" ("dealId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_operations"`);
  }
}
