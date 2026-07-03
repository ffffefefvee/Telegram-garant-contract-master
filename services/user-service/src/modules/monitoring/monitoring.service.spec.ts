import { MonitoringService } from './monitoring.service';
import {
  AlertSeverity,
  AlertType,
  SystemAlert,
} from './entities/monitoring.entity';

/**
 * In-memory stand-in for the SystemAlert repository. Enough to exercise the
 * dedup logic of `createAlertOnce` (findOne on type+title+isResolved) without
 * a real database.
 */
function makeAlertRepo(): any {
  const rows: SystemAlert[] = [];
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find(
        (r) =>
          r.type === where.type &&
          r.title === where.title &&
          r.isResolved === where.isResolved,
      ) ?? null,
    ),
    save: jest.fn(async (entity: Partial<SystemAlert>) => {
      const row = { id: `alert-${rows.length + 1}`, isResolved: false, ...entity } as SystemAlert;
      rows.push(row);
      return row;
    }),
  };
}

/**
 * Builds a MonitoringService with only the collaborators `checkStuckFunding`
 * touches wired up; everything else is a harmless stub. Instantiated directly
 * to avoid standing up the full DI graph (18 constructor deps).
 */
function makeService(overrides: {
  alertRepo?: any;
  paymentService?: any;
  config?: any;
} = {}) {
  const alertRepo = overrides.alertRepo ?? makeAlertRepo();
  const metricsRepo = { save: jest.fn(async () => ({})) };
  const paymentService = overrides.paymentService ?? {
    findStuckFunding: jest.fn(async () => []),
  };
  // Mimic ConfigService: return the provided default when the key is unset.
  const config = overrides.config ?? { get: jest.fn((_key: string, def?: any) => def) };
  const telegramBot = { sendMessage: jest.fn(async () => undefined) };
  const noop = {} as any;

  const ServiceCtor = MonitoringService as unknown as new (...args: any[]) => MonitoringService;
  const service = new ServiceCtor(
    alertRepo, // alertRepository
    noop, // healthRepository
    metricsRepo, // metricsRepository
    noop, // recoveryRepository
    noop, // jobRepository
    noop, // redis
    noop, // dealService
    paymentService, // paymentService
    noop, // dealRepo
    noop, // paymentRepo
    noop, // tonUnmatchedRepo
    noop, // outbox
    telegramBot, // telegramBot
    config, // config
    noop, // treasury
    noop, // relay
    noop, // blockchainProvider
    noop, // tonApi
  );

  return { service, alertRepo, metricsRepo, paymentService, config };
}

function stuckPayments(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `pay-${i}` }));
}

describe('MonitoringService.checkStuckFunding', () => {
  it('raises an ERROR alert when stuck-funding count exceeds the threshold', async () => {
    const { service, alertRepo, paymentService } = makeService({
      paymentService: { findStuckFunding: jest.fn(async () => stuckPayments(3)) },
    });

    await service.checkStuckFunding();

    expect(paymentService.findStuckFunding).toHaveBeenCalledTimes(1);
    expect(alertRepo.rows).toHaveLength(1);
    expect(alertRepo.rows[0]).toMatchObject({
      type: AlertType.PAYMENT_FAILED,
      severity: AlertSeverity.ERROR,
      title: 'Stuck funding: paid deals without funded escrow',
    });
  });

  it('does NOT spam: repeated ticks on the same condition create exactly one alert', async () => {
    const { service, alertRepo } = makeService({
      paymentService: { findStuckFunding: jest.fn(async () => stuckPayments(2)) },
    });

    await service.checkStuckFunding();
    await service.checkStuckFunding();
    await service.checkStuckFunding();

    expect(alertRepo.rows).toHaveLength(1);
  });

  it('stays silent when no payments are stuck', async () => {
    const { service, alertRepo } = makeService({
      paymentService: { findStuckFunding: jest.fn(async () => []) },
    });

    await service.checkStuckFunding();

    expect(alertRepo.rows).toHaveLength(0);
  });

  it('honours a custom STUCK_FUNDING_ALERT_THRESHOLD (no alert at or below it)', async () => {
    const config = { get: jest.fn((key: string) => (key === 'STUCK_FUNDING_ALERT_THRESHOLD' ? '5' : undefined)) };
    const { service, alertRepo } = makeService({
      config,
      paymentService: { findStuckFunding: jest.fn(async () => stuckPayments(5)) },
    });

    await service.checkStuckFunding();

    // 5 is not greater than threshold 5 → no alert.
    expect(alertRepo.rows).toHaveLength(0);
  });

  it('swallows repository errors without throwing', async () => {
    const { service } = makeService({
      paymentService: {
        findStuckFunding: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    });

    await expect(service.checkStuckFunding()).resolves.toBeUndefined();
  });
});
