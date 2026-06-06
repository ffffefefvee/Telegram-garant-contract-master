import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReconciliationService } from './reconciliation.service';
import { Payment } from '../payment/entities/payment.entity';
import { PaymentStatus } from '../payment/enums/payment.enum';
import { Deal } from '../deal/entities/deal.entity';
import { DealStatus } from '../deal/enums/deal.enum';
import { EscrowService } from '../escrow/escrow.service';
import { DealService } from '../deal/deal.service';

function makePaymentRepo(seed: Partial<Payment>[]): any {
  const rows = seed.map((s) => ({ ...s }));
  return {
    rows,
    find: jest.fn(async ({ where }: any) => {
      return rows.filter((r) => {
        if (where.status && (r as any).status !== where.status) return false;
        return true;
      });
    }),
  };
}

function makeDealRepo(seed: Partial<Deal>[]): any {
  const rows = seed.map((s) => ({ ...s }));
  return {
    rows,
    save: jest.fn(async (d: Deal) => {
      const idx = rows.findIndex((r) => r.id === d.id);
      if (idx >= 0) rows[idx] = { ...d };
      else rows.push({ ...d });
      return d;
    }),
  };
}

describe('ReconciliationService', () => {
  let svc: ReconciliationService;
  let payRepo: any;
  let dealRepo: any;
  let escrow: jest.Mocked<Partial<EscrowService>>;
  let dealService: { confirmPayment: jest.Mock };

  async function build({
    payments,
    deals,
    escrowEnabled = true,
  }: {
    payments: Partial<Payment>[];
    deals: Partial<Deal>[];
    escrowEnabled?: boolean;
  }) {
    payRepo = makePaymentRepo(payments);
    dealRepo = makeDealRepo(deals);
    escrow = {
      isEnabled: jest.fn(() => escrowEnabled),
      createEscrow: jest.fn(),
      forwardAndFund: jest.fn(),
    };
    dealService = {
      confirmPayment: jest.fn(async (dealId: string) => {
        const row = dealRepo.rows.find((r: Deal) => r.id === dealId);
        if (row) {
          row.status = DealStatus.IN_PROGRESS;
        }
        return row;
      }),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(Payment), useValue: payRepo },
        { provide: getRepositoryToken(Deal), useValue: dealRepo },
        { provide: EscrowService, useValue: escrow },
        { provide: DealService, useValue: dealService },
      ],
    }).compile();
    svc = moduleRef.get(ReconciliationService);
  }

  const W = (n: string) => '0x' + n.padEnd(40, '0');

  it('skips entirely in stub mode', async () => {
    await build({ payments: [], deals: [], escrowEnabled: false });
    const report = await svc.runOnce();
    expect(report.notes[0]).toMatch(/blockchain disabled/);
    expect(report.payments.scanned).toBe(0);
  });

  it('forwards a previously-stuck PAID payment whose deal is now wallet-complete', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 100,
      status: DealStatus.PENDING_PAYMENT,
      escrowAddress: null,
      buyer: { walletAddress: W('a') } as any,
      seller: { walletAddress: W('b') } as any,
    };
    await build({
      payments: [
        {
          id: 'p1',
          status: PaymentStatus.COMPLETED,
          dealId: 'd1',
          amount: 100,
          currency: 'USDT',
          deal: deal as Deal,
        },
      ],
      deals: [deal],
    });
    (escrow.createEscrow as jest.Mock).mockResolvedValue({
      escrowAddress: W('c'),
      transactionHash: '0xdeploy',
    });
    (escrow.forwardAndFund as jest.Mock).mockResolvedValue({
      transferTxHash: '0xtx',
      notifyTxHash: '0xnotify',
    });

    const report = await svc.runOnce();
    expect(report.payments.scanned).toBe(1);
    expect(report.payments.forwarded).toBe(1);
    expect(escrow.createEscrow).toHaveBeenCalled();
    expect(escrow.forwardAndFund).toHaveBeenCalledWith('d1', 100);
    expect(dealService.confirmPayment).toHaveBeenCalledWith('d1', expect.any(Number), expect.any(String));
    expect(dealRepo.rows[0].status).toBe(DealStatus.IN_PROGRESS);
  });

  it('skips deals still missing wallets', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 100,
      status: DealStatus.PENDING_PAYMENT,
      buyer: { walletAddress: null } as any,
      seller: { walletAddress: W('b') } as any,
    };
    await build({
      payments: [
        {
          id: 'p1',
          status: PaymentStatus.COMPLETED,
          dealId: 'd1',
          amount: 100,
          currency: 'USDT',
          deal: deal as Deal,
        },
      ],
      deals: [deal],
    });
    const report = await svc.runOnce();
    expect(report.payments.scanned).toBe(1);
    expect(report.payments.skipped).toBe(1);
    expect(report.payments.forwarded).toBe(0);
    expect(escrow.forwardAndFund).not.toHaveBeenCalled();
  });

  it('skips deals already past PENDING_PAYMENT', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 100,
      status: DealStatus.IN_PROGRESS,
      buyer: { walletAddress: W('a') } as any,
      seller: { walletAddress: W('b') } as any,
    };
    await build({
      payments: [
        {
          id: 'p1',
          status: PaymentStatus.COMPLETED,
          dealId: 'd1',
          amount: 100,
          currency: 'USDT',
          deal: deal as Deal,
        },
      ],
      deals: [deal],
    });
    const report = await svc.runOnce();
    expect(report.payments.skipped).toBe(1);
    expect(report.payments.forwarded).toBe(0);
  });

  it('counts a failure and continues', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 100,
      status: DealStatus.PENDING_PAYMENT,
      escrowAddress: W('c'),
      buyer: { walletAddress: W('a') } as any,
      seller: { walletAddress: W('b') } as any,
    };
    await build({
      payments: [
        {
          id: 'p1',
          status: PaymentStatus.COMPLETED,
          dealId: 'd1',
          amount: 100,
          currency: 'USDT',
          deal: deal as Deal,
        },
      ],
      deals: [deal],
    });
    (escrow.forwardAndFund as jest.Mock).mockRejectedValue(new Error('rpc down'));
    const report = await svc.runOnce();
    expect(report.payments.failed).toBe(1);
    expect(dealRepo.rows[0].status).toBe(DealStatus.PENDING_PAYMENT);
  });
});
