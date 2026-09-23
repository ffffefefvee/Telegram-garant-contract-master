import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTonUnmatchedRecoveryRequests1718700000000
  implements MigrationInterface
{
  name = "CreateTonUnmatchedRecoveryRequests1718700000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE ton_unmatched_recovery_requests (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      deposit_id uuid NOT NULL REFERENCES ton_unmatched_deposits(id) ON DELETE RESTRICT,
      action varchar(16) NOT NULL CHECK (action IN ('match','ignore')),
      payment_id uuid NULL REFERENCES payments(id) ON DELETE RESTRICT,
      reason text NULL,
      intent_hash char(64) NOT NULL UNIQUE CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
      expected_deposit_updated_at timestamp NOT NULL,
      expected_payment_state_hash char(64) NULL,
      requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      requester_jti varchar(128) NOT NULL,
      requester_sid varchar(128) NOT NULL,
      approved_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
      approver_jti varchar(128) NULL,
      approver_sid varchar(128) NULL,
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executed','cancelled','expired')),
      expires_at timestamp NOT NULL,
      executed_at timestamp NULL,
      cancelled_at timestamp NULL,
      cancelled_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
      cancellation_reason text NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      CHECK (expires_at > created_at),
      CHECK ((action = 'match' AND payment_id IS NOT NULL AND expected_payment_state_hash IS NOT NULL) OR
             (action = 'ignore' AND payment_id IS NULL AND expected_payment_state_hash IS NULL)),
      CHECK ((status = 'executed') = (executed_at IS NOT NULL)),
      CHECK ((status = 'executed') = (approved_by IS NOT NULL AND approver_jti IS NOT NULL AND approver_sid IS NOT NULL)),
      CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL)),
      CHECK (approved_by IS NULL OR approved_by <> requested_by),
      CHECK (approver_sid IS NULL OR approver_sid <> requester_sid)
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_ton_unmatched_pending_recovery
      ON ton_unmatched_recovery_requests (deposit_id) WHERE status = 'pending'`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION protect_ton_unmatched_recovery_intent()
      RETURNS trigger AS $$ BEGIN
        IF ROW(NEW.deposit_id,NEW.action,NEW.payment_id,NEW.reason,NEW.intent_hash,
          NEW.expected_deposit_updated_at,NEW.expected_payment_state_hash,
          NEW.requested_by,NEW.requester_jti,NEW.requester_sid,NEW.expires_at,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.deposit_id,OLD.action,OLD.payment_id,OLD.reason,OLD.intent_hash,
          OLD.expected_deposit_updated_at,OLD.expected_payment_state_hash,
          OLD.requested_by,OLD.requester_jti,OLD.requester_sid,OLD.expires_at,OLD.created_at)
        THEN RAISE EXCEPTION 'recovery intent is immutable'; END IF;
        IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'terminal recovery request is immutable'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER ton_unmatched_recovery_immutable
      BEFORE UPDATE ON ton_unmatched_recovery_requests FOR EACH ROW
      EXECUTE FUNCTION protect_ton_unmatched_recovery_intent()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS ton_unmatched_recovery_requests");
    await queryRunner.query("DROP FUNCTION IF EXISTS protect_ton_unmatched_recovery_intent()");
  }
}
