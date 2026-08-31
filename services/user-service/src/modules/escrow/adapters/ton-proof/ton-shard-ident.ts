import type { ShardIdent } from "@ton/core";

const UINT64_LIMIT = 1n << 64n;

export class TonShardIdentError extends Error {
  readonly name = "TonShardIdentError";
}

function reject(message: string): never {
  throw new TonShardIdentError(message);
}

/** Reconstruct a signed BlockIdExt shard ID from its TL-B ShardIdent. */
export function canonicalTonShardId(
  shard: Pick<ShardIdent, "shardPrefixBits" | "shardPrefix">,
): string {
  const bits = shard.shardPrefixBits;
  const prefix = shard.shardPrefix;
  if (!Number.isSafeInteger(bits) || bits < 0 || bits > 60) {
    reject("shard prefix length is outside 0..60");
  }
  if (prefix < 0n || prefix >= UINT64_LIMIT) {
    reject("shard prefix is outside uint64");
  }
  const prefixMask =
    bits === 0
      ? 0n
      : ((1n << BigInt(bits)) - 1n) << BigInt(64 - bits);
  if ((prefix & ~prefixMask) !== 0n) {
    reject("shard prefix has non-canonical suffix bits");
  }
  const terminator = 1n << BigInt(63 - bits);
  return BigInt.asIntN(64, prefix | terminator).toString();
}
