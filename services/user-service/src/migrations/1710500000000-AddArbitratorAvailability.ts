import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * H2S1 PR 3/3 — `arbitrator_profiles.availability` self-service work-state.
 *
 * Orthogonal to the admin-managed `status` column: an ACTIVE arbitrator
 * can flip themselves AWAY without going through admin re-approval.
 * Auto-assignment in ArbitratorSelectionService now requires
 * (status='active' AND availability='available').
 */
export class AddArbitratorAvailability1710500000000
  implements MigrationInterface
{
  name = 'AddArbitratorAvailability1710500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "arbitrator_profiles_availability_enum" AS ENUM ('available', 'away');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "arbitrator_profiles"
      ADD COLUMN IF NOT EXISTS "availability" "arbitrator_profiles_availability_enum"
        NOT NULL DEFAULT 'available'
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_arbitrator_profiles_availability" ON "arbitrator_profiles" ("availability")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_arbitrator_profiles_availability"`,
    );
    await queryRunner.query(
      `ALTER TABLE "arbitrator_profiles" DROP COLUMN IF EXISTS "availability"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "arbitrator_profiles_availability_enum"`,
    );
  }
}
