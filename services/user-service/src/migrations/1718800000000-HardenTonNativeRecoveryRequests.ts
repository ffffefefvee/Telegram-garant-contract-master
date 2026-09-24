import { MigrationInterface, QueryRunner } from "typeorm";

export class HardenTonNativeRecoveryRequests1718800000000
  implements MigrationInterface
{
  name = "HardenTonNativeRecoveryRequests1718800000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`ALTER TABLE "ton_native_recovery_requests"
      ADD COLUMN "requesterJti" varchar(128),
      ADD COLUMN "requesterSid" varchar(128),
      ADD COLUMN "approverJti" varchar(128),
      ADD COLUMN "approverSid" varchar(128),
      ADD COLUMN "intentHash" char(64),
      ADD COLUMN "expiresAt" timestamp,
      ADD COLUMN "cancelledAt" timestamp,
      ADD COLUMN "cancelledBy" uuid,
      ADD COLUMN "cancellationReason" text`);
    await queryRunner.query(`UPDATE "ton_native_recovery_requests" SET
      "requesterJti" = 'legacy:' || id::text,
      "requesterSid" = 'legacy:' || id::text,
      "approverJti" = CASE WHEN "approvedBy" IS NULL THEN NULL ELSE 'legacy:' || id::text END,
      "approverSid" = CASE WHEN "approvedBy" IS NULL THEN NULL ELSE 'legacy:' || id::text END,
      "intentHash" = replace(id::text, '-', '') || replace(id::text, '-', ''),
      "expiresAt" = "createdAt",
      "cancelledAt" = CASE WHEN "status" = 'cancelled' THEN "updatedAt" ELSE NULL END,
      "cancelledBy" = CASE WHEN "status" = 'cancelled' THEN "requestedBy" ELSE NULL END,
      "cancellationReason" = CASE WHEN "status" = 'cancelled' THEN 'Legacy cancellation migrated fail-closed' ELSE NULL END,
      "status" = CASE WHEN "status" = 'pending' THEN 'expired' ELSE "status" END`);
    await queryRunner.query(`ALTER TABLE "ton_native_recovery_requests"
      ALTER COLUMN "requesterJti" SET NOT NULL,
      ALTER COLUMN "requesterSid" SET NOT NULL,
      ALTER COLUMN "intentHash" SET NOT NULL,
      ALTER COLUMN "expiresAt" SET NOT NULL,
      ADD CONSTRAINT "UQ_ton_native_recovery_intent" UNIQUE ("intentHash"),
      ADD CONSTRAINT "CK_ton_native_recovery_status" CHECK ("status" IN ('pending','executed','cancelled','expired')),
      ADD CONSTRAINT "CK_ton_native_recovery_approval" CHECK (("status" = 'executed') = ("approvedBy" IS NOT NULL AND "approverJti" IS NOT NULL AND "approverSid" IS NOT NULL AND "approvedAt" IS NOT NULL AND "executedAt" IS NOT NULL)),
      ADD CONSTRAINT "CK_ton_native_recovery_cancel" CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancellationReason" IS NOT NULL)),
      ADD CONSTRAINT "CK_ton_native_recovery_distinct_actor" CHECK ("approvedBy" IS NULL OR "approvedBy" <> "requestedBy"),
      ADD CONSTRAINT "CK_ton_native_recovery_distinct_session" CHECK ("approverSid" IS NULL OR "approverSid" <> "requesterSid")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_ton_native_pending_recovery"
      ON "ton_native_recovery_requests" ("eventId") WHERE "status" = 'pending'`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION protect_ton_native_recovery_intent()
      RETURNS trigger AS $$ BEGIN
        IF ROW(NEW."eventId",NEW."requestedBy",NEW."requesterJti",NEW."requesterSid",
          NEW.reason,NEW."expectedLastError",NEW."intentHash",NEW."expiresAt",NEW."createdAt")
        IS DISTINCT FROM ROW(OLD."eventId",OLD."requestedBy",OLD."requesterJti",OLD."requesterSid",
          OLD.reason,OLD."expectedLastError",OLD."intentHash",OLD."expiresAt",OLD."createdAt")
        THEN RAISE EXCEPTION 'native recovery intent is immutable'; END IF;
        IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'terminal native recovery request is immutable'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER ton_native_recovery_immutable
      BEFORE UPDATE ON "ton_native_recovery_requests" FOR EACH ROW
      EXECUTE FUNCTION protect_ton_native_recovery_intent()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TRIGGER IF EXISTS ton_native_recovery_immutable ON "ton_native_recovery_requests"`);
    await queryRunner.query("DROP FUNCTION IF EXISTS protect_ton_native_recovery_intent()");
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ton_native_pending_recovery"`);
    await queryRunner.query(`ALTER TABLE "ton_native_recovery_requests"
      DROP CONSTRAINT IF EXISTS "CK_ton_native_recovery_distinct_session",
      DROP CONSTRAINT IF EXISTS "CK_ton_native_recovery_distinct_actor",
      DROP CONSTRAINT IF EXISTS "CK_ton_native_recovery_cancel",
      DROP CONSTRAINT IF EXISTS "CK_ton_native_recovery_approval",
      DROP CONSTRAINT IF EXISTS "CK_ton_native_recovery_status",
      DROP CONSTRAINT IF EXISTS "UQ_ton_native_recovery_intent",
      DROP COLUMN IF EXISTS "cancellationReason",
      DROP COLUMN IF EXISTS "cancelledBy",
      DROP COLUMN IF EXISTS "cancelledAt",
      DROP COLUMN IF EXISTS "expiresAt",
      DROP COLUMN IF EXISTS "intentHash",
      DROP COLUMN IF EXISTS "approverSid",
      DROP COLUMN IF EXISTS "approverJti",
      DROP COLUMN IF EXISTS "requesterSid",
      DROP COLUMN IF EXISTS "requesterJti"`);
  }
}
