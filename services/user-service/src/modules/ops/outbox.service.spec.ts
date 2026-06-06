import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OutboxService } from './outbox.service';
import { OutboxEvent, OutboxStatus } from './entities/outbox-event.entity';

function makeRepo(): any {
  const rows: OutboxEvent[] = [];
  return {
    rows,
    create: jest.fn((data: Partial<OutboxEvent>) => ({
      id: data.id ?? `e-${rows.length + 1}`,
      attempts: 0,
      lastError: null,
      deliveredAt: null,
      createdAt: new Date(),
      ...data,
    })),
    save: jest.fn(async (e: OutboxEvent | OutboxEvent[]) => {
      const arr = Array.isArray(e) ? e : [e];
      for (const row of arr) {
        const idx = rows.findIndex((r) => r.id === row.id);
        if (idx >= 0) rows[idx] = { ...row };
        else rows.push({ ...row });
      }
      return e;
    }),
    update: jest.fn(async (id: string, patch: Partial<OutboxEvent>) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
      return { affected: 1 };
    }),
    findOne: jest.fn(async ({ where }: any) => {
      return rows.find((r) => r.id === where.id) ?? null;
    }),
    find: jest.fn(async () => [...rows]),
    manager: {
      transaction: jest.fn(async (fn: any) => fn(rows)),
    },
  };
}

describe('OutboxService', () => {
  let service: OutboxService;
  let repo: any;

  beforeEach(async () => {
    repo = makeRepo();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        { provide: getRepositoryToken(OutboxEvent), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(OutboxService);
  });

  it('enqueues an event with PENDING status and zero attempts', async () => {
    const saved = await service.enqueue({
      aggregateType: 'deal',
      aggregateId: 'd1',
      eventType: 'deal.created',
      payload: { x: 1 },
    });
    expect(saved.status).toBe(OutboxStatus.PENDING);
    expect(saved.attempts).toBe(0);
    expect(saved.payload).toEqual({ x: 1 });
    expect(repo.rows).toHaveLength(1);
  });

  it('marks an event delivered', async () => {
    const saved = await service.enqueue({
      aggregateType: 'deal',
      aggregateId: 'd1',
      eventType: 'deal.created',
    });
    await service.markDelivered(saved.id);
    expect(repo.rows[0].status).toBe(OutboxStatus.DELIVERED);
    expect(repo.rows[0].deliveredAt).toBeInstanceOf(Date);
  });

  it('retries with backoff on failure and parks DEAD after 6 attempts', async () => {
    const saved = await service.enqueue({
      aggregateType: 'deal',
      aggregateId: 'd1',
      eventType: 'deal.created',
    });

    for (let i = 1; i <= 5; i++) {
      await service.markFailed(saved.id, new Error(`boom ${i}`));
      expect(repo.rows[0].attempts).toBe(i);
      expect(repo.rows[0].status).toBe(OutboxStatus.PENDING);
      expect(repo.rows[0].lastError).toContain(`boom ${i}`);
    }
    await service.markFailed(saved.id, new Error('final boom'));
    expect(repo.rows[0].attempts).toBe(6);
    expect(repo.rows[0].status).toBe(OutboxStatus.DEAD);
  });

  it('truncates very long error messages', async () => {
    const saved = await service.enqueue({
      aggregateType: 'deal',
      aggregateId: 'd1',
      eventType: 'deal.created',
    });
    await service.markFailed(saved.id, new Error('x'.repeat(2000)));
    expect((repo.rows[0].lastError ?? '').length).toBeLessThanOrEqual(1000);
  });
});
