import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { WebhookIdempotencyService } from './webhook-idempotency.service';
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity';

/**
 * In-memory stand-in for the TypeORM repository that enforces the
 * `(provider, eventKey)` unique constraint, so we can exercise the
 * duplicate-insert race without a real database.
 */
function makeRepo(): any {
  const rows: ProcessedWebhookEvent[] = [];
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => {
      return (
        rows.find(
          (r) => r.provider === where.provider && r.eventKey === where.eventKey,
        ) ?? null
      );
    }),
    insert: jest.fn(async (entity: Partial<ProcessedWebhookEvent>) => {
      const clash = rows.some(
        (r) => r.provider === entity.provider && r.eventKey === entity.eventKey,
      );
      if (clash) {
        // Mimic Postgres unique_violation surfaced by TypeORM.
        const err = new QueryFailedError('insert', [], new Error('duplicate'));
        (err as QueryFailedError & { code?: string }).code = '23505';
        throw err;
      }
      rows.push(entity as ProcessedWebhookEvent);
      return { identifiers: [] };
    }),
    update: jest.fn(async (where: Partial<ProcessedWebhookEvent>, values: Partial<ProcessedWebhookEvent>) => {
      const row = rows.find(
        (r) => r.provider === where.provider && r.eventKey === where.eventKey,
      );
      if (row) Object.assign(row, values);
      return { affected: row ? 1 : 0 };
    }),
  };
}

describe('WebhookIdempotencyService', () => {
  let svc: WebhookIdempotencyService;
  let repo: any;

  beforeEach(async () => {
    repo = makeRepo();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookIdempotencyService,
        { provide: getRepositoryToken(ProcessedWebhookEvent), useValue: repo },
      ],
    }).compile();
    svc = moduleRef.get(WebhookIdempotencyService);
  });

  it('reports an event as not processed before it is marked', async () => {
    expect(await svc.isProcessed('cryptomus', 'order-1')).toBe(false);
  });

  it('claims, marks, then reports the event as processed', async () => {
    const ref = {
      provider: 'cryptomus',
      eventKey: 'order-1',
      orderId: 'order-1',
      status: 'paid',
    };
    await expect(svc.tryClaim(ref)).resolves.toBe(true);
    await svc.markProcessed(ref);
    expect(await svc.isProcessed('cryptomus', 'order-1')).toBe(true);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].processingState).toBe('completed');
  });

  it('returns false when a duplicate event has already been claimed (race)', async () => {
    const ref = { provider: 'cryptomus', eventKey: 'order-1' };
    await expect(svc.tryClaim(ref)).resolves.toBe(true);
    // Second concurrent delivery — must not throw, must not duplicate.
    await expect(svc.tryClaim(ref)).resolves.toBe(false);
    expect(repo.rows).toHaveLength(1);
  });

  it('rethrows non-unique-violation errors', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      svc.tryClaim({ provider: 'cryptomus', eventKey: 'order-2' }),
    ).rejects.toThrow('db down');
  });
});
