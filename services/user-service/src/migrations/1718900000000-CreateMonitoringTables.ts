import { MigrationInterface, QueryRunner } from 'typeorm';

/** Legacy monitoring entities were never included in the PostgreSQL migration chain. */
export class CreateMonitoringTables1718900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "system_alerts" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "type" varchar NOT NULL CHECK ("type" IN ('deal_stuck','payment_failed','escrow_unresponsive','user_report','system_error','arbitration_pending','commission_alert')),
      "severity" varchar NOT NULL DEFAULT 'info' CHECK ("severity" IN ('info','warning','error','critical')),
      "title" varchar NOT NULL, "message" text, "dealId" varchar, "userId" varchar,
      "metadata" jsonb, "isResolved" boolean NOT NULL DEFAULT false, "resolvedBy" varchar,
      "resolvedAt" timestamp, "resolution" text,
      "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "health_checks" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "service" varchar NOT NULL,
      "isHealthy" boolean NOT NULL DEFAULT true, "responseTime" integer, "errorMessage" varchar,
      "lastError" varchar, "consecutiveFailures" integer, "lastCheckAt" timestamp,
      "nextCheckAt" timestamp, "details" jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "system_metrics" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "metric" varchar NOT NULL,
      "value" decimal(18,2) NOT NULL, "unit" varchar, "service" varchar, "tags" varchar,
      "timestamp" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "recovery_logs" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "incidentType" varchar NOT NULL,
      "description" text, "affectedEntities" jsonb, "dealId" varchar, "userId" varchar,
      "severity" varchar NOT NULL DEFAULT 'info' CHECK ("severity" IN ('info','warning','error','critical')),
      "rootCause" varchar, "fixApplied" varchar, "recoveryTime" integer,
      "autoRecovered" boolean, "recoveredBy" varchar,
      "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "job_schedules" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "name" varchar NOT NULL,
      "description" varchar, "jobType" varchar NOT NULL, "cronExpression" varchar,
      "intervalMs" integer, "lastRunAt" timestamp, "nextRunAt" timestamp,
      "runCount" integer NOT NULL DEFAULT 0, "errorCount" integer NOT NULL DEFAULT 0,
      "lastError" varchar, "isActive" boolean NOT NULL DEFAULT true, "config" jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Deliberately retain monitoring records. These tables may have existed
    // before this migration on databases formerly managed by synchronize.
  }
}
