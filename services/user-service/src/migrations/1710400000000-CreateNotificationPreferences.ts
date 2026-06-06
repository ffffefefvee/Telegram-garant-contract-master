import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * H2S1 PR 1/3 — `notification_preferences` table.
 *
 * Per-user opt-outs. Row is lazily inserted on first settings-update; if
 * no row exists the dispatcher treats the user as "default-on".
 */
export class CreateNotificationPreferences1710400000000
  implements MigrationInterface
{
  name = 'CreateNotificationPreferences1710400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL UNIQUE,
        "mutedAll" boolean NOT NULL DEFAULT false,
        "mutedEventTypes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "quietHoursStart" varchar(5) NULL,
        "quietHoursEnd" varchar(5) NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_preferences_userId" ON "notification_preferences" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_preferences_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
  }
}
