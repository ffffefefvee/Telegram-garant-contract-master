import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { EscrowService } from './escrow.service';

/**
 * Domain wrapper around `BlockchainModule`. Provides `EscrowService` —
 * the type-safe, USDT-aware facade that `DealService`, `ArbitrationService`,
 * and the Cryptomus webhook depend on.
 */
@Module({
  imports: [BlockchainModule],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
