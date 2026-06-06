import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { ArbitratorProfile } from './entities/arbitrator-profile.entity';
import {
  ArbitratorAvailability,
  ArbitratorStatus,
  DisputeStatus,
} from './entities/enums/arbitration.enum';
import { Dispute } from './entities/dispute.entity';
import { Deal } from '../deal/entities/deal.entity';

/**
 * Snapshot of an arbitrator candidate at selection time. Includes everything
 * downstream needs to decide whether to assign on-chain — wallet address,
 * load, and rating.
 */
export interface ArbitratorCandidate {
  userId: string;
  profileId: string;
  walletAddress: string;
  activeCases: number;
  rating: number;
  totalCases: number;
}

export interface SelectionFilter {
  /** Maximum concurrent disputes per arbitrator. Defaults to 5. */
  maxConcurrent?: number;
  /** Force-skip these arbitrator user-IDs (admin override / CoI). */
  excludeUserIds?: string[];
}

const ACTIVE_DISPUTE_STATUSES = [
  DisputeStatus.OPENED,
  DisputeStatus.WAITING_BUYER_EVIDENCE,
  DisputeStatus.WAITING_SELLER_EVIDENCE,
  DisputeStatus.WAITING_SELLER_RESPONSE,
  DisputeStatus.PENDING_ARBITRATOR,
  DisputeStatus.UNDER_REVIEW,
];

/**
 * Picks an arbitrator for a freshly-opened dispute.
 *
 * Selection rules (in order):
 *  1. Arbitrator status MUST be ACTIVE.
 *  2. Arbitrator MUST have a walletAddress set on their User record (we
 *     need it for the on-chain `assignArbitrator(address)` call).
 *  3. Arbitrator MUST NOT be a party to the deal under dispute (no buyer,
 *     no seller).
 *  4. Arbitrator MUST have spare capacity (active disputes < maxConcurrent).
 *
 * Among candidates that pass, we pick the least-loaded; ties broken by
 * highest rating, then by oldest user ID for determinism in tests.
 */
@Injectable()
export class ArbitratorSelectionService {
  private readonly logger = new Logger(ArbitratorSelectionService.name);
  private readonly DEFAULT_MAX_CONCURRENT = 5;

  constructor(
    @InjectRepository(ArbitratorProfile)
    private readonly profileRepo: Repository<ArbitratorProfile>,
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
  ) {}

  async selectForDeal(
    dealId: string,
    filter: SelectionFilter = {},
  ): Promise<ArbitratorCandidate> {
    const deal = await this.dealRepo.findOne({ where: { id: dealId } });
    if (!deal) {
      throw new NotFoundException(`Deal ${dealId} not found`);
    }

    const conflictUserIds = [deal.buyerId, deal.sellerId].filter(
      (id): id is string => !!id,
    );
    const excluded = [
      ...conflictUserIds,
      ...(filter.excludeUserIds ?? []),
    ];

    const baseWhere = excluded.length
      ? {
          status: ArbitratorStatus.ACTIVE,
          availability: ArbitratorAvailability.AVAILABLE,
          userId: Not(In(excluded)),
        }
      : {
          status: ArbitratorStatus.ACTIVE,
          availability: ArbitratorAvailability.AVAILABLE,
        };

    const profiles = await this.profileRepo.find({
      where: baseWhere,
      relations: ['user'],
      order: { rating: 'DESC' },
    });

    const maxConcurrent = filter.maxConcurrent ?? this.DEFAULT_MAX_CONCURRENT;
    const candidates: ArbitratorCandidate[] = [];

    for (const profile of profiles) {
      const wallet = profile.user?.walletAddress;
      if (!wallet) {
        this.logger.debug(
          `Skipping arbitrator ${profile.userId}: no walletAddress`,
        );
        continue;
      }

      const activeCases = await this.disputeRepo.count({
        where: {
          arbitratorId: profile.userId,
          status: In(ACTIVE_DISPUTE_STATUSES),
        },
      });
      if (activeCases >= maxConcurrent) {
        continue;
      }

      candidates.push({
        userId: profile.userId,
        profileId: profile.id,
        walletAddress: wallet,
        activeCases,
        rating: Number(profile.rating ?? 0),
        totalCases: profile.totalCases ?? 0,
      });
    }

    if (candidates.length === 0) {
      throw new ServiceUnavailableException(
        `No eligible arbitrators available for deal ${dealId}`,
      );
    }

    candidates.sort((a, b) => {
      if (a.activeCases !== b.activeCases) return a.activeCases - b.activeCases;
      if (a.rating !== b.rating) return b.rating - a.rating;
      return a.userId.localeCompare(b.userId);
    });

    const winner = candidates[0];
    this.logger.log(
      `Selected arbitrator ${winner.userId} for deal ${dealId} (load=${winner.activeCases} rating=${winner.rating})`,
    );
    return winner;
  }
}
