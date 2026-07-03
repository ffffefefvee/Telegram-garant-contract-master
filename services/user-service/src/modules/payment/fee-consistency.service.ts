import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FactoryClient } from '../blockchain/factory.client';
import { D5_PERCENT_BPS } from './fee-model';

/**
 * Guards against the B2 hazard: two independent fee tables (off-chain
 * {@link CommissionConfigService} in RUB vs on-chain `EscrowFactory` in
 * USDT-wei) silently diverging. At startup it reads the on-chain tariff and
 * compares its percent rate — the only currency-independent parameter — against
 * the canonical off-chain grid ({@link D5_PERCENT_BPS}).
 *
 * Behaviour:
 *  - Stub mode (no blockchain env): skipped with a debug log; a dev box without
 *    a node must still boot.
 *  - Mismatch + FEE_CONSISTENCY_STRICT=true: throws, aborting startup — use in
 *    production so a misconfigured contract never goes live.
 *  - Mismatch + strict off (default): logs an error and continues, so local /
 *    testnet work is not blocked.
 */
@Injectable()
export class FeeConsistencyService implements OnModuleInit {
  private readonly logger = new Logger(FeeConsistencyService.name);

  constructor(
    private readonly factory: FactoryClient,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.verify();
  }

  /**
   * Compares on-chain vs off-chain percent fee. Returns true when consistent
   * (or safely skipped in stub mode), false on mismatch in non-strict mode.
   * Throws on mismatch when FEE_CONSISTENCY_STRICT=true. Exposed for testing.
   */
  async verify(): Promise<boolean> {
    let tariff: Awaited<ReturnType<FactoryClient['readTariff']>>;
    try {
      tariff = await this.factory.readTariff();
    } catch (error) {
      // Reading the tariff must never crash boot; treat as skip with a warning.
      this.logger.warn(
        `Fee consistency check skipped: could not read on-chain tariff: ${(error as Error).message}`,
      );
      return true;
    }

    if (!tariff) {
      this.logger.debug(
        'Fee consistency check skipped: blockchain in stub mode (no on-chain tariff).',
      );
      return true;
    }

    if (tariff.percentFeeBps === D5_PERCENT_BPS) {
      this.logger.log(
        `Fee consistency OK: on-chain percent fee ${tariff.percentFeeBps} bps matches off-chain grid.`,
      );
      return true;
    }

    const message =
      `Fee grid mismatch (B2): on-chain percentFeeBps=${tariff.percentFeeBps} ` +
      `but off-chain D5_PERCENT_BPS=${D5_PERCENT_BPS}. ` +
      'The backend quote and the contract withholding will disagree on large deals. ' +
      'Align EscrowFactory.setTariff or fee-model.ts.';

    const strict =
      this.config.get<string>('FEE_CONSISTENCY_STRICT', 'false') === 'true';
    if (strict) {
      throw new Error(message);
    }
    this.logger.error(message);
    return false;
  }
}
