import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ethers } from 'ethers';
import { EscrowService } from './escrow.service';
import { EscrowModule } from './escrow.module';
import { FeeModel } from '../blockchain/blockchain.types';

describe('EscrowService (stub mode)', () => {
  let moduleRef: TestingModule;
  let service: EscrowService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({})] }),
        EscrowModule,
      ],
    }).compile();
    service = moduleRef.get(EscrowService);
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('isEnabled', () => {
    it('returns false in stub mode', () => {
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('toWei', () => {
    it('converts whole USDT to 6-decimal wei', () => {
      expect(service.toWei(100)).toBe(100_000_000n);
    });

    it('preserves cents', () => {
      expect(service.toWei(123.45)).toBe(123_450_000n);
    });

    it('rounds to 6 decimals', () => {
      expect(service.toWei(0.0000001)).toBe(0n);
      expect(service.toWei(0.000001)).toBe(1n);
    });

    it('rejects negative', () => {
      expect(() => service.toWei(-1)).toThrow(BadRequestException);
    });

    it('rejects NaN', () => {
      expect(() => service.toWei(NaN)).toThrow(BadRequestException);
    });
  });

  describe('quote', () => {
    it('returns 5% fee for SPLIT_50_50 by default', async () => {
      const q = await service.quote(100);
      expect(q.totalFee).toBe(5_000_000n);
      expect(q.buyerFee).toBe(2_500_000n);
      expect(q.sellerFee).toBe(2_500_000n);
      expect(q.buyerPayable).toBe(102_500_000n);
      expect(q.sellerNet).toBe(97_500_000n);
    });

    it('puts entire fee on buyer for BUYER_100', async () => {
      const q = await service.quote(100, FeeModel.BUYER_100);
      expect(q.buyerFee).toBe(5_000_000n);
      expect(q.sellerFee).toBe(0n);
    });
  });

  describe('createEscrow address validation', () => {
    const validAddress = '0x' + 'a'.repeat(40);
    const otherAddress = '0x' + 'b'.repeat(40);

    it('rejects invalid buyer address', async () => {
      await expect(
        service.createEscrow('deal-1', 'not-an-address', validAddress, 100),
      ).rejects.toThrow(/buyerWallet is not a valid/);
    });

    it('rejects invalid seller address', async () => {
      await expect(
        service.createEscrow('deal-1', validAddress, '0xinvalid', 100),
      ).rejects.toThrow(/sellerWallet is not a valid/);
    });

    it('rejects zero address', async () => {
      await expect(
        service.createEscrow('deal-1', validAddress, ethers.ZeroAddress, 100),
      ).rejects.toThrow(/sellerWallet cannot be the zero address/);
    });

    it('rejects non-positive amount', async () => {
      await expect(
        service.createEscrow('deal-1', validAddress, otherAddress, 0),
      ).rejects.toThrow(/amount must be positive/);
    });

    it('returns deterministic placeholder address in stub mode', async () => {
      const result = await service.createEscrow('deal-fixed-id', validAddress, otherAddress, 100);
      expect(result.escrowAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(result.transactionHash).toBe('0x' + '0'.repeat(64));
      expect(result.buyerFee).toBe(2_500_000n);
      expect(result.sellerFee).toBe(2_500_000n);

      // Same dealId → same placeholder.
      const r2 = await service.createEscrow('deal-fixed-id', validAddress, otherAddress, 100);
      expect(r2.escrowAddress).toBe(result.escrowAddress);

      // Different dealId → different placeholder.
      const r3 = await service.createEscrow('deal-other', validAddress, otherAddress, 100);
      expect(r3.escrowAddress).not.toBe(result.escrowAddress);
    });
  });

  describe('forwardAndFund / assignArbitrator / expireUnfunded (stub mode)', () => {
    it('forwardAndFund refuses when escrow not deployed', async () => {
      await expect(service.forwardAndFund('deal-no-escrow', 100)).rejects.toThrow(
        /Escrow not deployed/,
      );
    });

    it('expireUnfunded refuses when escrow not deployed', async () => {
      await expect(service.expireUnfunded('deal-no-escrow')).rejects.toThrow(
        /Escrow not deployed/,
      );
    });

    it('assignArbitrator validates address format before checking escrow', async () => {
      await expect(
        service.assignArbitrator('deal-no-escrow', 'bad-address'),
      ).rejects.toThrow(/arbitratorWallet is not a valid/);
    });
  });

  describe('predictAddress', () => {
    it('returns ZeroAddress in stub mode', async () => {
      await expect(service.predictAddress('deal-1')).resolves.toBe(ethers.ZeroAddress);
    });
  });

  describe('getSummary', () => {
    it('returns null when escrow not deployed (stub)', async () => {
      await expect(service.getSummary('deal-1')).resolves.toBeNull();
    });
  });
});
