import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TonRecoveryService } from './ton-recovery.service';
import { Payment } from '../entities/payment.entity';
import { TonUnmatchedDeposit } from '../entities/ton-unmatched-deposit.entity';
import { PaymentMethod, PaymentStatus } from '../enums/payment.enum';
import { PaymentService } from '../payment.service';

function makeDeposit(
  overrides: Partial<TonUnmatchedDeposit> = {},
): TonUnmatchedDeposit {
  return {
    id: 'dep-1',
    eventId: 'event-1',
    actionIndex: 0,
    txTimestamp: 0,
    senderAddress: '0:abc',
    amountUnits: '102500000',
    comment: null,
    status: 'unmatched',
    paymentHintId: null,
    matchedPaymentId: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    ...overrides,
  } as TonUnmatchedDeposit;
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    paymentMethod: PaymentMethod.CRYPTO_TON,
    status: PaymentStatus.PENDING,
    escrowAddress: '0x' + '1'.repeat(40),
    metadata: { memo: 'TG-TEST1234' },
    ...overrides,
  } as unknown as Payment;
}

describe('TonRecoveryService', () => {
  let service: TonRecoveryService;
  let unmatchedRepo: { findOne: jest.Mock; save: jest.Mock; count: jest.Mock; find: jest.Mock };
  let paymentRepo: { findOne: jest.Mock; save: jest.Mock };
  let payments: { checkPaymentStatus: jest.Mock };

  async function setup() {
    unmatchedRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (row) => row),
      count: jest.fn(async () => 0),
      find: jest.fn(async () => []),
    };
    paymentRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (row) => row),
    };
    payments = {
      checkPaymentStatus: jest.fn(async () => makePayment({ status: PaymentStatus.COMPLETED })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TonRecoveryService,
        {
          provide: getRepositoryToken(TonUnmatchedDeposit),
          useValue: unmatchedRepo,
        },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: PaymentService, useValue: payments },
      ],
    }).compile();
    service = moduleRef.get(TonRecoveryService);
  }

  describe('match', () => {
    it('credits the deposit to the payment and runs settlement', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(makeDeposit());
      paymentRepo.findOne.mockResolvedValue(makePayment());

      const result = await service.match('dep-1', 'pay-1', 'admin-1', 'late memo');

      // Payment received the credit before the deposit was resolved.
      const savedPayment = paymentRepo.save.mock.calls[0][0] as Payment;
      expect(savedPayment.metadata.manualCreditUnits).toBe('102500000');
      expect(savedPayment.metadata.manualMatches).toHaveLength(1);

      const savedDeposit = unmatchedRepo.save.mock.calls[0][0] as TonUnmatchedDeposit;
      expect(savedDeposit.status).toBe('matched');
      expect(savedDeposit.matchedPaymentId).toBe('pay-1');
      expect(savedDeposit.resolvedBy).toBe('admin-1');

      expect(payments.checkPaymentStatus).toHaveBeenCalledWith('pay-1');
      expect(result.payment.status).toBe(PaymentStatus.COMPLETED);
    });

    it('accumulates credits across multiple matches', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(makeDeposit({ amountUnits: '50000000' }));
      paymentRepo.findOne.mockResolvedValue(
        makePayment({
          metadata: { memo: 'TG-TEST1234', manualCreditUnits: '52500000' },
        } as unknown as Partial<Payment>),
      );

      await service.match('dep-1', 'pay-1', 'admin-1');

      const savedPayment = paymentRepo.save.mock.calls[0][0] as Payment;
      expect(savedPayment.metadata.manualCreditUnits).toBe('102500000');
    });

    it('rejects an already-resolved deposit', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(makeDeposit({ status: 'matched' }));

      await expect(service.match('dep-1', 'pay-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(paymentRepo.save).not.toHaveBeenCalled();
    });

    it('rejects non-TON payments', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(makeDeposit());
      paymentRepo.findOne.mockResolvedValue(
        makePayment({ paymentMethod: PaymentMethod.CRYPTOMUS }),
      );

      await expect(service.match('dep-1', 'pay-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects payments that cannot accept funds', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(makeDeposit());
      paymentRepo.findOne.mockResolvedValue(
        makePayment({ status: PaymentStatus.EXPIRED }),
      );

      await expect(service.match('dep-1', 'pay-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404s on a missing deposit', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(null);

      await expect(service.match('nope', 'pay-1', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('ignore', () => {
    it('marks the deposit ignored with a reason', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(makeDeposit());

      const result = await service.ignore('dep-1', 'admin-1', 'refunded by hand');

      expect(result.status).toBe('ignored');
      expect(result.resolutionNote).toBe('refunded by hand');
      expect(result.resolvedBy).toBe('admin-1');
    });

    it('requires a reason', async () => {
      await setup();
      unmatchedRepo.findOne.mockResolvedValue(makeDeposit());

      await expect(service.ignore('dep-1', 'admin-1', '  ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
