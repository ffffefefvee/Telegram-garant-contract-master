import {
  beginCell,
  domainSign,
  storeStateInit,
  WalletContractV4,
} from "@ton/ton";
import { keyPairFromSeed } from "@ton/crypto";
import { TonNetwork } from "./entities/ton-wallet-binding.entity";
import { TonConnectAccountDto, TonProofDto } from "./ton-wallet.dto";
import { buildTonProofDigest, TonProofVerifier } from "./ton-proof-verifier";

describe("TonProofVerifier", () => {
  const verifier = new TonProofVerifier();
  const keyPair = keyPairFromSeed(Buffer.alloc(32, 7));
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const walletStateInit = beginCell()
    .store(storeStateInit(wallet.init))
    .endCell()
    .toBoc()
    .toString("base64");
  const now = 1_700_000_000;
  const domain = "garant.example";
  const payload = "q".repeat(43);

  function signedInput(overrides?: {
    account?: Partial<TonConnectAccountDto>;
    proof?: Partial<TonProofDto>;
  }): { account: TonConnectAccountDto; proof: TonProofDto } {
    const account: TonConnectAccountDto = {
      address: wallet.address.toRawString(),
      chain: TonNetwork.TESTNET,
      publicKey: keyPair.publicKey.toString("hex"),
      walletStateInit,
      ...overrides?.account,
    };
    const unsigned: TonProofDto = {
      timestamp: now,
      domain: { lengthBytes: Buffer.byteLength(domain), value: domain },
      payload,
      signature: "",
      ...overrides?.proof,
    };
    const signature = domainSign({
      data: buildTonProofDigest(wallet.address, unsigned),
      secretKey: keyPair.secretKey,
      domain: { type: "empty" },
    }).toString("base64");
    return { account, proof: { ...unsigned, signature } };
  }

  const options = {
    expectedDomain: domain,
    expectedNetwork: TonNetwork.TESTNET,
    expectedPayload: payload,
    maxAgeSeconds: 300,
    futureSkewSeconds: 30,
    nowSeconds: now,
  };

  it("verifies a standard wallet proof and returns canonical evidence", () => {
    const { account, proof } = signedInput();
    expect(verifier.verify(account, proof, options)).toEqual({
      address: wallet.address.toRawString(),
      network: TonNetwork.TESTNET,
      publicKey: keyPair.publicKey.toString("hex"),
      walletStateInit,
      timestamp: now,
    });
  });

  it("accepts the protocol decimal-string timestamp representation", () => {
    const { account, proof } = signedInput({
      proof: { timestamp: String(now) },
    });
    expect(verifier.verify(account, proof, options).timestamp).toBe(now);
  });

  it("rejects a StateInit that does not derive the reported address", () => {
    const other = WalletContractV4.create({
      workchain: 0,
      publicKey: keyPairFromSeed(Buffer.alloc(32, 8)).publicKey,
    });
    const otherStateInit = beginCell()
      .store(storeStateInit(other.init))
      .endCell()
      .toBoc()
      .toString("base64");
    const { account, proof } = signedInput({
      account: { walletStateInit: otherStateInit },
    });
    expect(() => verifier.verify(account, proof, options)).toThrow(
      /StateInit does not match/,
    );
  });

  it("rejects a reported public key that differs from StateInit", () => {
    const { account, proof } = signedInput({
      account: { publicKey: Buffer.alloc(32, 9).toString("hex") },
    });
    expect(() => verifier.verify(account, proof, options)).toThrow(
      /public key mismatch/,
    );
  });

  it("rejects a domain byte-length mismatch", () => {
    const { account, proof } = signedInput();
    proof.domain.lengthBytes += 1;
    expect(() => verifier.verify(account, proof, options)).toThrow(
      /domain length/,
    );
  });

  it("rejects stale and future proofs", () => {
    const stale = signedInput({ proof: { timestamp: now - 301 } });
    expect(() => verifier.verify(stale.account, stale.proof, options)).toThrow(
      /expired/,
    );

    const future = signedInput({ proof: { timestamp: now + 31 } });
    expect(() =>
      verifier.verify(future.account, future.proof, options),
    ).toThrow(/future/);
  });

  it("rejects a signature over a different challenge payload", () => {
    const { account, proof } = signedInput();
    proof.payload = "different";
    expect(() => verifier.verify(account, proof, options)).toThrow(/payload/);
  });
});
