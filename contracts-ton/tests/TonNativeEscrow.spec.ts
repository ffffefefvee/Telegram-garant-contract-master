import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { beginCell, Cell, toNano } from "@ton/core";
import { compile } from "@ton/blueprint";
import "@ton/test-utils";
import {
  TonNativeEscrow,
  TonNativeEscrowConfig,
  TON_NATIVE_ESCROW_STATUS,
  tonNativeEscrowConfigCell,
} from "../wrappers/TonNativeEscrow";

const ERROR_WRONG_STATE = 701;
const ERROR_UNAUTHORIZED = 702;
const ERROR_DEADLINE_PASSED = 703;
const ERROR_DEADLINE_NOT_REACHED = 704;
const ERROR_INSUFFICIENT_VALUE = 705;
const ERROR_INVALID_AWARD = 707;
const ERROR_INVALID_CONFIG = 700;
const OPERATION_VALUE = toNano("0.08");
const FUNDING_RESERVE = toNano("0.30");
const MAX_INBOUND_COMPUTE_FEE = toNano("0.05");
const MAX_COINS = (1n << 120n) - 1n;

describe("TonNativeEscrow", () => {
  let code: Cell;
  let blockchain: Blockchain;
  let buyer: SandboxContract<TreasuryContract>;
  let seller: SandboxContract<TreasuryContract>;
  let arbitrator: SandboxContract<TreasuryContract>;
  let treasury: SandboxContract<TreasuryContract>;
  let outsider: SandboxContract<TreasuryContract>;
  let escrow: SandboxContract<TonNativeEscrow>;
  let config: TonNativeEscrowConfig;
  let now: number;

  beforeAll(async () => {
    code = await compile("TonNativeEscrow");
  });

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    now = 2_000_000_000;
    blockchain.now = now;

    buyer = await blockchain.treasury("buyer");
    seller = await blockchain.treasury("seller");
    arbitrator = await blockchain.treasury("arbitrator");
    treasury = await blockchain.treasury("treasury");
    outsider = await blockchain.treasury("outsider");

    config = {
      dealId: 101n,
      buyer: buyer.address,
      seller: seller.address,
      arbitrator: arbitrator.address,
      treasury: treasury.address,
      termsHash: 0x1111n,
      quoteHash: 0x2222n,
      buyerTotal: toNano("10"),
      sellerPayout: toNano("9.8"),
      platformFee: toNano("0.2"),
      refundToBuyer: toNano("9.9"),
      refundFee: toNano("0.1"),
      fundingDeadline: BigInt(now + 100),
      deliveryDeadline: BigInt(now + 200),
      confirmationDeadline: BigInt(now + 300),
    };

    escrow = blockchain.openContract(
      TonNativeEscrow.createFromConfig(config, code),
    );
    const deploy = await escrow.sendDeploy(
      outsider.getSender(),
      toNano("0.30"),
    );

    expect(deploy.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      deploy: true,
      success: true,
    });
    expect(await escrow.getStatus()).toBe(
      TON_NATIVE_ESCROW_STATUS.AWAITING_FUNDING,
    );
    expect(await escrow.getConfigHash()).toBe(
      BigInt(`0x${tonNativeEscrowConfigCell(config).hash().toString("hex")}`),
    );
  });

  async function fund(queryId = 1n) {
    return escrow.sendFund(buyer.getSender(), {
      queryId,
      value: config.buyerTotal + FUNDING_RESERVE,
    });
  }

  async function deployAdditional(
    overrides: Partial<TonNativeEscrowConfig>,
    deployerName: string,
  ) {
    const additionalConfig = { ...config, ...overrides };
    const additional = blockchain.openContract(
      TonNativeEscrow.createFromConfig(additionalConfig, code),
    );
    const deployer = await blockchain.treasury(deployerName);
    const result = await additional.sendDeploy(
      deployer.getSender(),
      toNano("0.30"),
    );
    expect(result.transactions).toHaveTransaction({
      from: deployer.address,
      to: additional.address,
      deploy: true,
      success: true,
    });
    return { escrow: additional, config: additionalConfig };
  }

  it("funds, records delivery, and releases exact configured payouts", async () => {
    const funding = await fund();
    expect(funding.transactions).toHaveTransaction({
      from: buyer.address,
      to: escrow.address,
      success: true,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.FUNDED);
    expect(await escrow.getFundedAmount()).toBe(config.buyerTotal);

    const delivered = await escrow.sendMarkDelivered(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });
    expect(delivered.transactions).toHaveTransaction({
      from: seller.address,
      to: escrow.address,
      success: true,
    });

    const release = await escrow.sendRelease(buyer.getSender(), {
      queryId: 3n,
      value: OPERATION_VALUE,
    });
    expect(release.transactions).toHaveTransaction({
      from: escrow.address,
      to: seller.address,
      value: config.sellerPayout,
      success: true,
    });
    expect(release.transactions).toHaveTransaction({
      from: escrow.address,
      to: treasury.address,
      value: config.platformFee,
      success: true,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.RELEASED);
    expect(config.sellerPayout + config.platformFee).toBe(config.buyerTotal);
  });

  it("rejects unauthorized funding without changing state", async () => {
    const result = await escrow.sendFund(outsider.getSender(), {
      queryId: 1n,
      value: config.buyerTotal + FUNDING_RESERVE,
    });

    expect(result.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_UNAUTHORIZED,
    });
    expect(await escrow.getStatus()).toBe(
      TON_NATIVE_ESCROW_STATUS.AWAITING_FUNDING,
    );
    expect(await escrow.getLastQueryId()).toBe(0n);
  });

  it("rejects malformed immutable economics at deployment and on direct activation", async () => {
    const malformed = blockchain.openContract(
      TonNativeEscrow.createFromConfig(
        { ...config, sellerPayout: config.sellerPayout - 1n },
        code,
      ),
    );
    const deploy = await malformed.sendDeploy(
      outsider.getSender(),
      toNano("0.30"),
    );
    expect(deploy.transactions).toHaveTransaction({
      from: outsider.address,
      to: malformed.address,
      success: false,
      exitCode: ERROR_INVALID_CONFIG,
    });

    const directFund = await malformed.sendFund(buyer.getSender(), {
      queryId: 1n,
      value: config.buyerTotal + FUNDING_RESERVE,
    });
    expect(directFund.transactions).toHaveTransaction({
      from: buyer.address,
      to: malformed.address,
      success: false,
      exitCode: ERROR_INVALID_CONFIG,
    });
  });

  it("accepts the largest encodable coin configuration and rejects overflow", async () => {
    const maximum = TonNativeEscrow.createFromConfig(
      {
        ...config,
        dealId: 104n,
        buyerTotal: MAX_COINS,
        sellerPayout: MAX_COINS - 1n,
        platformFee: 1n,
        refundToBuyer: MAX_COINS - 1n,
        refundFee: 1n,
      },
      code,
    );
    const maximumEscrow = blockchain.openContract(maximum);
    const deploy = await maximumEscrow.sendDeploy(
      outsider.getSender(),
      toNano("0.30"),
    );
    expect(deploy.transactions).toHaveTransaction({
      from: outsider.address,
      to: maximumEscrow.address,
      deploy: true,
      success: true,
    });

    expect(() =>
      TonNativeEscrow.createFromConfig(
        {
          ...config,
          dealId: 105n,
          buyerTotal: MAX_COINS + 1n,
          sellerPayout: MAX_COINS,
          platformFee: 1n,
          refundToBuyer: MAX_COINS,
          refundFee: 1n,
        },
        code,
      ),
    ).toThrow();
  });

  it("returns funding value above the exact principal and required reserve", async () => {
    const excess = toNano("0.7");
    const funding = await escrow.sendFund(buyer.getSender(), {
      queryId: 1n,
      value: config.buyerTotal + toNano("0.2") + excess,
    });

    expect(funding.transactions).toHaveTransaction({
      from: escrow.address,
      to: buyer.address,
      value: excess,
      success: true,
    });
    expect(await escrow.getFundedAmount()).toBe(config.buyerTotal);
  });

  it("accepts the exact reserve boundary and rejects one nanoton less", async () => {
    const exact = await escrow.sendFund(buyer.getSender(), {
      queryId: 1n,
      value: config.buyerTotal + toNano("0.2"),
    });
    expect(exact.transactions).toHaveTransaction({
      from: buyer.address,
      to: escrow.address,
      success: true,
    });

    const additional = await deployAdditional(
      { dealId: 102n },
      "reserve-deployer",
    );
    const insufficient = await additional.escrow.sendFund(buyer.getSender(), {
      queryId: 1n,
      value: additional.config.buyerTotal + toNano("0.2") - 1n,
    });
    expect(insufficient.transactions).toHaveTransaction({
      from: buyer.address,
      to: additional.escrow.address,
      success: false,
      exitCode: ERROR_INSUFFICIENT_VALUE,
    });
    expect(await additional.escrow.getStatus()).toBe(
      TON_NATIVE_ESCROW_STATUS.AWAITING_FUNDING,
    );
  });

  it("accepts deadline equality and rejects the next second", async () => {
    blockchain.now = Number(config.fundingDeadline);
    const atBoundary = await fund();
    expect(atBoundary.transactions).toHaveTransaction({
      from: buyer.address,
      to: escrow.address,
      success: true,
    });

    const additional = await deployAdditional(
      { dealId: 103n },
      "deadline-deployer",
    );
    blockchain.now = Number(additional.config.fundingDeadline) + 1;
    const tooLate = await additional.escrow.sendFund(buyer.getSender(), {
      queryId: 1n,
      value: additional.config.buyerTotal + FUNDING_RESERVE,
    });
    expect(tooLate.transactions).toHaveTransaction({
      from: buyer.address,
      to: additional.escrow.address,
      success: false,
      exitCode: ERROR_DEADLINE_PASSED,
    });
  });

  it("uses the acyclic state machine for replay protection without cross-party query locks", async () => {
    await fund(10n);
    const replay = await escrow.sendFund(buyer.getSender(), {
      queryId: 10n,
      value: config.buyerTotal + FUNDING_RESERVE,
    });

    expect(replay.transactions).toHaveTransaction({
      from: buyer.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_WRONG_STATE,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.FUNDED);
    expect(await escrow.getLastQueryId()).toBe(10n);

    const delivered = await escrow.sendMarkDelivered(seller.getSender(), {
      queryId: 1n,
      value: OPERATION_VALUE,
    });
    expect(delivered.transactions).toHaveTransaction({
      from: seller.address,
      to: escrow.address,
      success: true,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.DELIVERED);
  });

  it("allows either party to dispute and only the arbitrator to conserve awards", async () => {
    await fund();
    await escrow.sendOpenDispute(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.DISPUTED);

    const unauthorized = await escrow.sendResolve(outsider.getSender(), {
      queryId: 3n,
      buyerAward: toNano("4"),
      sellerAward: toNano("5.8"),
      value: OPERATION_VALUE,
    });
    expect(unauthorized.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_UNAUTHORIZED,
    });

    const invalid = await escrow.sendResolve(arbitrator.getSender(), {
      queryId: 3n,
      buyerAward: toNano("4"),
      sellerAward: toNano("5.7"),
      value: OPERATION_VALUE,
    });
    expect(invalid.transactions).toHaveTransaction({
      from: arbitrator.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_INVALID_AWARD,
    });

    const buyerAward = toNano("4");
    const sellerAward = toNano("5.8");
    const resolved = await escrow.sendResolve(arbitrator.getSender(), {
      queryId: 3n,
      buyerAward,
      sellerAward,
      value: OPERATION_VALUE,
    });
    expect(resolved.transactions).toHaveTransaction({
      from: escrow.address,
      to: buyer.address,
      value: buyerAward,
      success: true,
    });
    expect(resolved.transactions).toHaveTransaction({
      from: escrow.address,
      to: seller.address,
      value: sellerAward,
      success: true,
    });
    expect(resolved.transactions).toHaveTransaction({
      from: escrow.address,
      to: treasury.address,
      value: config.platformFee,
      success: true,
    });
    expect(buyerAward + sellerAward + config.platformFee).toBe(
      config.buyerTotal,
    );
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.RESOLVED);
  });

  it("conserves every sampled award partition across the complete distributable range", async () => {
    const distributable = config.buyerTotal - config.platformFee;
    const samples = [0n, 1n, 7n, 25n, 50n, 73n, 99n, 100n];

    for (const sample of samples) {
      const { escrow: sampledEscrow, config: sampledConfig } =
        await deployAdditional(
          { dealId: 10_000n + sample },
          `award-property-${sample}`,
        );
      await sampledEscrow.sendFund(buyer.getSender(), {
        queryId: 1n,
        value: sampledConfig.buyerTotal + FUNDING_RESERVE,
      });
      await sampledEscrow.sendOpenDispute(buyer.getSender(), {
        queryId: 2n,
        value: OPERATION_VALUE,
      });
      const buyerAward = (distributable * sample) / 100n;
      const sellerAward = distributable - buyerAward;
      const result = await sampledEscrow.sendResolve(arbitrator.getSender(), {
        queryId: 3n,
        buyerAward,
        sellerAward,
        value: OPERATION_VALUE,
      });

      expect(buyerAward + sellerAward + sampledConfig.platformFee).toBe(
        sampledConfig.buyerTotal,
      );
      if (buyerAward > 0n) {
        expect(result.transactions).toHaveTransaction({
          from: sampledEscrow.address,
          to: buyer.address,
          value: buyerAward,
          success: true,
        });
      }
      if (sellerAward > 0n) {
        expect(result.transactions).toHaveTransaction({
          from: sampledEscrow.address,
          to: seller.address,
          value: sellerAward,
          success: true,
        });
      }
      expect(result.transactions).toHaveTransaction({
        from: sampledEscrow.address,
        to: treasury.address,
        value: sampledConfig.platformFee,
        success: true,
      });
      expect(await sampledEscrow.getStatus()).toBe(
        TON_NATIVE_ESCROW_STATUS.RESOLVED,
      );
    }
  });

  it("keeps funding and participant transitions below explicit compute-fee ceilings", async () => {
    const funding = await fund();
    const delivery = await escrow.sendMarkDelivered(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });
    const release = await escrow.sendRelease(buyer.getSender(), {
      queryId: 3n,
      value: OPERATION_VALUE,
    });

    for (const result of [funding, delivery, release]) {
      const accountTransaction = result.transactions.find(
        (transaction) =>
          transaction.inMessage?.info.type === "internal" &&
          transaction.inMessage.info.dest.equals(escrow.address),
      );
      expect(accountTransaction).toBeDefined();
      expect(accountTransaction!.totalFees.coins).toBeLessThanOrEqual(
        MAX_INBOUND_COMPUTE_FEE,
      );
    }
  });

  it("rolls back terminal state when outbound payouts cannot be funded", async () => {
    await fund();
    await escrow.sendMarkDelivered(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });
    const contractAccount = await blockchain.getContract(escrow.address);
    contractAccount.balance = 1n;

    const release = await escrow.sendRelease(buyer.getSender(), {
      queryId: 3n,
      value: OPERATION_VALUE,
    });
    expect(release.transactions).toHaveTransaction({
      from: buyer.address,
      to: escrow.address,
      success: false,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.DELIVERED);
    expect(await escrow.getLastQueryId()).toBe(2n);
  });

  it("rejects a dispute opened by a non-party", async () => {
    await fund();
    const result = await escrow.sendOpenDispute(outsider.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });
    expect(result.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_UNAUTHORIZED,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.FUNDED);
  });

  it("allows a permissionless buyer refund only after seller timeout", async () => {
    await fund();
    const early = await escrow.sendRefundAfterSellerTimeout(
      outsider.getSender(),
      {
        queryId: 2n,
        value: OPERATION_VALUE,
      },
    );
    expect(early.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_DEADLINE_NOT_REACHED,
    });

    blockchain.now = Number(config.deliveryDeadline) + 1;
    const refunded = await escrow.sendRefundAfterSellerTimeout(
      outsider.getSender(),
      {
        queryId: 2n,
        value: OPERATION_VALUE,
      },
    );
    expect(refunded.transactions).toHaveTransaction({
      from: escrow.address,
      to: buyer.address,
      value: config.refundToBuyer,
      success: true,
    });
    expect(refunded.transactions).toHaveTransaction({
      from: escrow.address,
      to: treasury.address,
      value: config.refundFee,
      success: true,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.REFUNDED);
  });

  it("does not let a party block a matured seller timeout by opening a late dispute", async () => {
    await fund();
    blockchain.now = Number(config.deliveryDeadline) + 1;

    const lateDispute = await escrow.sendOpenDispute(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });
    expect(lateDispute.transactions).toHaveTransaction({
      from: seller.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_DEADLINE_PASSED,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.FUNDED);
  });

  it("does not let a party block a matured buyer timeout by opening a late dispute", async () => {
    await fund();
    await escrow.sendMarkDelivered(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });
    blockchain.now = Number(config.confirmationDeadline) + 1;

    const lateDispute = await escrow.sendOpenDispute(buyer.getSender(), {
      queryId: 3n,
      value: OPERATION_VALUE,
    });
    expect(lateDispute.transactions).toHaveTransaction({
      from: buyer.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_DEADLINE_PASSED,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.DELIVERED);
  });

  it("allows permissionless seller release only after buyer timeout", async () => {
    await fund();
    await escrow.sendMarkDelivered(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });

    const early = await escrow.sendReleaseAfterBuyerTimeout(
      outsider.getSender(),
      {
        queryId: 3n,
        value: OPERATION_VALUE,
      },
    );
    expect(early.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_DEADLINE_NOT_REACHED,
    });

    blockchain.now = Number(config.confirmationDeadline) + 1;
    const released = await escrow.sendReleaseAfterBuyerTimeout(
      outsider.getSender(),
      {
        queryId: 3n,
        value: OPERATION_VALUE,
      },
    );
    expect(released.transactions).toHaveTransaction({
      from: escrow.address,
      to: seller.address,
      value: config.sellerPayout,
      success: true,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.RELEASED);
  });

  it("blocks terminal-state replay even with a fresh query ID", async () => {
    await fund();
    await escrow.sendRefundBuyer(seller.getSender(), {
      queryId: 2n,
      value: OPERATION_VALUE,
    });

    const repeat = await escrow.sendRefundBuyer(seller.getSender(), {
      queryId: 3n,
      value: OPERATION_VALUE,
    });
    expect(repeat.transactions).toHaveTransaction({
      from: seller.address,
      to: escrow.address,
      success: false,
      exitCode: ERROR_WRONG_STATE,
    });
    expect(await escrow.getStatus()).toBe(TON_NATIVE_ESCROW_STATUS.REFUNDED);
  });

  it("rejects unknown and truncated message bodies without mutating storage", async () => {
    const unknown = await escrow.sendRaw(
      outsider.getSender(),
      OPERATION_VALUE,
      beginCell().storeUint(0x11223344, 32).storeUint(0, 64).endCell(),
    );
    expect(unknown.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      success: false,
    });

    const truncated = await escrow.sendRaw(
      outsider.getSender(),
      OPERATION_VALUE,
      beginCell().storeUint(0x66756e64, 32).endCell(),
    );
    expect(truncated.transactions).toHaveTransaction({
      from: outsider.address,
      to: escrow.address,
      success: false,
    });
    expect(await escrow.getStatus()).toBe(
      TON_NATIVE_ESCROW_STATUS.AWAITING_FUNDING,
    );
    expect(await escrow.getLastQueryId()).toBe(0n);
  });

  it("derives the same address from identical terms and a different address from any changed commitment", () => {
    const same = TonNativeEscrow.createFromConfig(config, code);
    const changedTerms = TonNativeEscrow.createFromConfig(
      { ...config, termsHash: config.termsHash + 1n },
      code,
    );
    const changedQuote = TonNativeEscrow.createFromConfig(
      { ...config, quoteHash: config.quoteHash + 1n },
      code,
    );

    expect(same.address.equals(escrow.address)).toBe(true);
    expect(changedTerms.address.equals(escrow.address)).toBe(false);
    expect(changedQuote.address.equals(escrow.address)).toBe(false);
  });
});
