import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BlockchainConfig } from './blockchain.config';
import { BlockchainProvider } from './blockchain.provider';
import { Erc20Client } from './erc20.client';
import { FactoryClient } from './factory.client';
import { EscrowClient } from './escrow.client';
import { TreasuryClient } from './treasury.client';
import { RegistryClient } from './registry.client';
import { RelayService } from './relay.service';

/**
 * BlockchainModule — single source of truth for on-chain interactions.
 *
 * All ABIs are imported from `./abi/*.json` (extracted from `contracts/artifacts`).
 * The platform hot-wallet signer is held by `BlockchainProvider`. Per-arbitrator
 * and per-user signing happens client-side (mini-app) — this module never
 * holds user keys.
 *
 * If the required env vars (BLOCKCHAIN_RPC_URL, BLOCKCHAIN_PRIVATE_KEY,
 * ESCROW_FACTORY_ADDRESS, PLATFORM_TREASURY_ADDRESS, ARBITRATOR_REGISTRY_ADDRESS,
 * USDT_CONTRACT_ADDRESS) are missing, the module starts in stub mode:
 * `BlockchainProvider.isReady === false`, all clients return zero/empty
 * values, write methods throw. Useful for local dev without a Hardhat node.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    BlockchainConfig,
    BlockchainProvider,
    Erc20Client,
    FactoryClient,
    EscrowClient,
    TreasuryClient,
    RegistryClient,
    RelayService,
  ],
  exports: [
    BlockchainConfig,
    BlockchainProvider,
    Erc20Client,
    FactoryClient,
    EscrowClient,
    TreasuryClient,
    RegistryClient,
    RelayService,
  ],
})
export class BlockchainModule {}
