import { beginCell, Cell, contractAddress, loadStateInit } from "@ton/ton";
import { TonEscrowAdapter } from "./ton-escrow.adapter";
import {
  TON_NATIVE_ESCROW_FUND_OPCODE,
  TonNativeEscrowComposer,
  TonNativeEscrowCompositionInput,
} from "./ton-native-escrow-composer";

function address(seed: number): string {
  return contractAddress(0, {
    code: beginCell().storeUint(seed, 16).endCell(),
    data: beginCell()
      .storeUint(seed + 1, 16)
      .endCell(),
  }).toRawString();
}

describe("TonNativeEscrowComposer", () => {
  const code = beginCell().storeUint(0xabcdef, 24).endCell();
  const adapter = {
    nativeArtifact: {
      verified: true,
      reason: "verified",
      codeHash: code.hash().toString("hex"),
      bocHex: code.toBoc().toString("hex"),
      minOperationalReserveNano: "200000000",
    },
  } as TonEscrowAdapter;
  const composer = new TonNativeEscrowComposer(adapter);
  const input: TonNativeEscrowCompositionInput = {
    dealId: 1n,
    buyer: address(1),
    seller: address(2),
    arbitrator: address(3),
    treasury: address(4),
    termsHash: 0x11n,
    quoteHash: 0x22n,
    buyerTotal: 10_000_000_000n,
    sellerPayout: 9_500_000_000n,
    platformFee: 500_000_000n,
    refundToBuyer: 10_000_000_000n,
    refundFee: 0n,
    fundingDeadline: 1_700_000_100n,
    deliveryDeadline: 1_700_100_000n,
    confirmationDeadline: 1_700_200_000n,
    queryId: 7n,
  };

  it("builds deterministic deploy-and-fund cells from exact atomic values", () => {
    const first = composer.compose(input);
    const second = composer.compose(input);

    expect(second).toEqual(first);
    expect(first.fundingAmount).toBe(10_200_000_000n);
    expect(first.operationalReserve).toBe(200_000_000n);
    expect(first.codeHash).toBe(code.hash().toString("hex"));

    const stateInit = loadStateInit(
      Cell.fromBase64(first.stateInit).beginParse(),
    );
    expect(stateInit.code?.equals(code)).toBe(true);
    expect(contractAddress(0, stateInit).toRawString()).toBe(
      first.escrowAddress,
    );

    const body = Cell.fromBase64(first.payload).beginParse();
    expect(body.loadUint(32)).toBe(TON_NATIVE_ESCROW_FUND_OPCODE);
    expect(body.loadUintBig(64)).toBe(input.queryId);
    expect(body.remainingBits).toBe(0);
  });

  it("matches the independent contracts-ton wrapper golden vector", () => {
    const golden = composer.compose({
      ...input,
      buyer: `0:${"11".repeat(32)}`,
      seller: `0:${"22".repeat(32)}`,
      arbitrator: `0:${"33".repeat(32)}`,
      treasury: `0:${"44".repeat(32)}`,
    });
    expect(golden.escrowAddress).toBe(
      "0:a6c71c0fef75e563b207b30b4f70096dd12c57611a260e1413a57ff0b8c1a076",
    );
    expect(golden.configHash).toBe(
      "3c441a7fb817e7798641cb4f35e67bc5511c044b374e25920744c9eaf67f85c5",
    );
  });

  it("changes the escrow address when a committed term changes", () => {
    expect(
      composer.compose({ ...input, termsHash: input.termsHash + 1n })
        .escrowAddress,
    ).not.toBe(composer.compose(input).escrowAddress);
  });

  it("rejects non-conserving economics before producing a request", () => {
    expect(() =>
      composer.compose({ ...input, platformFee: input.platformFee - 1n }),
    ).toThrow(/do not conserve/);
  });

  it("rejects unordered deadlines and overlapping critical roles", () => {
    expect(() =>
      composer.compose({
        ...input,
        deliveryDeadline: input.fundingDeadline,
      }),
    ).toThrow(/deadlines/);
    expect(() => composer.compose({ ...input, seller: input.buyer })).toThrow(
      /role addresses/,
    );
  });

  it("fails closed without an approved code artifact", () => {
    const unavailable = new TonNativeEscrowComposer({
      nativeArtifact: { verified: false, reason: "not_approved" },
    } as TonEscrowAdapter);
    expect(() => unavailable.compose(input)).toThrow(/not verified/);
  });
});
