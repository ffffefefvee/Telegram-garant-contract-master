import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTonJettonRecoveryRequests1719200000000 implements MigrationInterface {
  name = "CreateTonJettonRecoveryRequests1719200000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`CREATE TABLE "ton_jetton_recovery_requests" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(16) NOT NULL CHECK ("kind" IN ('cursor','requeue')),
      "targetKey" varchar(256) NOT NULL,
      "target" jsonb NOT NULL,
      "expectedStateHash" char(64) NOT NULL,
      "reasonCode" varchar(64) NOT NULL,
      "requestedBy" uuid NOT NULL,
      "requesterJti" varchar(128) NOT NULL,
      "requesterSid" varchar(128) NOT NULL,
      "approvedBy" uuid NULL,
      "approverJti" varchar(128) NULL,
      "approverSid" varchar(128) NULL,
      "status" varchar(16) NOT NULL CHECK ("status" IN ('pending','executed','cancelled','expired')),
      "intentHash" char(64) NOT NULL UNIQUE,
      "expiresAt" timestamp NOT NULL,
      "approvedAt" timestamp NULL,
      "executedAt" timestamp NULL,
      "cancelledAt" timestamp NULL,
      "cancelledBy" uuid NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "CK_jetton_recovery_target_object" CHECK (jsonb_typeof("target") = 'object'),
      CONSTRAINT "CK_jetton_recovery_idp_claims" CHECK (length("requesterJti") > 0 AND length("requesterSid") > 0),
      CONSTRAINT "CK_jetton_recovery_distinct_actor" CHECK ("approvedBy" IS NULL OR "approvedBy" <> "requestedBy"),
      CONSTRAINT "CK_jetton_recovery_distinct_session" CHECK ("approverSid" IS NULL OR "approverSid" <> "requesterSid"),
      CONSTRAINT "CK_jetton_recovery_execution" CHECK (
        ("status" = 'executed' AND "approvedBy" IS NOT NULL AND "approverJti" IS NOT NULL AND "approverSid" IS NOT NULL AND "approvedAt" IS NOT NULL AND "executedAt" IS NOT NULL)
        OR ("status" <> 'executed' AND "approvedBy" IS NULL AND "approverJti" IS NULL AND "approverSid" IS NULL AND "approvedAt" IS NULL AND "executedAt" IS NULL)),
      CONSTRAINT "CK_jetton_recovery_cancel" CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL))
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_jetton_pending_recovery" ON "ton_jetton_recovery_requests" ("kind", "targetKey") WHERE "status" = 'pending'`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION protect_jetton_recovery_intent() RETURNS trigger AS $$ BEGIN
      IF ROW(NEW."kind",NEW."targetKey",NEW."target",NEW."expectedStateHash",NEW."reasonCode",NEW."requestedBy",NEW."requesterJti",NEW."requesterSid",NEW."intentHash",NEW."expiresAt",NEW."createdAt")
      IS DISTINCT FROM ROW(OLD."kind",OLD."targetKey",OLD."target",OLD."expectedStateHash",OLD."reasonCode",OLD."requestedBy",OLD."requesterJti",OLD."requesterSid",OLD."intentHash",OLD."expiresAt",OLD."createdAt")
      THEN RAISE EXCEPTION 'jetton recovery intent is immutable'; END IF;
      IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'terminal jetton recovery request is immutable'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER ton_jetton_recovery_immutable BEFORE UPDATE ON "ton_jetton_recovery_requests" FOR EACH ROW EXECUTE FUNCTION protect_jetton_recovery_intent()`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION forbid_jetton_recovery_delete() RETURNS trigger AS $$ BEGIN
      RAISE EXCEPTION 'jetton recovery requests cannot be deleted';
    END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER ton_jetton_recovery_no_delete BEFORE DELETE ON "ton_jetton_recovery_requests" FOR EACH ROW EXECUTE FUNCTION forbid_jetton_recovery_delete()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_jetton_recovery_requests"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS protect_jetton_recovery_intent()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS forbid_jetton_recovery_delete()`);
  }
}
