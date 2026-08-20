import { normalizeTonAddress } from "./ton-address";

const FRIENDLY = "UQAWzEKcdnykvXfUNouqdS62tvrp32bCxuKS6eQrS6ISgZ8t";

describe("normalizeTonAddress", () => {
  it("validates and canonicalizes a friendly TON address", () => {
    expect(normalizeTonAddress(FRIENDLY)).toMatch(/^0:[0-9a-f]{64}$/);
  });

  it("rejects a friendly address with a corrupted checksum", () => {
    const corrupted = `${FRIENDLY.slice(0, -1)}A`;
    expect(normalizeTonAddress(corrupted)).toBeNull();
  });

  it("canonicalizes a raw basechain address", () => {
    expect(normalizeTonAddress(`0:${"AB".repeat(32)}`)).toBe(
      `0:${"ab".repeat(32)}`,
    );
  });

  it("rejects unsupported workchains and malformed values", () => {
    expect(normalizeTonAddress(`2:${"a".repeat(64)}`)).toBeNull();
    expect(normalizeTonAddress("EQnot-an-address")).toBeNull();
  });
});
