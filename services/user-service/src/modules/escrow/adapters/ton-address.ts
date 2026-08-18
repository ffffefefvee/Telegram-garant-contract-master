const RAW_TON_ADDRESS = /^(-?\d+):([0-9a-fA-F]{64})$/;
const FRIENDLY_TON_ADDRESS = /^[A-Za-z0-9+/_-]{48}$/;
const BOUNCEABLE_TAG = 0x11;
const NON_BOUNCEABLE_TAG = 0x51;

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

/**
 * Convert a raw or friendly TON account address to canonical workchain:hash.
 * Friendly addresses are accepted only with a valid tag, workchain and CRC16.
 */
export function normalizeTonAddress(address: string): string | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;

  const raw = RAW_TON_ADDRESS.exec(trimmed);
  if (raw) {
    const workchain = Number.parseInt(raw[1], 10);
    if (workchain !== 0 && workchain !== -1) return null;
    return `${workchain}:${raw[2].toLowerCase()}`;
  }

  if (!FRIENDLY_TON_ADDRESS.test(trimmed)) return null;

  try {
    const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length !== 36) return null;

    const addressTag = bytes[0] & 0x7f;
    if (addressTag !== BOUNCEABLE_TAG && addressTag !== NON_BOUNCEABLE_TAG) {
      return null;
    }

    const workchain = bytes.readInt8(1);
    if (workchain !== 0 && workchain !== -1) return null;

    const expectedCrc = bytes.readUInt16BE(34);
    const actualCrc = crc16Xmodem(bytes.subarray(0, 34));
    if (expectedCrc !== actualCrc) return null;

    return `${workchain}:${bytes.subarray(2, 34).toString("hex")}`;
  } catch {
    return null;
  }
}
