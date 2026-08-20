import { compile } from "@ton/blueprint";
import { Address, beginCell, Cell, toNano } from "@ton/core";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import "@ton/test-utils";
import {
  TonJettonEscrow,
  TonJettonEscrowConfig,
  TON_JETTON_ESCROW_OP,
  TON_JETTON_ESCROW_STATUS,
  tonJettonEscrowConfigCell,
  tonJettonEscrowDataCell,
  tonJettonSealCanonicalWalletBody,
  tonJettonTransferNotificationBody,
  validateTonJettonEscrowConfig,
} from "../wrappers/TonJettonEscrow";

const GOLDEN_HASHES = {
  config: "3866a81cbccb7e97ea184c94b7a8b7c25ce70398adfba905d80c75e1989a0d53",
  data: "5b3a2d86ab124e31842cb698e3f4a1191ad608b2549902ccef97b8d3470a63d0",
  seal: "ac25e6ec0b5588052684bdf2faa5148da6782880c3e0ef4e3be9bdde37e03026",
  notificationInline:
    "33b3dcdaa4882797d3abb911a0460a321802cc7c2d1e3db83a971329b02742cd",
  notificationReference:
    "28130fdc57db1c846c92170ae592b6434ba4c32c892ce5eb56d61c94acf1aa88",
} as const;

function fixedAddress(byte: number): Address {
  return new Address(0, Buffer.alloc(32, byte));
}

function goldenPayload(): Cell {
  return beginCell()
    .storeUint(0x54474152, 32)
    .storeUint(0x1234n, 256)
    .endCell();
}

function goldenConfig(): TonJettonEscrowConfig {
  const payload = goldenPayload();
  return {
    dealId: 0x1234n,
    termsHash: 0x11112222n,
    quoteHash: 0x33334444n,
    fundingDeadline: 2_100_000_100n,
    expectedQueryId: 9_001n,
    forwardPayloadHash: BigInt(`0x${payload.hash().toString("hex")}`),
    buyer: fixedAddress(1),
    seller: fixedAddress(2),
    arbitrator: fixedAddress(3),
    treasury: fixedAddress(4),
    initializer: fixedAddress(5),
    reconciliation: fixedAddress(6),
    master: fixedAddress(7),
    walletCodeHash: 0xabcde12345n,
    buyerTotal: 5_000_000_000n,
    sellerPayout: 4_900_000_000n,
    platformFee: 100_000_000n,
    refundToBuyer: 4_950_000_000n,
    refundFee: 50_000_000n,
  };
}

function expectSliceEnd(slice: ReturnType<Cell["beginParse"]>): void {
  expect(slice.remainingBits).toBe(0);
  expect(slice.remainingRefs).toBe(0);
}

describe("TonJettonEscrow v0.2 TypeScript ABI", () => {
  it("locks cross-checkable golden hashes for StateInit data and both accepted messages", () => {
    const config = goldenConfig();
    const payload = goldenPayload();
    const seal = {
      queryId: 1n,
      wallet: fixedAddress(8),
      walletCodeHash: config.walletCodeHash,
      verificationEvidenceHash: 0x987654321n,
    };
    const notification = {
      queryId: config.expectedQueryId,
      amount: config.buyerTotal,
      sender: config.buyer,
      forwardPayload: payload,
    };

    expect(tonJettonEscrowConfigCell(config).hash().toString("hex")).toBe(
      GOLDEN_HASHES.config,
    );
    expect(tonJettonEscrowDataCell(config).hash().toString("hex")).toBe(
      GOLDEN_HASHES.data,
    );
    expect(
      tonJettonSealCanonicalWalletBody(seal, config).hash().toString("hex"),
    ).toBe(GOLDEN_HASHES.seal);
    expect(
      tonJettonTransferNotificationBody(notification, config)
        .hash()
        .toString("hex"),
    ).toBe(GOLDEN_HASHES.notificationInline);
    expect(
      tonJettonTransferNotificationBody(
        { ...notification, forwardPayloadByReference: true },
        config,
      )
        .hash()
        .toString("hex"),
    ).toBe(GOLDEN_HASHES.notificationReference);
  });

  it("round-trips the exact nested Tolk StateInit storage layout without a wallet address", () => {
    const config = goldenConfig();
    const data = tonJettonEscrowDataCell(config).beginParse();
    expect(data.loadUint(8)).toBe(TON_JETTON_ESCROW_STATUS.AWAITING_FUNDING);
    expect(data.loadUint(8)).toBe(0);
    expect(data.loadCoins()).toBe(0n);
    expect(data.loadUintBig(64)).toBe(0n);
    const configCell = data.loadRef();
    expect(data.loadRef().equals(beginCell().endCell())).toBe(true);
    expectSliceEnd(data);

    const outer = configCell.beginParse();
    expect(outer.loadUintBig(256)).toBe(config.dealId);
    expect(outer.loadUintBig(256)).toBe(config.termsHash);
    expect(outer.loadUintBig(256)).toBe(config.quoteHash);
    expect(outer.loadUintBig(64)).toBe(config.fundingDeadline);
    const commitment = outer.loadRef().beginParse();
    expectSliceEnd(outer);

    expect(commitment.loadUintBig(64)).toBe(config.expectedQueryId);
    expect(commitment.loadUintBig(256)).toBe(config.forwardPayloadHash);
    const roles = commitment.loadRef().beginParse();
    const authorities = commitment.loadRef().beginParse();
    const asset = commitment.loadRef().beginParse();
    const economics = commitment.loadRef().beginParse();
    expectSliceEnd(commitment);

    expect(roles.loadAddress().equals(config.buyer)).toBe(true);
    expect(roles.loadAddress().equals(config.seller)).toBe(true);
    const rolesTail = roles.loadRef().beginParse();
    expectSliceEnd(roles);
    expect(rolesTail.loadAddress().equals(config.arbitrator)).toBe(true);
    expect(rolesTail.loadAddress().equals(config.treasury)).toBe(true);
    expectSliceEnd(rolesTail);

    expect(authorities.loadAddress().equals(config.initializer)).toBe(true);
    expect(authorities.loadAddress().equals(config.reconciliation)).toBe(true);
    expectSliceEnd(authorities);
    expect(asset.loadAddress().equals(config.master)).toBe(true);
    expect(asset.loadUintBig(256)).toBe(config.walletCodeHash);
    expectSliceEnd(asset);
    expect(economics.loadCoins()).toBe(config.buyerTotal);
    expect(economics.loadCoins()).toBe(config.sellerPayout);
    expect(economics.loadCoins()).toBe(config.platformFee);
    expect(economics.loadCoins()).toBe(config.refundToBuyer);
    expect(economics.loadCoins()).toBe(config.refundFee);
    expectSliceEnd(economics);
  });

  it("round-trips the seal and TEP-74 notification message layouts", () => {
    const config = goldenConfig();
    const wallet = fixedAddress(8);
    const seal = tonJettonSealCanonicalWalletBody(
      {
        queryId: 1n,
        wallet,
        walletCodeHash: config.walletCodeHash,
        verificationEvidenceHash: 0x987654321n,
      },
      config,
    ).beginParse();
    expect(seal.loadUint(32)).toBe(
      TON_JETTON_ESCROW_OP.SEAL_CANONICAL_JETTON_WALLET,
    );
    expect(seal.loadUintBig(64)).toBe(1n);
    expect(seal.loadAddress().equals(wallet)).toBe(true);
    expect(seal.loadUintBig(256)).toBe(config.walletCodeHash);
    expect(seal.loadUintBig(256)).toBe(0x987654321n);
    expectSliceEnd(seal);

    for (const byReference of [false, true]) {
      const body = tonJettonTransferNotificationBody(
        {
          queryId: config.expectedQueryId,
          amount: config.buyerTotal,
          sender: config.buyer,
          forwardPayload: goldenPayload(),
          forwardPayloadByReference: byReference,
        },
        config,
      ).beginParse();
      expect(body.loadUint(32)).toBe(
        TON_JETTON_ESCROW_OP.TRANSFER_NOTIFICATION,
      );
      expect(body.loadUintBig(64)).toBe(config.expectedQueryId);
      expect(body.loadCoins()).toBe(config.buyerTotal);
      expect(body.loadAddress().equals(config.buyer)).toBe(true);
      expect(body.loadBit()).toBe(byReference);
      const decodedPayload = byReference
        ? body.loadRef()
        : beginCell().storeSlice(body.clone()).endCell();
      if (!byReference) {
        body.skip(body.remainingBits);
        while (body.remainingRefs > 0) {
          body.loadRef();
        }
      }
      expect(decodedPayload.equals(goldenPayload())).toBe(true);
      expectSliceEnd(body);
    }
  });

  it("derives StateInit addresses without any precommitted escrow-wallet input", () => {
    const code = beginCell().storeUint(0xc0de, 16).endCell();
    const config = goldenConfig();
    const first = TonJettonEscrow.createFromConfig(config, code);
    const repeated = TonJettonEscrow.createFromConfig({ ...config }, code);
    const differentMaster = TonJettonEscrow.createFromConfig(
      { ...config, master: fixedAddress(9) },
      code,
    );

    expect(first.address.equals(repeated.address)).toBe(true);
    expect(first.address.equals(differentMaster.address)).toBe(false);
  });

  it("fails closed on unusable query ordering, value ranges, conservation, aliases, and seal drift", () => {
    const config = goldenConfig();
    expect(() =>
      validateTonJettonEscrowConfig({ ...config, expectedQueryId: 1n }),
    ).toThrow("at least 2");
    expect(() =>
      validateTonJettonEscrowConfig({ ...config, dealId: 1n << 256n }),
    ).toThrow("dealId");
    expect(() =>
      validateTonJettonEscrowConfig({ ...config, buyerTotal: 0n }),
    ).toThrow("buyerTotal");
    expect(() =>
      validateTonJettonEscrowConfig({
        ...config,
        platformFee: config.platformFee + 1n,
      }),
    ).toThrow("sellerPayout + platformFee");
    expect(() =>
      validateTonJettonEscrowConfig({ ...config, seller: config.buyer }),
    ).toThrow("buyer and seller");
    expect(() =>
      tonJettonSealCanonicalWalletBody(
        {
          queryId: config.expectedQueryId,
          wallet: fixedAddress(8),
          walletCodeHash: config.walletCodeHash,
          verificationEvidenceHash: 1n,
        },
        config,
      ),
    ).toThrow("must precede");
    expect(() =>
      tonJettonSealCanonicalWalletBody(
        {
          queryId: 1n,
          wallet: fixedAddress(8),
          walletCodeHash: config.walletCodeHash + 1n,
          verificationEvidenceHash: 1n,
        },
        config,
      ),
    ).toThrow("pinned walletCodeHash");
    expect(() =>
      tonJettonSealCanonicalWalletBody(
        {
          queryId: 1n,
          wallet: config.master,
          walletCodeHash: config.walletCodeHash,
          verificationEvidenceHash: 1n,
        },
        config,
      ),
    ).toThrow("sealed wallet and master");
  });
});

describe("TonJettonEscrow wrapper against the compiled Tolk contract", () => {
  let code: Cell;

  beforeAll(async () => {
    code = await compile("TonJettonEscrow");
  });

  it("deploys, seals once, and authenticates a reference-form transfer notification", async () => {
    const blockchain = await Blockchain.create();
    blockchain.now = 2_100_000_000;
    const actors: Record<string, SandboxContract<TreasuryContract>> = {};
    for (const name of [
      "buyer",
      "seller",
      "arbitrator",
      "treasury",
      "initializer",
      "reconciliation",
      "master",
      "wallet",
      "deployer",
    ]) {
      actors[name] = await blockchain.treasury(`wrapper-${name}`);
    }
    const payload = beginCell()
      .storeUint(0x54474152, 32)
      .storeUint(501n, 256)
      .endCell();
    const config: TonJettonEscrowConfig = {
      ...goldenConfig(),
      dealId: 501n,
      fundingDeadline: 2_100_000_100n,
      forwardPayloadHash: BigInt(`0x${payload.hash().toString("hex")}`),
      buyer: actors.buyer.address,
      seller: actors.seller.address,
      arbitrator: actors.arbitrator.address,
      treasury: actors.treasury.address,
      initializer: actors.initializer.address,
      reconciliation: actors.reconciliation.address,
      master: actors.master.address,
    };
    const escrow = blockchain.openContract(
      TonJettonEscrow.createFromConfig(config, code),
    );

    const deployment = await escrow.sendDeploy(
      actors.deployer.getSender(),
      toNano("0.3"),
    );
    expect(deployment.transactions).toHaveTransaction({
      to: escrow.address,
      deploy: true,
      success: true,
    });
    expect(await escrow.getConfigHash()).toBe(
      BigInt(`0x${tonJettonEscrowConfigCell(config).hash().toString("hex")}`),
    );
    expect(await escrow.getWalletSealed()).toBe(0);

    const seal = await escrow.sendSealCanonicalWallet(
      actors.initializer.getSender(),
      {
        value: toNano("0.08"),
        queryId: 1n,
        wallet: actors.wallet.address,
        walletCodeHash: config.walletCodeHash,
        verificationEvidenceHash: 0x987654321n,
      },
    );
    expect(seal.transactions).toHaveTransaction({
      from: actors.initializer.address,
      to: escrow.address,
      success: true,
    });
    expect(await escrow.getWalletSealed()).toBe(1);
    expect(await escrow.getLastQueryId()).toBe(1n);

    const funding = await escrow.sendTransferNotification(
      actors.wallet.getSender(),
      {
        value: toNano("0.08"),
        queryId: config.expectedQueryId,
        amount: config.buyerTotal,
        sender: config.buyer,
        forwardPayload: payload,
        forwardPayloadByReference: true,
      },
    );
    expect(funding.transactions).toHaveTransaction({
      from: actors.wallet.address,
      to: escrow.address,
      success: true,
    });
    expect(await escrow.getStatus()).toBe(TON_JETTON_ESCROW_STATUS.FUNDED);
    expect(await escrow.getFundedAmount()).toBe(config.buyerTotal);
    expect(await escrow.getLastQueryId()).toBe(config.expectedQueryId);
  });
});
