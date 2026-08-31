import { canonicalTonShardId, TonShardIdentError } from "./ton-shard-ident";

describe("canonical TON ShardIdent reconstruction", () => {
  it("reconstructs unsplit, left, and right BlockIdExt shard IDs", () => {
    expect(
      canonicalTonShardId({ shardPrefixBits: 0, shardPrefix: 0n }),
    ).toBe("-9223372036854775808");
    expect(
      canonicalTonShardId({ shardPrefixBits: 1, shardPrefix: 0n }),
    ).toBe("4611686018427387904");
    expect(
      canonicalTonShardId({
        shardPrefixBits: 1,
        shardPrefix: 1n << 63n,
      }),
    ).toBe("-4611686018427387904");
  });

  it("rejects invalid lengths, suffix bits, and uint64 values", () => {
    expect(() =>
      canonicalTonShardId({ shardPrefixBits: 61, shardPrefix: 0n }),
    ).toThrow(TonShardIdentError);
    expect(() =>
      canonicalTonShardId({ shardPrefixBits: 1, shardPrefix: 1n }),
    ).toThrow("non-canonical suffix bits");
    expect(() =>
      canonicalTonShardId({ shardPrefixBits: 0, shardPrefix: 1n << 64n }),
    ).toThrow("outside uint64");
  });
});
