import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ethers } from 'ethers';
import { EscrowDeadlineService } from './escrow-deadline.service';
import { Payment } from './entities/payment.entity';
import { PaymentMethod, PaymentStatus } from './enums/payment.enum';
import { RelayService } from '../blockchain/relay.service';
import { EscrowStatus, EscrowSnapshot } from '../blockchain/blockchain.types';

const ESCROW_ADDR = '0x' + '1'.repeat(40);

function usdt(n: string): bigint {
  return ethers.parseUnits(n, 6);
}

function makeSnapshot(overrides: Partial<EscrowSnapshot> = {}): EscrowSnapshot {
  return {
    address: ESCROW_ADDR,
    status: EscrowStatus.AWAITING_FUNDING,
    buyer: '0x' + '2'.repeat(40),
    seller: '0x' + '3'.repeat(40),
    amount: usdt('100'),
    buyerFee: usdt('2.5'),
    sellerFee: usdt('2.5'),
    fundingDeadline: Math.floor(Date.now() / 1000) - 600, // already passed
    assignedArbitrator: ethers.ZeroAddress,
    balance: 0n,
    ...overrides,
  };
}

describe('EscrowDeadlineService', () => {
  let service: EscrowDeadlineService;
  let paymentRepo: { findOne: jest.Mock; save: jest.Mock };
  let relay: {
    readEscrow: jest.Mock;
    extendFundingDeadline: jest.Mock;
    isFundedOrLater: jest.Mock;
  };

  function makePayment(overrides: Partial<Payment> = {}): Payment {
    return Object.assign(new Payment(), {
      id: 'payment-1',
      paymentMethod: PaymentMethod.CRYPTO_TON,
      status: PaymentStatus.EXPIRED,
      escrowAddress: ESCROW_ADDR,
      failureReason: 'Funding deadline passed',
      expiresAt: new Date(Date.now() - 600_000),
      metadata: { memo: 'TG-TEST1234' },
      ...overrides,
    });
  }

  beforeEach(async () => {
    paymentRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (p) => p),
    };
    relay = {
      readEscrow: jest.fn(async () => makeSnapshot()),
      extendFundingDeadline: jest.fn(async () => '0xextend'),
      isFundedOrLater: jest.fn(
        (s: EscrowSnapshot) => s.status !== EscrowStatus.AWAITING_FUNDING,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EscrowDeadlineService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: RelayService, useValue: relay },
      ],
    }).compile();
    service = moduleRef.get(EscrowDeadlineService);
  });

  it('extends on-chain and revives an EXPIRED payment to PENDING', async () => {
    const payment = makePayment();
    paymentRepo.findOne.mockResolvedValue(payment);

    const before = Math.floor(Date.now() / 1000);
    const result = await service.extend('payment-1', 24, 'admin-1', {
      note: 'TON пришёл через час после дедлайна',
    });

    // Deadline already in the past → extension counts from NOW.
    expect(result.newDeadlineUnix).toBeGreaterThanOrEqual(before + 24 * 3600);
    expect(relay.extendFundingDeadline).toHaveBeenCalledWith(
      ESCROW_ADDR,
      result.newDeadlineUnix,
    );
    expect(result.txHash).toBe('0xextend');
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.failureReason).toBeNull();
    expect(payment.expiresAt!.getTime()).toBe(result.newDeadlineUnix * 1000);
    const trail = payment.metadata.deadlineExtensions as any[];
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      extendedBy: 'admin-1',
      toDeadlineUnix: result.newDeadlineUnix,
      txHash: '0xextend',
      rateLockExtended: false,
      note: 'TON пришёл через час после дедлайна',
    });
    expect(paymentRepo.save).toHaveBeenCalledWith(payment);
  });

  it('extends from the CURRENT deadline when it has not passed yet', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    relay.readEscrow.mockResolvedValue(makeSnapshot({ fundingDeadline: future }));
    paymentRepo.findOne.mockResolvedValue(
      makePayment({ status: PaymentStatus.PENDING, failureReason: null }),
    );

    const result = await service.extend('payment-1', 12, 'admin-1');

    expect(result.previousDeadlineUnix).toBe(future);
    expect(result.newDeadlineUnix).toBe(future + 12 * 3600);
  });

  it('keeps a PENDING payment PENDING (no status churn)', async () => {
    const payment = makePayment({
      status: PaymentStatus.PROCESSING,
      failureReason: null,
    });
    paymentRepo.findOne.mockResolvedValue(payment);

    await service.extend('payment-1', 24, 'admin-1');

    expect(payment.status).toBe(PaymentStatus.PROCESSING);
  });

  it('rejects a Toncoin payment with an expired rate lock unless explicitly honored', async () => {
    const payment = makePayment({
      paymentMethod: PaymentMethod.CRYPTO_TONCOIN,
      metadata: {
        memo: 'TG-TEST1234',
        lockedRate: 5.0,
        rateLockExpiresAt: Math.floor(Date.now() / 1000) - 60,
      },
    });
    paymentRepo.findOne.mockResolvedValue(payment);

    await expect(service.extend('payment-1', 24, 'admin-1')).rejects.toThrow(
      /rate lock/i,
    );
    expect(relay.extendFundingDeadline).not.toHaveBeenCalled();
  });

  it('honors an expired Toncoin rate lock when extendRateLock=true', async () => {
    const payment = makePayment({
      paymentMethod: PaymentMethod.CRYPTO_TONCOIN,
      metadata: {
        memo: 'TG-TEST1234',
        lockedRate: 5.0,
        rateLockExpiresAt: Math.floor(Date.now() / 1000) - 60,
      },
    });
    paymentRepo.findOne.mockResolvedValue(payment);

    const result = await service.extend('payment-1', 24, 'admin-1', {
      extendRateLock: true,
    });

    expect(result.rateLockExtended).toBe(true);
    expect(payment.metadata.rateLockExpiresAt).toBe(result.newDeadlineUnix);
    expect(payment.metadata.lockedRate).toBe(5.0); // original rate honored
  });

  it('does not touch a live Toncoin rate lock', async () => {
    const liveLock = Math.floor(Date.now() / 1000) + 900;
    const payment = makePayment({
      paymentMethod: PaymentMethod.CRYPTO_TONCOIN,
      status: PaymentStatus.PENDING,
      failureReason: null,
      metadata: {
        memo: 'TG-TEST1234',
        lockedRate: 5.0,
        rateLockExpiresAt: liveLock,
      },
    });
    paymentRepo.findOne.mockResolvedValue(payment);

    const result = await service.extend('payment-1', 24, 'admin-1');

    expect(result.rateLockExtended).toBe(false);
    expect(payment.metadata.rateLockExpiresAt).toBe(liveLock);
  });

  it('rejects when the escrow is EXPIRED on-chain (buyer may rescue)', async () => {
    relay.readEscrow.mockResolvedValue(
      makeSnapshot({ status: EscrowStatus.EXPIRED }),
    );
    relay.isFundedOrLater.mockReturnValue(false);
    paymentRepo.findOne.mockResolvedValue(makePayment());

    await expect(service.extend('payment-1', 24, 'admin-1')).rejects.toThrow(
      /no longer awaiting funding/i,
    );
    expect(relay.extendFundingDeadline).not.toHaveBeenCalled();
  });

  it('rejects when the escrow is already funded', async () => {
    relay.readEscrow.mockResolvedValue(
      makeSnapshot({ status: EscrowStatus.FUNDED }),
    );
    paymentRepo.findOne.mockResolvedValue(makePayment());

    await expect(service.extend('payment-1', 24, 'admin-1')).rejects.toThrow(
      /already funded/i,
    );
  });

  it('rejects non-direct-crypto payments', async () => {
    paymentRepo.findOne.mockResolvedValue(
      makePayment({ paymentMethod: PaymentMethod.CRYPTOMUS }),
    );

    await expect(service.extend('payment-1', 24, 'admin-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects completed/refunded payments', async () => {
    paymentRepo.findOne.mockResolvedValue(
      makePayment({ status: PaymentStatus.COMPLETED }),
    );

    await expect(service.extend('payment-1', 24, 'admin-1')).rejects.toThrow(
      /cannot be extended/i,
    );
  });

  it('validates the hours range', async () => {
    paymentRepo.findOne.mockResolvedValue(makePayment());
    for (const hours of [0, -5, 169, NaN]) {
      await expect(service.extend('payment-1', hours, 'admin-1')).rejects.toThrow(
        /hours/i,
      );
    }
    expect(relay.extendFundingDeadline).not.toHaveBeenCalled();
  });

  it('404s on an unknown payment', async () => {
    paymentRepo.findOne.mockResolvedValue(null);
    await expect(service.extend('nope', 24, 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
