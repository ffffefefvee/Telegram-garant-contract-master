import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotency ledger for inbound payment-provider webhooks.
 *
 * Backs `WebhookIdempotencyService`: a re-delivered `paid` webhook must not
 * trigger a second relay USDT transfer into the escrow clone. The unique
 * `(provider, eventKey)` constraint makes the mark-as-processed write safe
 * under concurrent duplicate deliveries.
 */
export class CreateProcessedWebhookEvents1716400000000
  implements MigrationInterface
{
  name = 'CreateProcessedWebhookEvents1716400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "processed_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "eventKey" varchar(255) NOT NULL,
        "orderId" varchar(100) NULL,
        "status" varchar(32) NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "processed_webhook_events" ADD CONSTRAINT "UQ_processed_webhook_provider_key" UNIQUE ("provider","eventKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_processed_webhook_createdAt" ON "processed_webhook_events" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_processed_webhook_createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "processed_webhook_events" DROP CONSTRAINT IF EXISTS "UQ_processed_webhook_provider_key"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "processed_webhook_events"`,
    );
  }
}
