/**
 * Single source of truth for the platform commission grid (D5).
 *
 * The fee schedule lives on-chain in `EscrowFactory` (USDT-wei) AND off-chain in
 * `CommissionConfigService` (RUB). Historically each kept its own copy of the
 * numbers, so a change in one could silently diverge from the other — the
 * backend would quote one fee while the contract withheld another (B2).
 *
 * These constants are the canonical off-chain grid. The percent rate is the
 * only currency-independent parameter, so it is the value the startup
 * consistency check (`FeeConsistencyService`) compares against the on-chain
 * tariff. Flat fee and threshold are expressed in RUB here and in USDT-wei
 * on-chain, so comparing them would require an FX assumption and is left to
 * manual review / the E2E checklist.
 */

/** D5: percent fee for deals at or above the flat threshold. 5% = 500 bps. */
export const D5_PERCENT_BPS = 500;

/** D5 percent rate as a decimal (0.05), derived from {@link D5_PERCENT_BPS}. */
export const D5_PERCENT_RATE = D5_PERCENT_BPS / 10000;

/** D5: deals below this RUB amount pay a flat fee instead of the percent. */
export const D5_FIXED_THRESHOLD_RUB = 1000;

/** D5: flat fee (RUB) charged below {@link D5_FIXED_THRESHOLD_RUB}. */
export const D5_FIXED_FEE_RUB = 50;

/** Basis-points denominator (100% = 10000 bps). */
export const BPS_DENOMINATOR = 10000;

/** Round a monetary RUB value to 2 decimals (kopecks), avoiding float drift. */
function roundKopecks(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Canonical D5 fee for a deal amount in RUB:
 *   amount < 1000 RUB  → flat 50 RUB
 *   amount >= 1000 RUB → 5% of amount
 *
 * This is the reference implementation used by both the off-chain service
 * fallback and the property test, so there is exactly one place that encodes
 * the grid shape.
 */
export function computeDealFeeRub(amountRub: number): number {
  if (amountRub < D5_FIXED_THRESHOLD_RUB) {
    return D5_FIXED_FEE_RUB;
  }
  return roundKopecks(amountRub * D5_PERCENT_RATE);
}
