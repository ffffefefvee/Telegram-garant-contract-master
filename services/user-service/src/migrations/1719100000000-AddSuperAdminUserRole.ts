import { MigrationInterface, QueryRunner } from 'typeorm';

/** Align the PostgreSQL user-role enum with UserType.SUPER_ADMIN. */
export class AddSuperAdminUserRole1719100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "user_type_enum" ADD VALUE IF NOT EXISTS 'super_admin'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL enum labels cannot be removed safely while rows may use them.
  }
}
