import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeAuditLogAppendOnly1718300000000 implements MigrationInterface {
  name = "MakeAuditLogAppendOnly1718300000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit log is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_append_only
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log",
    );
    await queryRunner.query("DROP FUNCTION IF EXISTS reject_audit_log_mutation()");
  }
}
