import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PaymentWebhookService, WebhookStatus } from './payment-webhook.service';
import { Payment } from './entities/payment.entity';
import { Deal } from '../deal/entities/deal.entity';
import { DealStatus } from '../deal/enums/deal.enum';
import { EscrowService } from '../escrow/escrow.service';
import { DealService } from '../deal/deal.service';
import { AuditLogService } from '../ops/audit-log.service';
import { CryptomusWebhookPayload } from './cryptomus.service';

interface InMemoryRepoOptions<T> {
  /** Pre-seed rows. Cloned on save so tests don't share refs by accident. */
  seed?: T[];
  /** Names of relation fields to attempt to populate on findOne. */
  relations?: string[];
}

/**
 * Minimal in-memory TypeORM-shaped repository. Just enough to back the
 * service-under-test without spinning up SQLite/Postgres.
 */
function makeRepo<T extends { id?: string; transactionId?: string }>(
  opts: InMemoryRepoOptions<T> = {},
): any {
  const rows: T[] = (opts.seed ?? []).map((r) => ({ ...r }));
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => {
      const found = rows.find((r) => {
        if (where.id) return (r as any).id === where.id;
        if (where.transactionId) return (r as any).transactionId === where.transactionId;
        return false;
      });
      return found ?? null;
    }),
    save: jest.fn(async (entity: T) => {
      const idx = rows.findIndex((r) => (r as any).id === (entity as any).id);
      if (idx >= 0) rows[idx] = { ...entity };
      else rows.push({ ...entity });
      return entity;
    }),
  };
}

function makePayload(overrides: Partial<CryptomusWebhookPayload> = {}): CryptomusWebhookPayload {
  return {
    type: 'payment',
    uuid: 'cm-uuid-1',
    order_id: 'order-1',
    amount: '100',
    currency: 'USDT',
    currency_amount: '100',
    status: WebhookStatus.PAID,
    txid: '0xtx',
    network: 'polygon',
    payer_amount: '100',
    payer_currency: 'USDT',
    ...overrides,
  };
}

describe('PaymentWebhookService', () => {
  let service: PaymentWebhookService;
  let paymentRepo: any;
  let dealRepo: any;
  let escrow: jest.Mocked<Partial<EscrowService>>;
  let dealService: { confirmPayment: jest.Mock };

  function setup({
    payment,
    deal,
    escrowEnabled = true,
  }: {
    payment?: Partial<Payment> | null;
    deal?: Partial<Deal> | null;
    escrowEnabled?: boolean;
  }) {
    paymentRepo = makeRepo<Payment>({ seed: payment ? [payment as Payment] : [] });
    dealRepo = makeRepo<Deal>({ seed: deal ? [deal as Deal] : [] });
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
    return Test.createTestingModule({
      providers: [
        PaymentWebhookService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Deal), useValue: dealRepo },
        { provide: EscrowService, useValue: escrow },
        { provide: DealService, useValue: dealService },
        { provide: AuditLogService, useValue: { write: jest.fn() } },
      ],
    })
      .compile()
      .then((moduleRef: TestingModule) => {
        service = moduleRef.get(PaymentWebhookService);
      });
  }

  it('throws NotFoundException when the order_id has no matching payment', async () => {
    await setup({ payment: null });
    await expect(service.handlePaymentWebhook(makePayload())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('marks the payment paid even when no deal is linked (recorded-only case)', async () => {
    await setup({
      payment: {
        id: 'p1',
        transactionId: 'order-1',
        dealId: null,
        deal: null,
        cryptomusData: {},
      },
    });
    const result = await service.handlePaymentWebhook(makePayload());
    expect(result.paymentStatus).toBe('completed');
    expect(result.dealId).toBeNull();
    expect(result.forwarded).toBe(false);
    expect(result.notes[0]).toMatch(/no associated deal/);
    expect(escrow.forwardAndFund).not.toHaveBeenCalled();
  });

  it('skips forwarding when wallets are missing and notes the deferral', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 100,
      status: DealStatus.PENDING_PAYMENT,
      escrowAddress: null,
      buyer: { walletAddress: null } as any,
      seller: { walletAddress: null } as any,
    };
    await setup({
      payment: {
        id: 'p1',
        transactionId: 'order-1',
        dealId: 'd1',
        deal: deal as Deal,
        cryptomusData: {},
      },
      deal,
    });
    const result = await service.handlePaymentWebhook(makePayload());
    expect(result.forwarded).toBe(false);
    expect(result.notes[0]).toMatch(/wallets missing/);
    expect(escrow.createEscrow).not.toHaveBeenCalled();
    expect(escrow.forwardAndFund).not.toHaveBeenCalled();
  });

  it('deploys escrow JIT, forwards funds, and transitions deal to IN_PROGRESS on happy path', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 100,
      status: DealStatus.PENDING_PAYMENT,
      escrowAddress: null,
      buyer: { walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } as any,
      seller: { walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } as any,
    };
    await setup({
      payment: {
        id: 'p1',
        transactionId: 'order-1',
        dealId: 'd1',
        deal: deal as Deal,
        cryptomusData: {},
      },
      deal,
    });
    (escrow.createEscrow as jest.Mock).mockResolvedValue({
      dealId: 'd1',
      escrowAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      transactionHash: '0xdeploy',
      buyerFee: 0n,
      sellerFee: 0n,
    });
    (escrow.forwardAndFund as jest.Mock).mockResolvedValue({
      dealId: 'd1',
      transferTxHash: '0xtransfer',
      notifyTxHash: '0xnotify',
    });

    const result = await service.handlePaymentWebhook(makePayload());

    expect(escrow.createEscrow).toHaveBeenCalledWith(
      'd1',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      100,
    );
    expect(escrow.forwardAndFund).toHaveBeenCalledWith('d1', 100);
    expect(result.forwarded).toBe(true);
    expect(result.escrowAddress).toMatch(/^0xcccccccc/);
    expect(result.txHashes.transfer).toBe('0xtransfer');
    expect(result.txHashes.notify).toBe('0xnotify');
    expect(dealRepo.rows[0].status).toBe(DealStatus.IN_PROGRESS);
    expect(dealRepo.rows[0].escrowAddress).toMatch(/^0xcccccccc/);
  });

  it('skips forward+notify in stub mode but still transitions the deal', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 50,
      status: DealStatus.PENDING_PAYMENT,
      escrowAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      buyer: { walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } as any,
      seller: { walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } as any,
    };
    await setup({
      payment: {
        id: 'p1',
        transactionId: 'order-1',
        dealId: 'd1',
        deal: deal as Deal,
        cryptomusData: {},
      },
      deal,
      escrowEnabled: false,
    });

    const result = await service.handlePaymentWebhook(makePayload());

    expect(escrow.forwardAndFund).not.toHaveBeenCalled();
    expect(result.forwarded).toBe(false);
    expect(result.notes[0]).toMatch(/blockchain disabled/);
    expect(dealRepo.rows[0].status).toBe(DealStatus.IN_PROGRESS);
  });

  it('records a note when forwardAndFund fails (does not crash)', async () => {
    const deal: Partial<Deal> = {
      id: 'd1',
      amount: 100,
      status: DealStatus.PENDING_PAYMENT,
      escrowAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      buyer: { walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } as any,
      seller: { walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } as any,
    };
    await setup({
      payment: {
        id: 'p1',
        transactionId: 'order-1',
        dealId: 'd1',
        deal: deal as Deal,
        cryptomusData: {},
      },
      deal,
    });
    (escrow.forwardAndFund as jest.Mock).mockRejectedValue(new Error('insufficient hot-wallet balance'));

    const result = await service.handlePaymentWebhook(makePayload());

    expect(result.forwarded).toBe(false);
    expect(result.notes[0]).toMatch(/forward\+notify failed/);
    // Deal stays in PENDING_PAYMENT so reconciliation can retry it.
    expect(dealRepo.rows[0].status).toBe(DealStatus.PENDING_PAYMENT);
  });

  it('records refunds and failures without forwarding', async () => {
    const seed = {
      id: 'p1',
      transactionId: 'order-1',
      dealId: null,
      deal: null,
      cryptomusData: {},
    };
    await setup({ payment: seed });
    const refunded = await service.handlePaymentWebhook(
      makePayload({ status: WebhookStatus.REFUNDED }),
    );
    expect(refunded.paymentStatus).toBe('refunded');
    expect(refunded.forwarded).toBe(false);
    expect(escrow.forwardAndFund).not.toHaveBeenCalled();

    const cancelled = await service.handlePaymentWebhook(
      makePayload({ status: WebhookStatus.CANCELLED }),
    );
    expect(cancelled.paymentStatus).toBe('failed');
    expect(cancelled.forwarded).toBe(false);
  });
});
