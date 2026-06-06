import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { BlockchainModule } from './blockchain.module';
import { BlockchainConfig } from './blockchain.config';
import { BlockchainProvider } from './blockchain.provider';
import { Erc20Client } from './erc20.client';
import { FactoryClient } from './factory.client';
import { RelayService } from './relay.service';
import { FeeModel, EscrowStatus } from './blockchain.types';

/**
 * Smoke tests for BlockchainModule. These run in "stub mode" — i.e. without
 * a connected JSON-RPC node — and verify that:
 *   1. The module bootstraps cleanly when env vars are missing.
 *   2. Read methods return safe zero values instead of crashing.
 *   3. Pure helpers (toBytes32, stub fee math) match contract semantics.
 *
 * Integration tests with a real Hardhat node will live alongside the
 * Cryptomus webhook PR, where the full relay→fund flow can be exercised.
 */
describe('BlockchainModule (stub mode)', () => {
  let moduleRef: TestingModule;
  let cfg: BlockchainConfig;
  let provider: BlockchainProvider;
  let erc20: Erc20Client;
  let factory: FactoryClient;
  let relay: RelayService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({})],
        }),
        BlockchainModule,
      ],
    }).compile();

    cfg = moduleRef.get(BlockchainConfig);
    provider = moduleRef.get(BlockchainProvider);
    erc20 = moduleRef.get(Erc20Client);
    factory = moduleRef.get(FactoryClient);
    relay = moduleRef.get(RelayService);
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('config & bootstrap', () => {
    it('disabled when env vars are missing', () => {
      expect(cfg.enabled).toBe(false);
    });

    it('provider not ready in stub mode', () => {
      expect(provider.isReady).toBe(false);
    });

    it('signerAddress falls back to ZeroAddress', () => {
      expect(provider.signerAddress).toBe(ethers.ZeroAddress);
    });

    it('throws when accessing the provider via getter in stub mode', () => {
      expect(() => provider.provider).toThrow(/not initialised/);
      expect(() => provider.signer).toThrow(/not initialised/);
    });
  });

  describe('Erc20Client', () => {
    it('balanceOf returns 0n in stub mode', async () => {
      await expect(erc20.balanceOf(ethers.ZeroAddress)).resolves.toBe(0n);
    });

    it('decimals returns 6 fallback', async () => {
      await expect(erc20.decimals()).resolves.toBe(6);
    });

    it('transfer throws when not ready', async () => {
      await expect(erc20.transfer(ethers.ZeroAddress, 1n)).rejects.toThrow(/not ready/);
    });
  });

  describe('FactoryClient stub fee math', () => {
    it('5% flat (above-threshold simulation in stub) for SPLIT_50_50', async () => {
      const q = await factory.quoteFee(100_000_000n, FeeModel.SPLIT_50_50);
      expect(q.totalFee).toBe(5_000_000n);
      expect(q.buyerFee).toBe(2_500_000n);
      expect(q.sellerFee).toBe(2_500_000n);
      expect(q.buyerPayable).toBe(102_500_000n);
      expect(q.sellerNet).toBe(97_500_000n);
    });

    it('BUYER_100 puts entire fee on buyer', async () => {
      const q = await factory.quoteFee(100_000_000n, FeeModel.BUYER_100);
      expect(q.buyerFee).toBe(5_000_000n);
      expect(q.sellerFee).toBe(0n);
    });

    it('SELLER_100 puts entire fee on seller', async () => {
      const q = await factory.quoteFee(100_000_000n, FeeModel.SELLER_100);
      expect(q.buyerFee).toBe(0n);
      expect(q.sellerFee).toBe(5_000_000n);
    });

    it('predictAddress returns ZeroAddress in stub mode', async () => {
      await expect(factory.predictAddress('0x' + '1'.repeat(64))).resolves.toBe(
        ethers.ZeroAddress,
      );
    });
  });

  describe('RelayService', () => {
    it('hot wallet balance is 0 in stub mode', async () => {
      await expect(relay.hotWalletBalance()).resolves.toBe(0n);
    });

    it('forwardAndFund refuses in stub mode', async () => {
      await expect(
        relay.forwardAndFund(ethers.ZeroAddress, 1n),
      ).rejects.toThrow(/not ready/);
    });

    it('toBytes32 hashes string dealIds', () => {
      const id = RelayService.toBytes32('deal-uuid-abc');
      expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('toBytes32 returns input when already bytes32', () => {
      const raw = '0x' + '7'.repeat(64);
      expect(RelayService.toBytes32(raw)).toBe(raw);
    });

    it('isFundedOrLater recognises post-fund statuses', () => {
      const baseSnapshot = {
        address: ethers.ZeroAddress,
        buyer: ethers.ZeroAddress,
        seller: ethers.ZeroAddress,
        amount: 0n,
        buyerFee: 0n,
        sellerFee: 0n,
        fundingDeadline: 0,
        assignedArbitrator: ethers.ZeroAddress,
        balance: 0n,
      };
      expect(
        relay.isFundedOrLater({ ...baseSnapshot, status: EscrowStatus.AWAITING_FUNDING }),
      ).toBe(false);
      expect(relay.isFundedOrLater({ ...baseSnapshot, status: EscrowStatus.FUNDED })).toBe(true);
      expect(relay.isFundedOrLater({ ...baseSnapshot, status: EscrowStatus.RELEASED })).toBe(true);
      expect(relay.isFundedOrLater({ ...baseSnapshot, status: EscrowStatus.RESOLVED })).toBe(true);
      expect(relay.isFundedOrLater({ ...baseSnapshot, status: EscrowStatus.CANCELLED })).toBe(false);
    });
  });

  describe('BlockchainConfig env reading', () => {
    it('reads env vars when present', async () => {
      const m = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                BLOCKCHAIN_RPC_URL: 'https://rpc',
                BLOCKCHAIN_PRIVATE_KEY: '0x' + '1'.repeat(64),
                BLOCKCHAIN_CHAIN_ID: '137',
                ESCROW_FACTORY_ADDRESS: ethers.ZeroAddress,
                PLATFORM_TREASURY_ADDRESS: ethers.ZeroAddress,
                ARBITRATOR_REGISTRY_ADDRESS: ethers.ZeroAddress,
                USDT_CONTRACT_ADDRESS: ethers.ZeroAddress,
              }),
            ],
          }),
        ],
        providers: [BlockchainConfig],
      }).compile();
      const c = m.get(BlockchainConfig);
      expect(c.enabled).toBe(true);
      expect(c.chainId).toBe(137);
      expect(c.rpcUrl).toBe('https://rpc');
      await m.close();
    });
  });
});
