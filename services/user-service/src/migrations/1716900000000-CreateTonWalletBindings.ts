import { MigrationInterface, QueryRunner } from "typeorm";

/** Persistent, replay-safe TON Connect ownership verification state. */
export class CreateTonWalletBindings1716900000000 implements MigrationInterface {
  name = "CreateTonWalletBindings1716900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_proof_challenges" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "payloadHash" varchar(64) NOT NULL,
        "expiresAt" timestamp NOT NULL,
        "consumedAt" timestamp NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ton_proof_challenges" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ton_proof_challenges_payloadHash" UNIQUE ("payloadHash"),
        CONSTRAINT "FK_ton_proof_challenges_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_proof_challenges_user_expiry"
        ON "ton_proof_challenges" ("userId", "expiresAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_wallet_bindings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "network" varchar(16) NOT NULL,
        "address" varchar(128) NOT NULL,
        "publicKey" varchar(64) NOT NULL,
        "walletStateInit" text NOT NULL,
        "verifiedAt" timestamp NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ton_wallet_bindings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ton_wallet_bindings_user_network"
          UNIQUE ("userId", "network"),
        CONSTRAINT "UQ_ton_wallet_bindings_network_address"
          UNIQUE ("network", "address"),
        CONSTRAINT "FK_ton_wallet_bindings_userId"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_wallet_bindings_userId"
        ON "ton_wallet_bindings" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_wallet_bindings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ton_proof_challenges"`);
  }
}
