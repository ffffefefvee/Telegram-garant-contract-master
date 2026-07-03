import { CommissionConfigService } from './commission-config.service';
import {
  computeDealFeeRub,
  D5_FIXED_FEE_RUB,
  D5_FIXED_THRESHOLD_RUB,
  D5_PERCENT_RATE,
} from './fee-model';

/**
 * Repository stub returning no active rows, so the service falls through to the
 * canonical D5 grid (the path we want to pin down against fee-model.ts).
 */
function makeEmptyRepo(): any {
  return { find: jest.fn(async () => []) };
}

describe('CommissionConfigService D5 fallback', () => {
  let service: CommissionConfigService;

  beforeEach(() => {
    const Ctor = CommissionConfigService as unknown as new (
      ...args: any[]
    ) => CommissionConfigService;
    service = new Ctor(makeEmptyRepo());
  });

  it('charges the flat fee below the threshold', async () => {
    expect(await service.calculateDealFeeRub(0)).toBe(D5_FIXED_FEE_RUB);
    expect(await service.calculateDealFeeRub(999.99)).toBe(D5_FIXED_FEE_RUB);
  });

  it('charges the percent fee at and above the threshold', async () => {
    expect(await service.calculateDealFeeRub(D5_FIXED_THRESHOLD_RUB)).toBe(
      Math.round(D5_FIXED_THRESHOLD_RUB * D5_PERCENT_RATE * 100) / 100,
    );
    expect(await service.calculateDealFeeRub(2000)).toBe(100);
    expect(await service.calculateDealFeeRub(10000)).toBe(500);
  });

  /**
   * Property test: the service fallback must equal the single-source-of-truth
   * grid for every amount on a representative sweep. If someone edits one
   * without the other, this fails.
   */
  it('matches the canonical fee-model grid across a sweep of amounts', async () => {
    const amounts = [
      0, 1, 50, 300, 999, 999.99, 1000, 1000.01, 1234.56, 5000, 12345, 100000,
      1_000_000,
    ];
    for (const amount of amounts) {
      const fromService = await service.calculateDealFeeRub(amount);
      const fromModel = computeDealFeeRub(amount);
      expect(fromService).toBe(fromModel);
    }
  });

  it('is continuous at the threshold boundary (no fee cliff downward)', () => {
    // Just below: flat 50. At threshold: 5% of 1000 = 50. Equal → smooth.
    expect(computeDealFeeRub(D5_FIXED_THRESHOLD_RUB - 0.01)).toBe(
      D5_FIXED_FEE_RUB,
    );
    expect(computeDealFeeRub(D5_FIXED_THRESHOLD_RUB)).toBe(D5_FIXED_FEE_RUB);
  });
});
