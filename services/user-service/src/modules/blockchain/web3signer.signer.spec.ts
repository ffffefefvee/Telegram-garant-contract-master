import { ethers } from "ethers";
import { Web3SignerSigner } from "./web3signer.signer";

const PRIVATE_KEY = "0x" + "1".repeat(64);
const CHAIN_ID = 80002;

function fakeProvider(): ethers.Provider {
  return {
    getNetwork: jest.fn(async () => ethers.Network.from(CHAIN_ID)),
    getTransactionCount: jest.fn(async () => 7),
    getFeeData: jest.fn(async () => ({
      gasPrice: null,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    })),
    estimateGas: jest.fn(async () => 21_000n),
    resolveName: jest.fn(async (name: string) => name),
  } as unknown as ethers.Provider;
}

function jsonResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function firstRequestBody(fetchImpl: jest.Mock): Record<string, unknown> {
  const call = fetchImpl.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

describe("Web3SignerSigner", () => {
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  const address = wallet.address;

  it("requires the configured relay address to be exposed by Web3Signer", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse([address]));
    const signer = new Web3SignerSigner(
      "http://web3signer.internal:8545",
      address,
      CHAIN_ID,
      fakeProvider(),
      fetchImpl as typeof fetch,
    );

    await expect(signer.assertConfiguredAccount()).resolves.toBeUndefined();
    expect(firstRequestBody(fetchImpl)).toMatchObject({
      method: "eth_accounts",
      params: [],
    });
  });

  it("rejects startup when Web3Signer does not expose the configured address", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse([ethers.ZeroAddress]));
    const signer = new Web3SignerSigner(
      "http://web3signer.internal:8545",
      address,
      CHAIN_ID,
      fakeProvider(),
      fetchImpl as typeof fetch,
    );

    await expect(signer.assertConfiguredAccount()).rejects.toThrow(
      "does not expose",
    );
  });

  it("surfaces a Web3Signer outage as a signing error", async () => {
    const signer = new Web3SignerSigner(
      "http://web3signer.internal:8545",
      address,
      CHAIN_ID,
      fakeProvider(),
      jest.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }) as typeof fetch,
    );

    await expect(signer.assertConfiguredAccount()).rejects.toThrow(
      "Web3Signer request failed for eth_accounts",
    );
  });

  it("submits a fully populated transaction and verifies the returned signer and chain", async () => {
    const signed = await wallet.signTransaction({
      to: "0x0000000000000000000000000000000000000002",
      nonce: 7,
      gasLimit: 21_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      value: 3n,
      chainId: CHAIN_ID,
      type: 2,
    });
    const fetchImpl = jest.fn(async () => jsonResponse(signed));
    const signer = new Web3SignerSigner(
      "http://web3signer.internal:8545",
      address,
      CHAIN_ID,
      fakeProvider(),
      fetchImpl as typeof fetch,
    );

    await expect(
      signer.signTransaction({
        to: "0x0000000000000000000000000000000000000002",
        nonce: 7,
        gasLimit: 21_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        maxFeePerGas: 2_000_000_000n,
        value: 3n,
        chainId: CHAIN_ID,
        type: 2,
      }),
    ).resolves.toBe(signed);

    const rpc = firstRequestBody(fetchImpl);
    expect(rpc).toMatchObject({
      method: "eth_signTransaction",
      params: [
        {
          from: address,
          to: "0x0000000000000000000000000000000000000002",
          nonce: "0x7",
          gas: "0x5208",
          chainId: "0x13882",
        },
      ],
    });
  });

  it("rejects a valid transaction from the wrong chain", async () => {
    const wrongChainTransaction = await wallet.signTransaction({
      to: "0x0000000000000000000000000000000000000002",
      nonce: 7,
      gasLimit: 21_000n,
      gasPrice: 1_000_000_000n,
      value: 3n,
      chainId: 137,
    });
    const signer = new Web3SignerSigner(
      "http://web3signer.internal:8545",
      address,
      CHAIN_ID,
      fakeProvider(),
      jest.fn(async () => jsonResponse(wrongChainTransaction)) as typeof fetch,
    );

    await expect(
      signer.signTransaction({
        to: "0x0000000000000000000000000000000000000002",
        nonce: 7,
        gasLimit: 21_000n,
        gasPrice: 1_000_000_000n,
        value: 3n,
        chainId: CHAIN_ID,
      }),
    ).rejects.toThrow("unexpected chain");
  });
});
