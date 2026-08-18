import { BadRequestException, Injectable } from "@nestjs/common";
import { SettlementNetwork } from "../../deal/enums/deal.enum";
import { EscrowChainAdapter } from "./escrow-chain-adapter";
import { PolygonEscrowAdapter } from "./polygon-escrow.adapter";
import { TonEscrowAdapter } from "./ton-escrow.adapter";

@Injectable()
export class SettlementAdapterRegistry {
  private readonly adapters: Map<SettlementNetwork, EscrowChainAdapter>;

  constructor(polygon: PolygonEscrowAdapter, ton: TonEscrowAdapter) {
    this.adapters = new Map<SettlementNetwork, EscrowChainAdapter>([
      [polygon.network, polygon],
      [ton.network, ton],
    ]);
  }

  get(network: SettlementNetwork): EscrowChainAdapter {
    const adapter = this.adapters.get(network);
    if (!adapter) {
      throw new BadRequestException(
        `No settlement adapter registered for ${network}`,
      );
    }
    return adapter;
  }

  isReady(network: SettlementNetwork): boolean {
    return this.get(network).isReady();
  }
}
