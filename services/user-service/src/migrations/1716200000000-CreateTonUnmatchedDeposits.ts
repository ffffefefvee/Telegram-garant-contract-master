import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ledger for incoming USDT-TON transfers that no payment claims
 * (missing/typo'd memo, or memo of an expired payment). Written by the
 * TonUnmatchedScanner, resolved manually by admins.
 *
 * SQLite dev mode uses synchronize, so we only act on postgres here.
 */
export class CreateTonUnmatchedDeposits1716200000000
  implements MigrationInterface
{
  name = 'CreateTonUnmatchedDeposits1716200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_unmatched_deposits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventId" character varying(100) NOT NULL,
        "actionIndex" integer NOT NULL DEFAULT 0,
        "txTimestamp" bigint NOT NULL,
        "senderAddress" character varying(100) NOT NULL,
        "amountUnits" character varying(40) NOT NULL,
        "comment" text,
        "status" character varying(16) NOT NULL DEFAULT 'unmatched',
        "paymentHintId" uuid,
        "matchedPaymentId" uuid,
        "resolvedBy" uuid,
        "resolvedAt" TIMESTAMP,
        "resolutionNote" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ton_unmatched_deposits" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ton_unmatched_event_action" UNIQUE ("eventId", "actionIndex")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ton_unmatched_status" ON "ton_unmatched_deposits" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ton_unmatched_createdAt" ON "ton_unmatched_deposits" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_unmatched_deposits"`);
  }
}
