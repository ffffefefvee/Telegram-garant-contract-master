import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds two operations-critical tables for H1S2 PR 6/6:
 *
 *  - `outbox_events`  — transactional outbox. Domain code writes a row in
 *    the same DB tx that mutates business state; the OutboxWorker
 *    delivers them best-effort (notifications, downstream services).
 *    Survives crashes; idempotency is the consumer's job.
 *
 *  - `audit_log`      — append-only record of every meaningful state
 *    transition (deal/dispute/payment status changes, admin actions).
 *    Driven by AuditLogService; never updated, only inserted.
 *
 * Both tables index on `createdAt` for cheap recent-activity queries
 * and on the actor/aggregate id for per-entity scrolling.
 */
export class CreateOutboxAndAuditLog1710300000000 implements MigrationInterface {
  name = 'CreateOutboxAndAuditLog1710300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "aggregateType" varchar(64) NOT NULL,
        "aggregateId" varchar(64) NOT NULL,
        "eventType" varchar(96) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text NULL,
        "availableAt" timestamp NOT NULL DEFAULT now(),
        "deliveredAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outbox_status_availableAt" ON "outbox_events" ("status","availableAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outbox_aggregate" ON "outbox_events" ("aggregateType","aggregateId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_log" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actorId" uuid NULL,
        "actorRole" varchar(32) NULL,
        "aggregateType" varchar(64) NOT NULL,
        "aggregateId" varchar(64) NOT NULL,
        "action" varchar(96) NOT NULL,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_aggregate" ON "audit_log" ("aggregateType","aggregateId","createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_actor" ON "audit_log" ("actorId","createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_actor"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_aggregate"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_aggregate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_status_availableAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_events"`);
  }
}
