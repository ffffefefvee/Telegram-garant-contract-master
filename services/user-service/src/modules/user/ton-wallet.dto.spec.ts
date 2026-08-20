import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { TonNetwork } from "./entities/ton-wallet-binding.entity";
import { VerifyTonWalletDto } from "./ton-wallet.dto";

describe("VerifyTonWalletDto", () => {
  const valid = {
    account: {
      address: `0:${"a".repeat(64)}`,
      chain: TonNetwork.TESTNET,
      publicKey: "b".repeat(64),
      walletStateInit: "dGVzdA==",
    },
    proof: {
      timestamp: "1700000000",
      domain: { lengthBytes: 14, value: "garant.example" },
      payload: "challenge",
      signature: Buffer.alloc(64).toString("base64"),
    },
  };

  it("accepts the TON Connect SDK proof shape", async () => {
    const errors = await validate(plainToInstance(VerifyTonWalletDto, valid));
    expect(errors).toHaveLength(0);
  });

  it.each(["account", "proof"])("requires nested %s data", async (field) => {
    const input = { ...valid, [field]: undefined };
    const errors = await validate(plainToInstance(VerifyTonWalletDto, input));
    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it("requires the proof domain object", async () => {
    const input = { ...valid, proof: { ...valid.proof, domain: undefined } };
    const errors = await validate(plainToInstance(VerifyTonWalletDto, input));
    const proofError = errors.find((error) => error.property === "proof");
    expect(proofError?.children?.[0]?.property).toBe("domain");
  });
});
