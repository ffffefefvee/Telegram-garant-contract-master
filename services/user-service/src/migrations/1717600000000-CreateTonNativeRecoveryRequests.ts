import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTonNativeRecoveryRequests1717600000000 implements MigrationInterface {
  name = "CreateTonNativeRecoveryRequests1717600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_native_recovery_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "eventId" uuid NOT NULL,
        "requestedBy" uuid NOT NULL,
        "approvedBy" uuid NULL,
        "status" varchar(24) NOT NULL,
        "reason" text NOT NULL,
        "expectedLastError" text NOT NULL,
        "approvedAt" timestamp NULL,
        "executedAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ton_native_recovery_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ton_native_recovery_request_event"
          FOREIGN KEY ("eventId") REFERENCES "ton_native_chain_events"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_native_recovery_event_status"
        ON "ton_native_recovery_requests" ("eventId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_native_recovery_requests"`,
    );
  }
}
