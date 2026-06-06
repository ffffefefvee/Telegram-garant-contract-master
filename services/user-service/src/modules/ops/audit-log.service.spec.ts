import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLogEntry } from './entities/audit-log.entity';

function makeRepo(): any {
  const rows: AuditLogEntry[] = [];
  const matches = (r: AuditLogEntry, where: any): boolean =>
    Object.entries(where).every(([k, v]) => {
      const rv = (r as any)[k];
      // Naive treatment of TypeORM operators (Between/MoreThanOrEqual etc.) — we
      // skip filtering on them in tests; assert ordering/pagination at the
      // logical level instead.
      if (v && typeof v === 'object' && '_type' in (v as any)) return true;
      return rv === v;
    });
  return {
    rows,
    create: jest.fn((data: Partial<AuditLogEntry>) => ({
      id: `a-${rows.length + 1}`,
      createdAt: new Date(),
      ...data,
    })),
    save: jest.fn(async (e: AuditLogEntry) => {
      rows.push({ ...e });
      return e;
    }),
    find: jest.fn(async ({ where }: any) => {
      return rows.filter((r) => matches(r, where)).reverse();
    }),
    findAndCount: jest.fn(async ({ where = {}, skip = 0, take = 50 }: any) => {
      const filtered = rows.filter((r) => matches(r, where)).reverse();
      return [filtered.slice(skip, skip + take), filtered.length];
    }),
  };
}

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repo: any;

  beforeEach(async () => {
    repo = makeRepo();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLogEntry), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(AuditLogService);
  });

  it('writes a row with sane defaults', async () => {
    const row = await service.write({
      actorId: 'u1',
      aggregateType: 'deal',
      aggregateId: 'd1',
      action: 'deal.created',
    });
    expect(row).not.toBeNull();
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].details).toEqual({});
  });

  it('returns null and does not throw when the underlying save fails', async () => {
    repo.save.mockRejectedValue(new Error('db down'));
    const row = await service.write({
      aggregateType: 'deal',
      aggregateId: 'd1',
      action: 'deal.created',
    });
    expect(row).toBeNull();
  });

  it('lists rows by aggregate', async () => {
    await service.write({
      aggregateType: 'deal',
      aggregateId: 'd1',
      action: 'deal.created',
    });
    await service.write({
      aggregateType: 'deal',
      aggregateId: 'd2',
      action: 'deal.created',
    });
    const list = await service.findByAggregate('deal', 'd1');
    expect(list).toHaveLength(1);
    expect(list[0].aggregateId).toBe('d1');
  });

  it('lists rows by actor', async () => {
    await service.write({
      actorId: 'u1',
      aggregateType: 'deal',
      aggregateId: 'd1',
      action: 'deal.created',
    });
    await service.write({
      actorId: 'u2',
      aggregateType: 'deal',
      aggregateId: 'd2',
      action: 'deal.created',
    });
    const list = await service.findByActor('u1');
    expect(list).toHaveLength(1);
    expect(list[0].actorId).toBe('u1');
  });

  it('paginates with filters', async () => {
    for (let i = 0; i < 5; i++) {
      await service.write({
        actorId: 'u1',
        aggregateType: 'deal',
        aggregateId: `d${i}`,
        action: 'deal.created',
      });
    }
    await service.write({
      actorId: 'u2',
      aggregateType: 'arbitrator',
      aggregateId: 'a1',
      action: 'arbitrator.approved',
    });

    const page1 = await service.findPaginated({ page: 1, limit: 2, action: 'deal.created' });
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page1.page).toBe(1);

    const page2 = await service.findPaginated({ page: 2, limit: 2, action: 'deal.created' });
    expect(page2.items).toHaveLength(2);

    const filtered = await service.findPaginated({ aggregateType: 'arbitrator' });
    expect(filtered.total).toBe(1);
  });

  it('clamps limit to a safe maximum', async () => {
    const result = await service.findPaginated({ limit: 9999 });
    expect(result.limit).toBeLessThanOrEqual(200);
  });
});
