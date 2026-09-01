import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { databaseConfig } from "../../config/database";

const runPostgres = process.env.RUN_PHASE4_POSTGRES === "true";
const describePostgres = runPostgres ? describe : describe.skip;
const HASH = (digit: string) => digit.repeat(64);
const TOKEN = `0x${"c".repeat(40)}`;

interface SeededDeal {
  dealId: string;
  buyerId: string;
  sellerId: string;
}

describePostgres("Phase 4 multichain PostgreSQL exit gate", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      ...databaseConfig,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: "each" });
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE TABLE "settlement_confirmations", "settlement_quotes",
        deals, users RESTART IDENTITY CASCADE
    `);
  });

  it("rejects update and deletion of authoritative quote evidence", async () => {
    const seeded = await seedDeal(dataSource);
    const quoteId = await insertQuote(dataSource, seeded.dealId);

    await expect(
      dataSource.query(
        `UPDATE settlement_quotes SET version = 2 WHERE id = $1`,
        [quoteId],
      ),
    ).rejects.toThrow("immutable settlement evidence cannot be changed");
    await expect(
      dataSource.query(`DELETE FROM settlement_quotes WHERE id = $1`, [
        quoteId,
      ]),
    ).rejects.toThrow("immutable settlement evidence cannot be changed");
  });

  it("detects a one-unit quote conservation error", async () => {
    const seeded = await seedDeal(dataSource);
    await expect(
      insertQuote(dataSource, seeded.dealId, {
        totalFundingAtomic: "105000001",
      }),
    ).rejects.toThrow(/CHK_settlement_quote_conservation/i);
  });

  it("rejects funding without an authoritative quote", async () => {
    const seeded = await seedDeal(dataSource);
    await expect(markFunded(dataSource, seeded.dealId)).rejects.toThrow(
      "authoritative settlement quote is required before funding",
    );
  });

  it("rejects funding when only the buyer confirmed", async () => {
    const seeded = await seedDeal(dataSource);
    const quoteId = await insertQuote(dataSource, seeded.dealId);
    await bindQuote(dataSource, seeded.dealId, quoteId);
    await insertConfirmation(dataSource, seeded, quoteId, "buyer");

    await expect(markFunded(dataSource, seeded.dealId)).rejects.toThrow(
      "both parties must confirm exact terms and quote before funding",
    );
  });

  it("permits funding only after both exact party confirmations", async () => {
    const seeded = await seedDeal(dataSource);
    const quoteId = await insertQuote(dataSource, seeded.dealId);
    await bindQuote(dataSource, seeded.dealId, quoteId);
    await insertConfirmation(dataSource, seeded, quoteId, "buyer");
    await insertConfirmation(dataSource, seeded, quoteId, "seller");

    await expect(markFunded(dataSource, seeded.dealId)).resolves.toEqual(
      undefined,
    );
  });

  it("rejects network, asset, terms, or quote changes after funding", async () => {
    const seeded = await seedDeal(dataSource);
    const quoteId = await insertQuote(dataSource, seeded.dealId);
    await bindQuote(dataSource, seeded.dealId, quoteId);
    await insertConfirmation(dataSource, seeded, quoteId, "buyer");
    await insertConfirmation(dataSource, seeded, quoteId, "seller");
    await markFunded(dataSource, seeded.dealId);

    for (const statement of [
      `UPDATE deals SET settlement_chain_id = '137' WHERE id = $1`,
      `UPDATE deals SET settlement_asset = 'ton_usdt' WHERE id = $1`,
      `UPDATE deals SET fee_model = 'seller_pays' WHERE id = $1`,
      `UPDATE deals SET terms_hash = '${HASH("9")}' WHERE id = $1`,
      `UPDATE deals SET settlement_quote_hash = '${HASH("8")}' WHERE id = $1`,
    ]) {
      await expect(
        dataSource.query(statement, [seeded.dealId]),
      ).rejects.toThrow("funded settlement identity is immutable");
    }
  });
});

async function seedDeal(dataSource: DataSource): Promise<SeededDeal> {
  const dealId = randomUUID();
  const buyerId = randomUUID();
  const sellerId = randomUUID();
  await dataSource.query(
    `INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)`,
    [buyerId, `${buyerId}@phase4.test`, sellerId, `${sellerId}@phase4.test`],
  );
  await dataSource.query(
    `INSERT INTO deals (
      id, deal_number, type, status, buyer_id, seller_id, amount, currency,
      description, settlement_network, settlement_chain_id, settlement_asset,
      asset_contract, settlement_mode, terms_version, terms_hash
    ) VALUES (
      $1, $2, 'digital', 'pending_payment', $3, $4, 100, 'USDT',
      'Phase 4 PostgreSQL gate', 'polygon', '80002', 'polygon_usdt',
      $5, 'native', 3, $6
    )`,
    [dealId, `P4-${dealId}`, buyerId, sellerId, TOKEN, HASH("a")],
  );
  return { dealId, buyerId, sellerId };
}

async function insertQuote(
  dataSource: DataSource,
  dealId: string,
  overrides: { totalFundingAtomic?: string } = {},
): Promise<string> {
  const quoteId = randomUUID();
  await dataSource.query(
    `INSERT INTO settlement_quotes (
      id, deal_id, domain_version, version, terms_version, terms_hash, fee_model,
      network, chain_id, asset, asset_contract, decimals,
      amount_atomic, buyer_fee_atomic, seller_fee_atomic,
      total_funding_atomic, seller_receives_atomic,
      quoted_at, expires_at, hash
    ) VALUES (
      $1, $2, 1, 1, 3, $3, 'buyer_pays',
      'polygon', '80002', 'polygon_usdt', $4, 6,
      '100000000', '5000000', '0', $5, '100000000',
      '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z', $6
    )`,
    [
      quoteId,
      dealId,
      HASH("a"),
      TOKEN,
      overrides.totalFundingAtomic ?? "105000000",
      HASH("b"),
    ],
  );
  return quoteId;
}

async function bindQuote(
  dataSource: DataSource,
  dealId: string,
  quoteId: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE deals SET settlement_quote_id = $2,
      settlement_quote_version = 1, settlement_quote_hash = $3
    WHERE id = $1`,
    [dealId, quoteId, HASH("b")],
  );
}

async function insertConfirmation(
  dataSource: DataSource,
  seeded: SeededDeal,
  quoteId: string,
  party: "buyer" | "seller",
): Promise<void> {
  await dataSource.query(
    `INSERT INTO settlement_confirmations (
      deal_id, quote_id, party, user_id, domain_version,
      terms_version, terms_hash, quote_version, quote_hash,
      network, chain_id, asset
    ) VALUES ($1, $2, $3, $4, 1, 3, $5, 1, $6, 'polygon', '80002', 'polygon_usdt')`,
    [
      seeded.dealId,
      quoteId,
      party,
      party === "buyer" ? seeded.buyerId : seeded.sellerId,
      HASH("a"),
      HASH("b"),
    ],
  );
}

async function markFunded(
  dataSource: DataSource,
  dealId: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE deals SET funded_at = now(), paid_at = now() WHERE id = $1`,
    [dealId],
  );
}
