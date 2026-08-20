import { beginCell, contractAddress, storeStateInit } from "@ton/ton";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { buildTonConnectTransactionRequest } from "./ton-connect-transaction";

describe("buildTonConnectTransactionRequest", () => {
  const stateInit = {
    code: beginCell().storeUint(1, 1).endCell(),
    data: beginCell().storeUint(2, 2).endCell(),
  };
  const address = contractAddress(0, stateInit).toRawString();
  const stateInitBoc = beginCell()
    .store(storeStateInit(stateInit))
    .endCell()
    .toBoc()
    .toString("base64");
  const payload = beginCell()
    .storeUint(0x1234, 32)
    .endCell()
    .toBoc()
    .toString("base64");

  it("builds a deterministic sender- and network-bound wire request", () => {
    expect(
      buildTonConnectTransactionRequest({
        network: TonNetwork.TESTNET,
        from: address,
        nowSeconds: 1_700_000_000,
        ttlSeconds: 300,
        messages: [
          {
            address,
            amount: 1_250_000_000n,
            payload,
            stateInit: stateInitBoc,
          },
        ],
      }),
    ).toEqual({
      validUntil: 1_700_000_300,
      network: TonNetwork.TESTNET,
      from: address,
      messages: [
        {
          address,
          amount: "1250000000",
          payload,
          stateInit: stateInitBoc,
        },
      ],
    });
  });

  it("rejects zero-value messages", () => {
    expect(() =>
      buildTonConnectTransactionRequest({
        network: TonNetwork.MAINNET,
        from: address,
        nowSeconds: 1,
        messages: [{ address, amount: 0n }],
      }),
    ).toThrow(/amount must be positive/);
  });

  it("rejects malformed payload BoCs before they reach a wallet", () => {
    expect(() =>
      buildTonConnectTransactionRequest({
        network: TonNetwork.MAINNET,
        from: address,
        nowSeconds: 1,
        messages: [{ address, amount: 1n, payload: "bm90LWEtYm9j" }],
      }),
    ).toThrow(/invalid BoC/);
  });
});
