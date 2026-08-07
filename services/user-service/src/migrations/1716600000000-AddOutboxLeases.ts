import { MigrationInterface, QueryRunner } from "typeorm";

/** Adds recoverable worker leases without changing existing outbox rows. */
export class AddOutboxLeases1716600000000 implements MigrationInterface {
  name = "AddOutboxLeases1716600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "leaseOwner" varchar(64) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" timestamp NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outbox_lease_expiry" ON "outbox_events" ("status", "leaseExpiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_lease_expiry"`);
    await queryRunner.query(
      `ALTER TABLE "outbox_events" DROP COLUMN IF EXISTS "leaseExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" DROP COLUMN IF EXISTS "leaseOwner"`,
    );
  }
}
