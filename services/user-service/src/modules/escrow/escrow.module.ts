import { Module } from "@nestjs/common";
import { BlockchainModule } from "../blockchain/blockchain.module";
import { EscrowService } from "./escrow.service";
import { PolygonEscrowAdapter } from "./adapters/polygon-escrow.adapter";
import { TonEscrowAdapter } from "./adapters/ton-escrow.adapter";
import { SettlementAdapterRegistry } from "./adapters/settlement-adapter.registry";
import { TonNativeEscrowComposer } from "./adapters/ton-native-escrow-composer";

/**
 * Domain wrapper around `BlockchainModule`. Provides `EscrowService` —
 * the type-safe, USDT-aware facade that `DealService`, `ArbitrationService`,
 * and the Cryptomus webhook depend on.
 */
@Module({
  imports: [BlockchainModule],
  providers: [
    EscrowService,
    PolygonEscrowAdapter,
    TonEscrowAdapter,
    TonNativeEscrowComposer,
    SettlementAdapterRegistry,
  ],
  exports: [
    EscrowService,
    SettlementAdapterRegistry,
    TonEscrowAdapter,
    TonNativeEscrowComposer,
  ],
})
export class EscrowModule {}
