import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ethers } from 'ethers';
import { DirectUsdtRail } from './direct-usdt.rail';
import { Deal } from '../../deal/entities/deal.entity';
import { Currency } from '../../deal/enums/deal.enum';
import { EscrowService } from '../../escrow/escrow.service';
import { RelayService } from '../../blockchain/relay.service';
import { EscrowStatus, EscrowSnapshot } from '../../blockchain/blockchain.types';
import { Payment } from '../entities/payment.entity';

const ESCROW_ADDR = '0x' + '1'.repeat(40);
const BUYER = '0x' + '2'.repeat(40);
const SELLER = '0x' + '3'.repeat(40);

function usdt(n: string): bigint {
  return ethers.parseUnits(n, 6);
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
    fundingDeadline: Math.floor(Date.now() / 1000) + 3600,
    assignedArbitrator: ethers.ZeroAddress,
    balance: 0n,
    ...overrides,
  };
}

describe('DirectUsdtRail', () => {
  let rail: DirectUsdtRail;
  let dealRepo: { findOne: jest.Mock; save: jest.Mock };
  let escrow: {
    isEnabled: jest.Mock;
    createEscrow: jest.Mock;
  };
  let relay: {
    readEscrow: jest.Mock;
    notifyFundedOnly: jest.Mock;
    isFundedOrLater: jest.Mock;
  };

  async function setup({ enabled = true } = {}) {
    dealRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (d) => d),
    };
    escrow = {
      isEnabled: jest.fn(() => enabled),
      createEscrow: jest.fn(async () => ({
        escrowAddress: ESCROW_ADDR,
        transactionHash: '0xdeploy',
        buyerFee: usdt('2.5'),
        sellerFee: usdt('2.5'),
      })),
    };
    relay = {
      readEscrow: jest.fn(),
      notifyFundedOnly: jest.fn(async () => '0xnotify'),
      isFundedOrLater: jest.fn(
        (snap: EscrowSnapshot) => snap.status >= EscrowStatus.FUNDED && snap.status <= EscrowStatus.RESOLVED,
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        DirectUsdtRail,
        { provide: getRepositoryToken(Deal), useValue: dealRepo },
        { provide: EscrowService, useValue: escrow },
        { provide: RelayService, useValue: relay },
      ],
    }).compile();

    rail = module.get(DirectUsdtRail);
  }

  const ctx = {
    dealId: 'deal-1',
    userId: 'user-1',
    amount: 100,
    currency: 'USDT',
    description: 'test',
    orderId: 'DEAL_deal-1_1',
  };

  describe('createInvoice', () => {
    it('deploys escrow when missing and returns deposit details incl. buyer fee', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-1',
        amount: 100,
        amountUsdt: null,
        currency: Currency.USDT,
        escrowAddress: null,
        buyer: { walletAddress: BUYER },
        seller: { walletAddress: SELLER },
      });
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      const invoice = await rail.createInvoice(ctx);

      expect(escrow.createEscrow).toHaveBeenCalledWith('deal-1', BUYER, SELLER, 100);
      expect(dealRepo.save).toHaveBeenCalled();
      expect(invoice.depositAddress).toBe(ESCROW_ADDR);
      expect(invoice.network).toBe('polygon');
      expect(invoice.asset).toBe('USDT');
      expect(invoice.requiredAmount).toBe('102.5'); // 100 + 2.5 buyer fee
    });

    it('reuses already-deployed escrow', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-1',
        amount: 100,
        amountUsdt: 100,
        currency: Currency.USDT,
        escrowAddress: ESCROW_ADDR,
        buyer: { walletAddress: BUYER },
        seller: { walletAddress: SELLER },
      });
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      const invoice = await rail.createInvoice(ctx);

      expect(escrow.createEscrow).not.toHaveBeenCalled();
      expect(invoice.depositAddress).toBe(ESCROW_ADDR);
    });

    it('rejects when blockchain is disabled', async () => {
      await setup({ enabled: false });
      await expect(rail.createInvoice(ctx)).rejects.toThrow(BadRequestException);
    });

    it('rejects when wallets are missing', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-1',
        amount: 100,
        currency: Currency.USDT,
        escrowAddress: null,
        buyer: { walletAddress: null },
        seller: { walletAddress: SELLER },
      });
      await expect(rail.createInvoice(ctx)).rejects.toThrow(/wallet addresses/);
    });

    it('rejects non-USDT deals without a locked USDT amount', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-1',
        amount: 5000,
        amountUsdt: null,
        currency: Currency.RUB,
        escrowAddress: null,
        buyer: { walletAddress: BUYER },
        seller: { walletAddress: SELLER },
      });
      await expect(rail.createInvoice(ctx)).rejects.toThrow(/USDT-denominated/);
    });
  });

  describe('checkStatus', () => {
    function makePayment(overrides: Partial<Payment> = {}): Payment {
      return {
        id: 'pay-1',
        escrowAddress: ESCROW_ADDR,
        ...overrides,
      } as Payment;
    }

    it('fires notifyFunded and completes when balance covers amount+buyerFee', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(
        makeSnapshot({ balance: usdt('102.5') }),
      );

      const result = await rail.checkStatus(makePayment());

      expect(relay.notifyFundedOnly).toHaveBeenCalledWith(ESCROW_ADDR);
      expect(result.completed).toBe(true);
      expect(result.txId).toBe('0xnotify');
      expect(result.fundedUsdt).toBe(102.5);
    });

    it('reports partial funding without notifying', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot({ balance: usdt('50') }));

      const result = await rail.checkStatus(makePayment());

      expect(relay.notifyFundedOnly).not.toHaveBeenCalled();
      expect(result.completed).toBe(false);
      expect(result.receivedUsdt).toBe(50);
      expect(result.requiredUsdt).toBe(102.5);
    });

    it('is idempotent for already-FUNDED escrow (no second notify)', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(
        makeSnapshot({ status: EscrowStatus.FUNDED, balance: usdt('102.5') }),
      );

      const result = await rail.checkStatus(makePayment());

      expect(relay.notifyFundedOnly).not.toHaveBeenCalled();
      expect(result.completed).toBe(true);
    });

    it('reports expiry after funding deadline', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(
        makeSnapshot({
          balance: usdt('10'),
          fundingDeadline: Math.floor(Date.now() / 1000) - 60,
        }),
      );

      const result = await rail.checkStatus(makePayment());

      expect(relay.notifyFundedOnly).not.toHaveBeenCalled();
      expect(result.completed).toBe(false);
      expect(result.expired).toBe(true);
    });

    it('reports expiry for CANCELLED/EXPIRED escrow states', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(
        makeSnapshot({ status: EscrowStatus.EXPIRED }),
      );

      const result = await rail.checkStatus(makePayment());

      expect(result.completed).toBe(false);
      expect(result.expired).toBe(true);
    });

    it('returns not-completed when escrow address is missing', async () => {
      await setup();
      const result = await rail.checkStatus(makePayment({ escrowAddress: null }));
      expect(result.completed).toBe(false);
      expect(relay.readEscrow).not.toHaveBeenCalled();
    });
  });
});
