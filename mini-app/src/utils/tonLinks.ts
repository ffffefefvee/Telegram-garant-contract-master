/**
 * One-tap payment links for the TON rail.
 *
 * Both links prefill recipient, jetton (USDT), amount and the mandatory
 * transfer comment (deal memo), so the buyer only confirms the transfer:
 *
 *  - `ton://transfer/...`  — OS-level deeplink; opens whatever TON wallet is
 *    installed (Tonkeeper, MyTonWallet, Tonhub, …).
 *  - `https://app.tonkeeper.com/transfer/...` — Tonkeeper universal link;
 *    reliable from inside the Telegram webview where custom URI schemes may
 *    be blocked.
 *
 * Telegram's @wallet does not support transfer deeplinks — for it we keep
 * the copy-paste flow (address + memo) and the QR code.
 */

export const TON_USDT_DECIMALS = 6;

/** Native Toncoin uses 9 decimals (nanotons). */
export const TON_DECIMALS = 9;

/**
 * Convert a human-readable decimal amount ("105.5") into raw jetton units
 * ("105500000") without floating-point errors. Throws on malformed input —
 * callers should fall back to the copy-paste flow.
 */
export function decimalToUnits(amount: string, decimals = TON_USDT_DECIMALS): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount: ${amount}`);
  }
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    // More precision than the jetton supports — refuse rather than round,
    // the backend always sends amounts within 6 dp.
    throw new Error(`Too many decimal places in amount: ${amount}`);
  }
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return units.toString();
}

export interface TonTransferParams {
  /** Platform TON wallet (friendly EQ…/UQ… form). */
  address: string;
  /** Human-readable amount, e.g. "105.5" (USDT) or "20.1234" (TON). */
  requiredAmount: string;
  /** Mandatory transfer comment (deal memo, e.g. "TG-7K2M9QX4"). */
  memo: string;
  /**
   * USDT jetton master contract. Omit for NATIVE Toncoin transfers —
   * then `amount` is interpreted in nanotons (9 dp).
   */
  jettonMaster?: string;
}

function buildQuery(p: TonTransferParams): string {
  const isJetton = !!p.jettonMaster;
  const units = decimalToUnits(
    p.requiredAmount,
    isJetton ? TON_USDT_DECIMALS : TON_DECIMALS,
  );
  const params = new URLSearchParams(
    isJetton
      ? { jetton: p.jettonMaster as string, amount: units, text: p.memo }
      : { amount: units, text: p.memo },
  );
  return params.toString();
}

/** `ton://transfer/<addr>?jetton=…&amount=…&text=…` — OS deeplink. */
export function buildTonDeeplink(p: TonTransferParams): string {
  return `ton://transfer/${encodeURIComponent(p.address)}?${buildQuery(p)}`;
}

/** Tonkeeper universal link — works from inside the Telegram webview. */
export function buildTonkeeperLink(p: TonTransferParams): string {
  return `https://app.tonkeeper.com/transfer/${encodeURIComponent(p.address)}?${buildQuery(p)}`;
}
