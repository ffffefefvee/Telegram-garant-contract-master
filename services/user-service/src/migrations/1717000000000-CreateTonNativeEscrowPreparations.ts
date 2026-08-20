import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTonNativeEscrowPreparations1717000000000 implements MigrationInterface {
  name = "CreateTonNativeEscrowPreparations1717000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ton_native_escrow_preparations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "dealId" uuid NOT NULL,
        "network" varchar(16) NOT NULL,
        "chainId" varchar(16) NOT NULL,
        "termsHash" varchar(64) NOT NULL,
        "quoteHash" varchar(64) NOT NULL,
        "codeHash" varchar(64) NOT NULL,
        "configHash" varchar(64) NOT NULL,
        "escrowAddress" varchar(128) NOT NULL,
        "buyerAddress" varchar(128) NOT NULL,
        "sellerAddress" varchar(128) NOT NULL,
        "arbitratorAddress" varchar(128) NOT NULL,
        "treasuryAddress" varchar(128) NOT NULL,
        "buyerTotalAtomic" varchar(78) NOT NULL,
        "sellerPayoutAtomic" varchar(78) NOT NULL,
        "platformFeeAtomic" varchar(78) NOT NULL,
        "refundToBuyerAtomic" varchar(78) NOT NULL,
        "refundFeeAtomic" varchar(78) NOT NULL,
        "requestAmountAtomic" varchar(78) NOT NULL,
        "queryId" varchar(20) NOT NULL,
        "fundingDeadline" varchar(20) NOT NULL,
        "deliveryDeadline" varchar(20) NOT NULL,
        "confirmationDeadline" varchar(20) NOT NULL,
        "stateInit" text NOT NULL,
        "payload" text NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ton_native_escrow_preparations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ton_native_escrow_preparations_dealId" UNIQUE ("dealId"),
        CONSTRAINT "UQ_ton_native_escrow_preparations_quoteHash" UNIQUE ("quoteHash"),
        CONSTRAINT "FK_ton_native_escrow_preparations_dealId"
          FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ton_native_escrow_preparations_dealId"
        ON "ton_native_escrow_preparations" ("dealId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== "postgres") return;
    await queryRunner.query(
      `DROP TABLE IF EXISTS "ton_native_escrow_preparations"`,
    );
  }
}
