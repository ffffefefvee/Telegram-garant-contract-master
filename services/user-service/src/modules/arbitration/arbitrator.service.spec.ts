import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { ArbitratorService } from './arbitrator.service';
import { ArbitratorProfile } from './entities/arbitrator-profile.entity';
import { User } from '../user/entities/user.entity';
import { ArbitrationSettingsService } from './arbitration-settings.service';
import { OutboxService } from '../ops/outbox.service';
import { AuditLogService } from '../ops/audit-log.service';
import {
  ArbitratorAvailability,
  ArbitratorStatus,
} from './entities/enums/arbitration.enum';

describe('ArbitratorService.setAvailability', () => {
  let service: ArbitratorService;
  let profileRepo: { findOne: jest.Mock; save: jest.Mock };
  let outbox: { enqueue: jest.Mock };

  const makeProfile = (
    overrides: Partial<ArbitratorProfile> = {},
  ): ArbitratorProfile => ({
    id: 'p-1',
    userId: 'u-1',
    status: ArbitratorStatus.ACTIVE,
    availability: ArbitratorAvailability.AVAILABLE,
    rating: 5,
    totalCases: 0,
    completedCases: 0,
    appealedCases: 0,
    overturnedCases: 0,
    totalEarned: 0,
    depositAmount: 0,
    specialization: null,
    bio: null,
    languages: null,
    approvedAt: null,
    approvedBy: null,
    suspensionReason: null,
    suspendedAt: null,
    suspendedById: null,
    lastActiveAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    user: null as unknown as User,
    assignedDisputes: [],
    ...overrides,
  } as unknown as ArbitratorProfile);

  beforeEach(async () => {
    profileRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (p) => p),
    };
    outbox = { enqueue: jest.fn(async () => ({ id: 'o-1' })) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArbitratorService,
        { provide: getRepositoryToken(ArbitratorProfile), useValue: profileRepo },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: ArbitrationSettingsService, useValue: {} },
        { provide: OutboxService, useValue: outbox },
        { provide: AuditLogService, useValue: { write: jest.fn(async () => null) } },
      ],
    }).compile();

    service = module.get(ArbitratorService);
  });

  it('flips availability and enqueues an outbox event', async () => {
    profileRepo.findOne.mockResolvedValue(makeProfile());

    const result = await service.setAvailability(
      'u-1',
      ArbitratorAvailability.AWAY,
    );

    expect(result.availability).toBe(ArbitratorAvailability.AWAY);
    expect(profileRepo.save).toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'arbitrator.availability_changed',
        aggregateType: 'arbitrator',
        aggregateId: 'p-1',
        payload: expect.objectContaining({
          arbitratorUserId: 'u-1',
          previous: ArbitratorAvailability.AVAILABLE,
          next: ArbitratorAvailability.AWAY,
        }),
      }),
    );
  });

  it('is a no-op when target equals current', async () => {
    profileRepo.findOne.mockResolvedValue(makeProfile());
    await service.setAvailability('u-1', ArbitratorAvailability.AVAILABLE);
    expect(profileRepo.save).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('rejects non-ACTIVE arbitrators', async () => {
    profileRepo.findOne.mockResolvedValue(
      makeProfile({ status: ArbitratorStatus.PENDING }),
    );
    await expect(
      service.setAvailability('u-1', ArbitratorAvailability.AWAY),
    ).rejects.toThrow(ForbiddenException);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
