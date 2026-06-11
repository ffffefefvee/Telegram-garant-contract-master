import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { ToncoinRail } from './toncoin.rail';
import { TonApiService } from './ton-api.service';
import { Deal } from '../../deal/entities/deal.entity';
import { Currency } from '../../deal/enums/deal.enum';
import { EscrowService } from '../../escrow/escrow.service';
import { RelayService } from '../../blockchain/relay.service';
import { EscrowStatus, EscrowSnapshot } from '../../blockchain/blockchain.types';
import { Payment } from '../entities/payment.entity';

const ESCROW_ADDR = '0x' + '1'.repeat(40);
const BUYER = '0x' + '2'.repeat(40);
const SELLER = '0x' + '3'.repeat(40);
const TON_WALLET = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

function usdt(n: string): bigint {
  return ethers.parseUnits(n, 6);
}

function nano(n: string): bigint {
  return ethers.parseUnits(n, 9);
}

function makeSnapshot(overrides: Partial<EscrowSnapshot> = {}): EscrowSnapshot {
  return {
    address: ESCROW_ADDR,
    status: EscrowStatus.AWAITING_FUNDING,
    buyer: BUYER,
    seller: SELLER,
    amount: usdt('100'),
    buyerFee: usdt('2.5'),
    sellerFee: usdt('2.5'),
    fundingDeadline: Math.floor(Date.now() / 1000) + 24 * 3600,
    assignedArbitrator: ethers.ZeroAddress,
    balance: 0n,
    ...overrides,
  };
}

describe('ToncoinRail', () => {
  let rail: ToncoinRail;
  let dealRepo: { findOne: jest.Mock; save: jest.Mock };
  let escrow: { isEnabled: jest.Mock; createEscrow: jest.Mock };
  let relay: {
    readEscrow: jest.Mock;
    forwardAndFund: jest.Mock;
    isFundedOrLater: jest.Mock;
    hotWalletBalance: jest.Mock;
  };
  let tonApi: {
    isEnabled: jest.Mock;
    getWalletAddress: jest.Mock;
    getJettonMaster: jest.Mock;
    findIncomingTonByMemo: jest.Mock;
    getTonUsdRate: jest.Mock;
  };

  async function setup({
    rate = 5.0,
    float = usdt('2000'),
  }: { rate?: number; float?: bigint } = {}) {
    dealRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (d) => d),
    };
    escrow = {
      isEnabled: jest.fn(() => true),
      createEscrow: jest.fn(async () => ({
        escrowAddress: ESCROW_ADDR,
        transactionHash: '0xdeploy',
        buyerFee: usdt('2.5'),
        sellerFee: usdt('2.5'),
      })),
    };
    relay = {
      readEscrow: jest.fn(),
      forwardAndFund: jest.fn(async () => ({
        transferTxHash: '0xtransfer',
        notifyTxHash: '0xnotify',
      })),
      isFundedOrLater: jest.fn(
        (s: EscrowSnapshot) => s.status !== EscrowStatus.AWAITING_FUNDING,
      ),
      hotWalletBalance: jest.fn(async () => float),
    };
    tonApi = {
      isEnabled: jest.fn(() => true),
      getWalletAddress: jest.fn(() => TON_WALLET),
      getJettonMaster: jest.fn(() => TON_WALLET),
      findIncomingTonByMemo: jest.fn(async () => ({ receivedUnits: 0n })),
      getTonUsdRate: jest.fn(async () => rate),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ToncoinRail,
        { provide: getRepositoryToken(Deal), useValue: dealRepo },
        { provide: EscrowService, useValue: escrow },
        { provide: RelayService, useValue: relay },
        { provide: TonApiService, useValue: tonApi },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: string) => d },
        },
      ],
    }).compile();
    rail = moduleRef.get(ToncoinRail);
  }

  function makeDeal(overrides: Partial<Deal> = {}): Deal {
    return {
      id: 'deal-1',
      amount: 100,
      currency: Currency.USDT,
      amountUsdt: null,
      escrowAddress: null,
      buyer: { walletAddress: BUYER },
      seller: { walletAddress: SELLER },
      ...overrides,
    } as unknown as Deal;
  }

  function makePayment(overrides: Partial<Payment> = {}): Payment {
    return {
      id: 'payment-1',
      escrowAddress: ESCROW_ADDR,
      createdAt: new Date(),
      metadata: {
        memo: 'TG-TEST1234',
        lockedRate: 5.0,
        // 102.5 USDT / 5 $/TON * 1.01 buffer = 20.705 TON
        requiredNanoton: nano('20.705').toString(),
        rateLockExpiresAt: Math.floor(Date.now() / 1000) + 1800,
      },
      ...overrides,
    } as unknown as Payment;
  }

  const ctx = {
    dealId: 'deal-1',
    userId: 'user-1',
    amount: 100,
    currency: 'USDT',
    description: 'test',
    orderId: 'DEAL_deal-1_1',
  };

  describe('isAvailable', () => {
    it('is available when configured, float is ok and the rate is fetchable', async () => {
      await setup();
      await expect(rail.isAvailable()).resolves.toBe(true);
    });

    it('hides itself when the TON/USD rate cannot be fetched', async () => {
      await setup();
      tonApi.getTonUsdRate.mockRejectedValue(new Error('tonapi down'));
      await expect(rail.isAvailable()).resolves.toBe(false);
    });

    it('hides itself when the float is below the minimum', async () => {
      await setup({ float: usdt('10') });
      await expect(rail.isAvailable()).resolves.toBe(false);
    });
  });

  describe('createInvoice', () => {
    it('locks the rate and quotes TON with the safety buffer, rounded up', async () => {
      await setup({ rate: 5.0 });
      dealRepo.findOne.mockResolvedValue(makeDeal());
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      const invoice = await rail.createInvoice(ctx);

      // 102.5 / 5 = 20.5 TON, +1% buffer = 20.705 TON (4 dp, exact here)
      expect(invoice.asset).toBe('TON');
      expect(invoice.network).toBe('ton');
      expect(invoice.requiredAmount).toBe('20.705');
      expect(invoice.memo).toMatch(/^TG-[A-Z2-9]{8}$/);
      expect(invoice.metadata).toMatchObject({
        rail: 'toncoin',
        lockedRate: 5.0,
        requiredNanoton: nano('20.705').toString(),
        usdtEquivalent: 102.5,
      });
    });

    it('rounds the quoted amount UP at 4 decimal places', async () => {
      await setup({ rate: 5.3 });
      dealRepo.findOne.mockResolvedValue(makeDeal());
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      const invoice = await rail.createInvoice(ctx);

      // 102.5 / 5.3 * 1.01 = 19.53301886… → rounded up to 19.5331 TON
      expect(invoice.requiredAmount).toBe('19.5331');
    });

    it('caps the invoice expiry with the rate lock TTL (default 30 min)', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue(makeDeal());
      relay.readEscrow.mockResolvedValue(makeSnapshot()); // deadline in 24h

      const before = Date.now();
      const invoice = await rail.createInvoice(ctx);

      const ttlMs = invoice.expiresAt.getTime() - before;
      expect(ttlMs).toBeGreaterThan(28 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000 + 5000);
    });

    it('rejects when the float cannot cover this deal', async () => {
      await setup({ float: usdt('50') });
      dealRepo.findOne.mockResolvedValue(makeDeal());
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      await expect(rail.createInvoice(ctx)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('checkStatus', () => {
    it('funds the escrow once the locked TON amount arrived', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot());
      tonApi.findIncomingTonByMemo.mockResolvedValue({
        receivedUnits: nano('20.705'),
        lastTxHash: 'ton-event-1',
      });

      const result = await rail.checkStatus(makePayment());

      expect(tonApi.findIncomingTonByMemo).toHaveBeenCalledWith(
        'TG-TEST1234',
        expect.any(Number),
      );
      expect(relay.forwardAndFund).toHaveBeenCalledWith(
        ESCROW_ADDR,
        usdt('102.5'),
      );
      expect(result.completed).toBe(true);
      expect(result.txId).toBe('0xnotify');
    });

    it('reports partial funding at the locked rate without forwarding', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot());
      tonApi.findIncomingTonByMemo.mockResolvedValue({
        receivedUnits: nano('10'),
      });

      const result = await rail.checkStatus(makePayment());

      expect(result.completed).toBe(false);
      expect(result.receivedUsdt).toBe(50); // 10 TON @ 5 $/TON
      expect(result.requiredUsdt).toBe(102.5);
      expect(relay.forwardAndFund).not.toHaveBeenCalled();
    });

    it('expires an unpaid invoice after the rate lock TTL', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot()); // escrow deadline far away
      tonApi.findIncomingTonByMemo.mockResolvedValue({
        receivedUnits: nano('20.705'),
      });
      const payment = makePayment({
        metadata: {
          memo: 'TG-TEST1234',
          lockedRate: 5.0,
          requiredNanoton: nano('20.705').toString(),
          rateLockExpiresAt: Math.floor(Date.now() / 1000) - 60, // lock expired
        },
      } as unknown as Partial<Payment>);

      const result = await rail.checkStatus(payment);

      expect(result.completed).toBe(false);
      expect(result.expired).toBe(true);
      expect(relay.forwardAndFund).not.toHaveBeenCalled();
    });

    it('counts admin-credited nanotons (manual match) toward completion', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot());
      tonApi.findIncomingTonByMemo.mockResolvedValue({
        receivedUnits: nano('10'),
      });
      const payment = makePayment({
        metadata: {
          memo: 'TG-TEST1234',
          lockedRate: 5.0,
          requiredNanoton: nano('20.705').toString(),
          rateLockExpiresAt: Math.floor(Date.now() / 1000) + 1800,
          manualCreditUnits: nano('10.705').toString(),
        },
      } as unknown as Partial<Payment>);

      const result = await rail.checkStatus(payment);

      expect(relay.forwardAndFund).toHaveBeenCalledWith(
        ESCROW_ADDR,
        usdt('102.5'),
      );
      expect(result.completed).toBe(true);
    });

    it('never completes a payment whose locked amount is missing', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot());
      tonApi.findIncomingTonByMemo.mockResolvedValue({
        receivedUnits: nano('1000'),
      });
      const payment = makePayment({
        metadata: { memo: 'TG-TEST1234' }, // no requiredNanoton
      } as unknown as Partial<Payment>);

      const result = await rail.checkStatus(payment);

      expect(result.completed).toBe(false);
      expect(relay.forwardAndFund).not.toHaveBeenCalled();
    });

    it('is idempotent for an already-FUNDED escrow', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(
        makeSnapshot({ status: EscrowStatus.FUNDED }),
      );

      const result = await rail.checkStatus(makePayment());

      expect(result.completed).toBe(true);
      expect(relay.forwardAndFund).not.toHaveBeenCalled();
    });
  });
});
