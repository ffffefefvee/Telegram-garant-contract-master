import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { TonUsdtRail } from './ton-usdt.rail';
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

describe('TonUsdtRail', () => {
  let rail: TonUsdtRail;
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
    findIncomingUsdtByMemo: jest.Mock;
  };

  async function setup({
    enabled = true,
    tonEnabled = true,
    float = usdt('2000'),
  }: { enabled?: boolean; tonEnabled?: boolean; float?: bigint } = {}) {
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
      isEnabled: jest.fn(() => tonEnabled),
      getWalletAddress: jest.fn(() => TON_WALLET),
      getJettonMaster: jest.fn(() => TON_WALLET),
      findIncomingUsdtByMemo: jest.fn(async () => ({ receivedUnits: 0n })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TonUsdtRail,
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
    rail = moduleRef.get(TonUsdtRail);
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
      metadata: { memo: 'TG-TEST1234' },
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
    it('is available when configured and float covers the minimum', async () => {
      await setup({ float: usdt('600') });
      await expect(rail.isAvailable()).resolves.toBe(true);
    });

    it('hides itself when the float is below TON_MIN_FLOAT_USDT', async () => {
      await setup({ float: usdt('100') });
      await expect(rail.isAvailable()).resolves.toBe(false);
    });

    it('is unavailable without a TON wallet configured', async () => {
      await setup({ tonEnabled: false });
      await expect(rail.isAvailable()).resolves.toBe(false);
    });

    it('is unavailable in blockchain stub mode', async () => {
      await setup({ enabled: false });
      await expect(rail.isAvailable()).resolves.toBe(false);
    });
  });

  describe('createInvoice', () => {
    it('deploys the escrow and returns TON deposit details with a memo', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue(makeDeal());
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      const invoice = await rail.createInvoice(ctx);

      expect(escrow.createEscrow).toHaveBeenCalledWith(
        'deal-1',
        BUYER,
        SELLER,
        100,
      );
      expect(invoice.depositAddress).toBe(TON_WALLET);
      expect(invoice.escrowAddress).toBe(ESCROW_ADDR);
      expect(invoice.network).toBe('ton');
      expect(invoice.requiredAmount).toBe('102.5');
      expect(invoice.memo).toMatch(/^TG-[A-Z2-9]{8}$/);
      expect(invoice.metadata?.memo).toBe(invoice.memo);
    });

    it('reuses an already-deployed escrow', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue(makeDeal({ escrowAddress: ESCROW_ADDR }));
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      const invoice = await rail.createInvoice(ctx);
      expect(escrow.createEscrow).not.toHaveBeenCalled();
      expect(invoice.escrowAddress).toBe(ESCROW_ADDR);
    });

    it('rejects when the float cannot cover this deal', async () => {
      await setup({ float: usdt('50') });
      dealRepo.findOne.mockResolvedValue(makeDeal({ escrowAddress: ESCROW_ADDR }));
      relay.readEscrow.mockResolvedValue(makeSnapshot());

      await expect(rail.createInvoice(ctx)).rejects.toThrow(BadRequestException);
      expect(escrow.createEscrow).not.toHaveBeenCalled();
    });

    it('rejects when buyer or seller wallet is missing', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue(
        makeDeal({ buyer: { walletAddress: null } as never }),
      );
      await expect(rail.createInvoice(ctx)).rejects.toThrow(BadRequestException);
    });

    it('rejects non-USDT deals without a locked USDT amount', async () => {
      await setup();
      dealRepo.findOne.mockResolvedValue(
        makeDeal({ currency: Currency.RUB as never }),
      );
      await expect(rail.createInvoice(ctx)).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkStatus', () => {
    it('funds the escrow from the float once the full amount arrived on TON', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot());
      tonApi.findIncomingUsdtByMemo.mockResolvedValue({
        receivedUnits: usdt('102.5'),
        lastTxHash: 'ton-event-1',
      });

      const result = await rail.checkStatus(makePayment());

      expect(tonApi.findIncomingUsdtByMemo).toHaveBeenCalledWith(
        'TG-TEST1234',
        expect.any(Number),
      );
      expect(relay.forwardAndFund).toHaveBeenCalledWith(
        ESCROW_ADDR,
        usdt('102.5'),
      );
      expect(result.completed).toBe(true);
      expect(result.txId).toBe('0xnotify');
      expect(result.fundedUsdt).toBe(102.5);
    });

    it('reports partial funding without forwarding', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot());
      tonApi.findIncomingUsdtByMemo.mockResolvedValue({
        receivedUnits: usdt('50'),
      });

      const result = await rail.checkStatus(makePayment());
      expect(result.completed).toBe(false);
      expect(result.receivedUsdt).toBe(50);
      expect(result.requiredUsdt).toBe(102.5);
      expect(relay.forwardAndFund).not.toHaveBeenCalled();
    });

    it('is idempotent for an already-FUNDED escrow', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(
        makeSnapshot({ status: EscrowStatus.FUNDED, balance: usdt('102.5') }),
      );

      const result = await rail.checkStatus(makePayment());
      expect(result.completed).toBe(true);
      expect(relay.forwardAndFund).not.toHaveBeenCalled();
      expect(tonApi.findIncomingUsdtByMemo).not.toHaveBeenCalled();
    });

    it('reports expiry after the funding deadline', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(
        makeSnapshot({ fundingDeadline: Math.floor(Date.now() / 1000) - 10 }),
      );
      tonApi.findIncomingUsdtByMemo.mockResolvedValue({ receivedUnits: 0n });

      const result = await rail.checkStatus(makePayment());
      expect(result.completed).toBe(false);
      expect(result.expired).toBe(true);
    });

    it('stays pending (no crash) when funding from the float fails', async () => {
      await setup();
      relay.readEscrow.mockResolvedValue(makeSnapshot());
      relay.forwardAndFund.mockRejectedValue(new Error('Hot-wallet balance short'));
      tonApi.findIncomingUsdtByMemo.mockResolvedValue({
        receivedUnits: usdt('102.5'),
      });

      const result = await rail.checkStatus(makePayment());
      expect(result.completed).toBe(false);
      expect(result.receivedUsdt).toBe(102.5);
    });

    it('does nothing without a memo or escrow address', async () => {
      await setup();
      const result = await rail.checkStatus(
        makePayment({ metadata: {} as never }),
      );
      expect(result.completed).toBe(false);
      expect(relay.readEscrow).not.toHaveBeenCalled();
    });
  });
});

describe('TonApiService parsing', () => {
  const config = {
    get: (key: string, d?: string) => {
      if (key === 'TON_WALLET_ADDRESS') return TON_WALLET;
      return d;
    },
  } as never;

  it('converts friendly addresses to raw form', () => {
    expect(TonApiService.friendlyToRaw(TON_WALLET)).toBe(
      '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe',
    );
    expect(TonApiService.friendlyToRaw('0:ABC')).toBeNull();
    expect(TonApiService.friendlyToRaw('')).toBeNull();
    expect(
      TonApiService.friendlyToRaw(
        '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe',
      ),
    ).toBe('0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe');
  });

  it('sums only finalized matching transfers', () => {
    const service = new TonApiService(config);
    const walletRaw = TonApiService.friendlyToRaw(TON_WALLET)!;
    const transfer = (amount: string, comment: string, inProgress = false) => ({
      event_id: `evt-${amount}-${comment}`,
      timestamp: 1,
      in_progress: inProgress,
      actions: [
        {
          type: 'JettonTransfer',
          status: 'ok',
          JettonTransfer: {
            recipient: { address: walletRaw },
            amount,
            comment,
            jetton: { address: walletRaw, decimals: 6, symbol: 'USDT' },
          },
        },
      ],
    });

    const result = service.sumMatchingTransfers(
      [
        transfer('50000000', 'TG-AAAA2222'),
        transfer('52500000', 'TG-AAAA2222'),
        transfer('99000000', 'TG-OTHER999'), // different memo
        transfer('1000000', 'TG-AAAA2222', true), // not finalized
      ],
      'TG-AAAA2222',
    );

    expect(result.receivedUnits).toBe(102500000n);
    expect(result.lastTxHash).toBe('evt-52500000-TG-AAAA2222');
  });

  it('ignores transfers to other recipients or other jettons', () => {
    const service = new TonApiService(config);
    const walletRaw = TonApiService.friendlyToRaw(TON_WALLET)!;
    const otherRaw = '0:' + 'f'.repeat(64);

    const result = service.sumMatchingTransfers(
      [
        {
          event_id: 'evt-1',
          timestamp: 1,
          actions: [
            {
              type: 'JettonTransfer',
              status: 'ok',
              JettonTransfer: {
                recipient: { address: otherRaw },
                amount: '1000000',
                comment: 'TG-AAAA2222',
                jetton: { address: walletRaw },
              },
            },
            {
              type: 'JettonTransfer',
              status: 'ok',
              JettonTransfer: {
                recipient: { address: walletRaw },
                amount: '1000000',
                comment: 'TG-AAAA2222',
                jetton: { address: otherRaw },
              },
            },
          ],
        },
      ],
      'TG-AAAA2222',
    );
    expect(result.receivedUnits).toBe(0n);
  });
});
