import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TonUnmatchedScanner } from './ton-unmatched.scanner';
import { TonApiService, TonIncomingTransfer } from './ton-api.service';
import { Payment } from '../entities/payment.entity';
import { TonUnmatchedDeposit } from '../entities/ton-unmatched-deposit.entity';
import { PaymentMethod, PaymentStatus } from '../enums/payment.enum';

function transfer(overrides: Partial<TonIncomingTransfer> = {}): TonIncomingTransfer {
  return {
    asset: 'USDT',
    eventId: 'event-1',
    actionIndex: 0,
    timestamp: Math.floor(Date.now() / 1000),
    sender: '0:abc',
    amountUnits: 102_500_000n, // 102.5 USDT
    comment: '',
    ...overrides,
  };
}

function tonPayment(
  memo: string,
  status: PaymentStatus,
  id = `payment-${memo}`,
): Payment {
  return {
    id,
    paymentMethod: PaymentMethod.CRYPTO_TON,
    status,
    metadata: { memo },
    createdAt: new Date(),
  } as unknown as Payment;
}

describe('TonUnmatchedScanner', () => {
  let scanner: TonUnmatchedScanner;
  let tonApi: { isEnabled: jest.Mock; listIncomingTransfers: jest.Mock };
  let paymentRepo: { find: jest.Mock };
  let unmatchedRepo: { findOne: jest.Mock; save: jest.Mock };

  async function setup() {
    tonApi = {
      isEnabled: jest.fn(() => true),
      listIncomingTransfers: jest.fn(async () => []),
    };
    paymentRepo = { find: jest.fn(async () => []) };
    unmatchedRepo = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (row) => row),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TonUnmatchedScanner,
        { provide: TonApiService, useValue: tonApi },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        {
          provide: getRepositoryToken(TonUnmatchedDeposit),
          useValue: unmatchedRepo,
        },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d },
        },
        {
          provide: SchedulerRegistry,
          useValue: { deleteCronJob: jest.fn() },
        },
      ],
    }).compile();
    scanner = moduleRef.get(TonUnmatchedScanner);
  }

  it('does not record transfers whose memo matches a live payment', async () => {
    await setup();
    tonApi.listIncomingTransfers.mockResolvedValue([
      transfer({ comment: 'TG-LIVE0001' }),
    ]);
    paymentRepo.find.mockResolvedValue([
      tonPayment('TG-LIVE0001', PaymentStatus.PENDING),
    ]);

    const report = await scanner.runOnce();

    expect(report.matched).toBe(1);
    expect(report.newUnmatched).toBe(0);
    expect(unmatchedRepo.save).not.toHaveBeenCalled();
  });

  it('records a transfer with no/unknown memo as unmatched', async () => {
    await setup();
    tonApi.listIncomingTransfers.mockResolvedValue([
      transfer({ comment: '' }),
      transfer({ eventId: 'event-2', comment: 'TG-TYPO9999' }),
    ]);

    const report = await scanner.runOnce();

    expect(report.newUnmatched).toBe(2);
    expect(unmatchedRepo.save).toHaveBeenCalledTimes(2);
    expect(unmatchedRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        amountUnits: '102500000',
        comment: null,
        status: 'unmatched',
      }),
    );
  });

  it('records a transfer matching an EXPIRED payment memo with a hint', async () => {
    await setup();
    tonApi.listIncomingTransfers.mockResolvedValue([
      transfer({ comment: 'TG-LATE0001' }),
    ]);
    paymentRepo.find.mockResolvedValue([
      tonPayment('TG-LATE0001', PaymentStatus.EXPIRED, 'payment-late'),
    ]);

    const report = await scanner.runOnce();

    expect(report.newUnmatched).toBe(1);
    expect(unmatchedRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ paymentHintId: 'payment-late' }),
    );
  });

  it('is idempotent: already-recorded events are not saved twice', async () => {
    await setup();
    tonApi.listIncomingTransfers.mockResolvedValue([transfer()]);
    unmatchedRepo.findOne.mockResolvedValue({ id: 'existing-row' });

    const report = await scanner.runOnce();

    expect(report.alreadyKnown).toBe(1);
    expect(report.newUnmatched).toBe(0);
    expect(unmatchedRepo.save).not.toHaveBeenCalled();
  });

  it('matches native TON transfers against Toncoin payments', async () => {
    await setup();
    tonApi.listIncomingTransfers.mockResolvedValue([
      transfer({ asset: 'TON', comment: 'TG-NATIVE01', amountUnits: 20_500_000_000n }),
    ]);
    paymentRepo.find.mockResolvedValue([
      {
        id: 'payment-toncoin',
        paymentMethod: PaymentMethod.CRYPTO_TONCOIN,
        status: PaymentStatus.PENDING,
        metadata: { memo: 'TG-NATIVE01' },
        createdAt: new Date(),
      } as unknown as Payment,
    ]);

    const report = await scanner.runOnce();

    expect(report.matched).toBe(1);
    expect(unmatchedRepo.save).not.toHaveBeenCalled();
  });

  it('records an asset mix-up (TON sent for a USDT payment) with a hint', async () => {
    await setup();
    tonApi.listIncomingTransfers.mockResolvedValue([
      transfer({ asset: 'TON', comment: 'TG-USDT0001' }),
    ]);
    paymentRepo.find.mockResolvedValue([
      tonPayment('TG-USDT0001', PaymentStatus.PENDING, 'payment-usdt'),
    ]);

    const report = await scanner.runOnce();

    expect(report.newUnmatched).toBe(1);
    expect(unmatchedRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ asset: 'TON', paymentHintId: 'payment-usdt' }),
    );
  });

  it('prefers a live payment over an expired one for the same memo', async () => {
    await setup();
    tonApi.listIncomingTransfers.mockResolvedValue([
      transfer({ comment: 'TG-RETRY001' }),
    ]);
    paymentRepo.find.mockResolvedValue([
      tonPayment('TG-RETRY001', PaymentStatus.EXPIRED, 'payment-old'),
      tonPayment('TG-RETRY001', PaymentStatus.PENDING, 'payment-new'),
    ]);

    const report = await scanner.runOnce();

    expect(report.matched).toBe(1);
    expect(unmatchedRepo.save).not.toHaveBeenCalled();
  });
});
