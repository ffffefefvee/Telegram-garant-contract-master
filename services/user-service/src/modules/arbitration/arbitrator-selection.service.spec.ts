import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ArbitratorSelectionService } from './arbitrator-selection.service';
import { ArbitratorProfile } from './entities/arbitrator-profile.entity';
import {
  ArbitratorAvailability,
  ArbitratorStatus,
} from './entities/enums/arbitration.enum';
import { Dispute } from './entities/dispute.entity';
import { Deal } from '../deal/entities/deal.entity';

interface ProfileSeed {
  id: string;
  userId: string;
  status: ArbitratorStatus;
  availability?: ArbitratorAvailability;
  rating: number;
  totalCases: number;
  user: { id: string; walletAddress: string | null } | null;
}

interface DisputeSeed {
  id: string;
  arbitratorId: string;
  status: string;
}

function makeProfileRepo(seed: ProfileSeed[]): any {
  return {
    find: jest.fn(async ({ where }: any) => {
      return seed.filter((p) => {
        if (where.status && p.status !== where.status) return false;
        if (where.availability) {
          const effective = p.availability ?? ArbitratorAvailability.AVAILABLE;
          if (effective !== where.availability) return false;
        }
        if (where.userId && (where.userId as any)._type === 'not') {
          // Trivial Not-In stub: real Not() carries wrapped value; we just ignore here
          return true;
        }
        return true;
      });
    }),
  };
}

function makeDisputeRepo(seed: DisputeSeed[]): any {
  return {
    count: jest.fn(async ({ where }: any) => {
      return seed.filter((d) => d.arbitratorId === where.arbitratorId).length;
    }),
  };
}

function makeDealRepo(deal: { id: string; buyerId: string; sellerId: string } | null): any {
  return {
    findOne: jest.fn(async ({ where }: any) => {
      return deal && deal.id === where.id ? deal : null;
    }),
  };
}

async function buildService(opts: {
  deal?: { id: string; buyerId: string; sellerId: string } | null;
  profiles: ProfileSeed[];
  disputes?: DisputeSeed[];
}): Promise<ArbitratorSelectionService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ArbitratorSelectionService,
      {
        provide: getRepositoryToken(ArbitratorProfile),
        useValue: makeProfileRepo(opts.profiles),
      },
      {
        provide: getRepositoryToken(Dispute),
        useValue: makeDisputeRepo(opts.disputes ?? []),
      },
      {
        provide: getRepositoryToken(Deal),
        useValue: makeDealRepo(opts.deal ?? null),
      },
    ],
  }).compile();
  return moduleRef.get(ArbitratorSelectionService);
}

const W = (n: string) => '0x' + n.padEnd(40, '0');

describe('ArbitratorSelectionService', () => {
  it('throws when the deal does not exist', async () => {
    const svc = await buildService({ deal: null, profiles: [] });
    await expect(svc.selectForDeal('missing')).rejects.toThrow(NotFoundException);
  });

  it('throws ServiceUnavailable when no eligible arbitrators exist', async () => {
    const svc = await buildService({
      deal: { id: 'd1', buyerId: 'u1', sellerId: 'u2' },
      profiles: [],
    });
    await expect(svc.selectForDeal('d1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('skips arbitrators without a wallet', async () => {
    const svc = await buildService({
      deal: { id: 'd1', buyerId: 'u1', sellerId: 'u2' },
      profiles: [
        {
          id: 'p1',
          userId: 'arb-no-wallet',
          status: ArbitratorStatus.ACTIVE,
          rating: 5,
          totalCases: 10,
          user: { id: 'arb-no-wallet', walletAddress: null },
        },
      ],
    });
    await expect(svc.selectForDeal('d1')).rejects.toThrow(/No eligible/);
  });

  // NOTE: deal-party CoI is enforced by a TypeORM `Not(In(...))` clause in
  // the query, which our hand-rolled in-memory repo doesn't replicate. The
  // service-level coverage of this is exercised in integration tests
  // against a real DB (added with PR 6/6, the reconciliation job).

  it('skips arbitrators at or above capacity', async () => {
    const svc = await buildService({
      deal: { id: 'd1', buyerId: 'u1', sellerId: 'u2' },
      profiles: [
        {
          id: 'p1',
          userId: 'arb-busy',
          status: ArbitratorStatus.ACTIVE,
          rating: 5,
          totalCases: 100,
          user: { id: 'arb-busy', walletAddress: W('a') },
        },
      ],
      disputes: Array.from({ length: 5 }).map((_, i) => ({
        id: `case-${i}`,
        arbitratorId: 'arb-busy',
        status: 'opened',
      })),
    });
    await expect(svc.selectForDeal('d1', { maxConcurrent: 5 })).rejects.toThrow(/No eligible/);
  });

  it('picks the least-loaded candidate; ties broken by rating then userId', async () => {
    const svc = await buildService({
      deal: { id: 'd1', buyerId: 'u1', sellerId: 'u2' },
      profiles: [
        {
          id: 'p1',
          userId: 'arb-c',
          status: ArbitratorStatus.ACTIVE,
          rating: 4,
          totalCases: 10,
          user: { id: 'arb-c', walletAddress: W('c') },
        },
        {
          id: 'p2',
          userId: 'arb-a',
          status: ArbitratorStatus.ACTIVE,
          rating: 5,
          totalCases: 10,
          user: { id: 'arb-a', walletAddress: W('a') },
        },
        {
          id: 'p3',
          userId: 'arb-b',
          status: ArbitratorStatus.ACTIVE,
          rating: 5,
          totalCases: 10,
          user: { id: 'arb-b', walletAddress: W('b') },
        },
      ],
      disputes: [
        // arb-a busy with 2 cases, others idle.
        { id: 'x1', arbitratorId: 'arb-a', status: 'opened' },
        { id: 'x2', arbitratorId: 'arb-a', status: 'under_review' },
      ],
    });
    const winner = await svc.selectForDeal('d1');
    // Expect arb-b (rating 5, 0 active) over arb-c (rating 4, 0 active) and arb-a (busy).
    expect(winner.userId).toBe('arb-b');
    expect(winner.activeCases).toBe(0);
    expect(winner.rating).toBe(5);
  });

  it('respects custom maxConcurrent overrides', async () => {
    const svc = await buildService({
      deal: { id: 'd1', buyerId: 'u1', sellerId: 'u2' },
      profiles: [
        {
          id: 'p1',
          userId: 'arb1',
          status: ArbitratorStatus.ACTIVE,
          rating: 5,
          totalCases: 10,
          user: { id: 'arb1', walletAddress: W('a') },
        },
      ],
      disputes: Array.from({ length: 2 }).map((_, i) => ({
        id: `c-${i}`,
        arbitratorId: 'arb1',
        status: 'opened',
      })),
    });
    // 2 active disputes; default cap 5 → still picks. Setting cap to 2 → no eligible.
    const winner = await svc.selectForDeal('d1', { maxConcurrent: 5 });
    expect(winner.userId).toBe('arb1');
    await expect(svc.selectForDeal('d1', { maxConcurrent: 2 })).rejects.toThrow(/No eligible/);
  });

  it('skips arbitrators who flipped themselves to AWAY', async () => {
    const svc = await buildService({
      deal: { id: 'd1', buyerId: 'u1', sellerId: 'u2' },
      profiles: [
        {
          id: 'p1',
          userId: 'arb-away',
          status: ArbitratorStatus.ACTIVE,
          availability: ArbitratorAvailability.AWAY,
          rating: 5,
          totalCases: 10,
          user: { id: 'arb-away', walletAddress: W('away') },
        },
        {
          id: 'p2',
          userId: 'arb-on',
          status: ArbitratorStatus.ACTIVE,
          availability: ArbitratorAvailability.AVAILABLE,
          rating: 4,
          totalCases: 5,
          user: { id: 'arb-on', walletAddress: W('on') },
        },
      ],
    });
    const winner = await svc.selectForDeal('d1');
    expect(winner.userId).toBe('arb-on');
  });
});
