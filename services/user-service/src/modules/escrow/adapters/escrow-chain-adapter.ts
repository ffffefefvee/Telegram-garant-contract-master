import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../../deal/enums/deal.enum";
import { EscrowSummary } from "../escrow.service";

export interface PrepareEscrowInput {
  dealId: string;
  chainId: string;
  asset: SettlementAsset;
  buyerAddress: string;
  sellerAddress: string;
  amount: number;
  feeModel: FeeModel;
  fundingDeadlineSec?: number;
}

export interface PreparedEscrow {
  network: SettlementNetwork;
  chainId: string;
  asset: SettlementAsset;
  assetContract: string | null;
  escrowAddress: string;
  transactionHash: string;
  buyerFeeAtomic: string;
  sellerFeeAtomic: string;
}

export interface NormalizedEscrowSummary {
  network: SettlementNetwork;
  chainId: string;
  asset: SettlementAsset;
  address: string;
  status: EscrowSummary["status"];
  buyerAddress: string;
  sellerAddress: string;
  amountAtomic: string;
  buyerFeeAtomic: string;
  sellerFeeAtomic: string;
  fundingDeadline: number;
  assignedArbitratorAddress: string;
  balanceAtomic: string;
}

/**
 * Chain-specific escrow boundary. Implementations must preserve the selected
 * network and asset; conversion and bridging do not belong in this contract.
 */
export interface EscrowChainAdapter {
  readonly network: SettlementNetwork;

  isReady(): boolean;
  assertSupports(chainId: string, asset: SettlementAsset): void;
  normalizeAddress(address: string): string;
  prepareEscrow(input: PrepareEscrowInput): Promise<PreparedEscrow>;
  readEscrow(
    dealId: string,
    chainId: string,
    asset: SettlementAsset,
  ): Promise<NormalizedEscrowSummary | null>;
}
