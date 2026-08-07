import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stable error surfaced when the Phase 0 financial safety stop is active.
 *
 * Callers that ingest provider events must record the event and return a
 * safe acknowledgement, rather than retrying an operation that has been
 * intentionally paused. The error code is deliberately stable for alerts
 * and runbooks; it contains no transaction, address, or secret material.
 */
export class MoneyMovementDisabledError extends Error {
  readonly code = 'MONEY_EGRESS_DISABLED';

  constructor(operation: string) {
    super(`Relay operation is disabled by the money-egress safety stop: ${operation}`);
    this.name = MoneyMovementDisabledError.name;
  }
}

/**
 * Fail-closed emergency control for every backend-signed blockchain write.
 *
 * This is intentionally independent of `BlockchainProvider.isReady`: a fully
 * configured signer must still be unable to broadcast while a release is in
 * containment or reconciliation is investigating a discrepancy. `true` is
 * the only value that enables egress; a missing, malformed, or false value
 * keeps it paused.
 *
 * Phase 4 will replace this environment-backed stop with an audited control
 * plane. Keeping the policy in one injectable service now makes that swap
 * backward-compatible and prevents per-caller bypasses.
 */
@Injectable()
export class MoneyMovementGate {
  private readonly logger = new Logger(MoneyMovementGate.name);
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    const configured = config.get<string | boolean>('MONEY_EGRESS_ENABLED', false);
    this.enabled = configured === true || configured === 'true';

    if (this.enabled) {
      this.logger.warn('Money egress is ENABLED by explicit configuration');
    } else {
      this.logger.warn('Money egress is PAUSED (MONEY_EGRESS_ENABLED is not exactly true)');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Called immediately before a queued relay write starts. The queue invokes
   * this after waiting for earlier writes so a future dynamic control-plane
   * implementation can stop work that was already waiting in memory.
   */
  assertRelayOperationAllowed(label: string): void {
    if (this.enabled) {
      return;
    }

    // Queue labels can include amounts and addresses. Keep the emitted event
    // useful without placing financial or identifying data in logs.
    const operation = label.split(/\s+/, 1)[0] || 'relay.write';
    this.logger.error(`Blocked relay write while money egress is paused: ${operation}`);
    throw new MoneyMovementDisabledError(operation);
  }
}
