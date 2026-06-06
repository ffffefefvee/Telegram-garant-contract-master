import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DisputeBlockchainService } from './dispute-blockchain.service';
import { Dispute } from './entities/dispute.entity';
import { Deal } from '../deal/entities/deal.entity';
import { User } from '../user/entities/user.entity';
import { EscrowService } from '../escrow/escrow.service';
import { DealStatus } from '../deal/enums/deal.enum';

function makeRepo<T extends { id?: string }>(seed: T[] = []): any {
  const rows: T[] = seed.map((r) => ({ ...r }));
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => {
      if (where.id) return rows.find((r) => (r as any).id === where.id) ?? null;
      return null;
    }),
    save: jest.fn(async (e: T) => {
      const idx = rows.findIndex((r) => (r as any).id === (e as any).id);
      if (idx >= 0) rows[idx] = { ...e };
      else rows.push({ ...e });
      return e;
    }),
  };
}

describe('DisputeBlockchainService', () => {
  let service: DisputeBlockchainService;
  let disputeRepo: any;
  let dealRepo: any;
  let userRepo: any;
  let escrow: jest.Mocked<Partial<EscrowService>>;

  function buildService(opts: {
    dispute?: Partial<Dispute> | null;
    deal?: Partial<Deal> | null;
    arbitrator?: Partial<User> | null;
    escrowEnabled?: boolean;
  }) {
    disputeRepo = makeRepo<Dispute>(opts.dispute ? [opts.dispute as Dispute] : []);
    dealRepo = makeRepo<Deal>(opts.deal ? [opts.deal as Deal] : []);
    userRepo = makeRepo<User>(opts.arbitrator ? [opts.arbitrator as User] : []);
    escrow = {
      isEnabled: jest.fn(() => opts.escrowEnabled ?? true),
      assignArbitrator: jest.fn(),
    };
    return Test.createTestingModule({
      providers: [
        DisputeBlockchainService,
        { provide: getRepositoryToken(Dispute), useValue: disputeRepo },
        { provide: getRepositoryToken(Deal), useValue: dealRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: EscrowService, useValue: escrow },
      ],
    })
      .compile()
      .then((m: TestingModule) => {
        service = m.get(DisputeBlockchainService);
      });
  }

  describe('syncArbitratorAssignmentOnChain', () => {
    it('throws when the dispute does not exist', async () => {
      await buildService({});
      await expect(
        service.syncArbitratorAssignmentOnChain('missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the dispute has no arbitrator', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', arbitratorId: null, metadata: {} },
      });
      await expect(
        service.syncArbitratorAssignmentOnChain('d1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when the arbitrator has no wallet attached', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', arbitratorId: 'arb1', metadata: {} },
        arbitrator: { id: 'arb1', walletAddress: null },
      });
      await expect(
        service.syncArbitratorAssignmentOnChain('d1'),
      ).rejects.toThrow(/no wallet attached/);
    });

    it('marks the assignment pending in stub mode and skips the on-chain call', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', arbitratorId: 'arb1', metadata: {} },
        arbitrator: { id: 'arb1', walletAddress: '0x' + 'a'.repeat(40) },
        escrowEnabled: false,
      });
      const result = await service.syncArbitratorAssignmentOnChain('d1');
      expect(result.ok).toBe(false);
      expect(result.txHash).toBeNull();
      expect(escrow.assignArbitrator).not.toHaveBeenCalled();
      expect(disputeRepo.rows[0].metadata.onChain.assignArbitratorPending).toBe(true);
    });

    it('persists tx hash and clears pending flag on success', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', arbitratorId: 'arb1', metadata: {} },
        arbitrator: { id: 'arb1', walletAddress: '0x' + 'a'.repeat(40) },
      });
      (escrow.assignArbitrator as jest.Mock).mockResolvedValue('0xtxhash');
      const result = await service.syncArbitratorAssignmentOnChain('d1');
      expect(result.ok).toBe(true);
      expect(result.txHash).toBe('0xtxhash');
      expect(escrow.assignArbitrator).toHaveBeenCalledWith('deal1', '0x' + 'a'.repeat(40));
      const meta = disputeRepo.rows[0].metadata.onChain;
      expect(meta.assignArbitratorTxHash).toBe('0xtxhash');
      expect(meta.assignArbitratorPending).toBe(false);
    });

    it('marks pending when the on-chain call throws (does not crash)', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', arbitratorId: 'arb1', metadata: {} },
        arbitrator: { id: 'arb1', walletAddress: '0x' + 'a'.repeat(40) },
      });
      (escrow.assignArbitrator as jest.Mock).mockRejectedValue(new Error('rpc unreachable'));
      const result = await service.syncArbitratorAssignmentOnChain('d1');
      expect(result.ok).toBe(false);
      expect(result.notes[0]).toMatch(/on-chain assignArbitrator failed/);
      expect(disputeRepo.rows[0].metadata.onChain.assignArbitratorPending).toBe(true);
    });
  });

  describe('recordResolutionTx', () => {
    const goodTx = '0x' + '1'.repeat(64);

    it('rejects malformed tx hashes', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', metadata: {} },
      });
      await expect(
        service.recordResolutionTx('d1', { txHash: 'nope', buyerSharePct: 50, sellerSharePct: 50 }),
      ).rejects.toThrow(/32-byte hex/);
    });

    it('rejects share percentages that do not sum to 100', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', metadata: {} },
      });
      await expect(
        service.recordResolutionTx('d1', { txHash: goodTx, buyerSharePct: 60, sellerSharePct: 30 }),
      ).rejects.toThrow(/must equal 100/);
    });

    it('throws when the dispute is missing', async () => {
      await buildService({});
      await expect(
        service.recordResolutionTx('missing', { txHash: goodTx, buyerSharePct: 50, sellerSharePct: 50 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('records tx + shares and transitions deal to DISPUTE_RESOLVED', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', metadata: {} },
        deal: { id: 'deal1', status: DealStatus.DISPUTED } as Deal,
      });
      const result = await service.recordResolutionTx('d1', {
        txHash: goodTx,
        buyerSharePct: 70,
        sellerSharePct: 30,
      });
      expect(result.txHash).toBe(goodTx);
      const meta = disputeRepo.rows[0].metadata.onChain;
      expect(meta.resolveTxHash).toBe(goodTx);
      expect(meta.resolveBuyerSharePct).toBe(70);
      expect(meta.resolveSellerSharePct).toBe(30);
      expect(dealRepo.rows[0].status).toBe(DealStatus.DISPUTE_RESOLVED);
    });

    it('does not double-transition a deal already at DISPUTE_RESOLVED', async () => {
      await buildService({
        dispute: { id: 'd1', dealId: 'deal1', metadata: {} },
        deal: { id: 'deal1', status: DealStatus.DISPUTE_RESOLVED } as Deal,
      });
      await service.recordResolutionTx('d1', {
        txHash: goodTx,
        buyerSharePct: 50,
        sellerSharePct: 50,
      });
      // dealRepo.save would only be called by the inner block when status changes.
      const saveCalls = (dealRepo.save as jest.Mock).mock.calls;
      expect(saveCalls.length).toBe(0);
    });
  });
});
