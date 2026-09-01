import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../../deal/enums/deal.enum";
import { EscrowSummary } from "../escrow.service";
import {
  ChainTransactionReference,
  NormalizedBalance,
  NormalizedFundingResult,
  NormalizedReconciliationResult,
  QuoteVersion,
  TermsVersion,
  VersionedAsset,
} from "./multichain-domain-contract";

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

export interface EscrowOperationContext extends VersionedAsset {
  dealId: string;
  escrowAddress: string;
  terms: TermsVersion;
  quote: QuoteVersion;
}

export interface ChainActionRequest extends VersionedAsset {
  action: "fund" | "release" | "refund" | "resolve";
  signerRole: "buyer" | "seller" | "arbitrator";
  to: string;
  amountAtomic: string;
  payload: string;
  quoteHash: string;
  transaction: ChainTransactionReference | null;
}

export interface FundingRequestInput {
  context: EscrowOperationContext;
  buyerAddress: string;
  now?: Date;
}

export interface VerifyFundingInput {
  context: EscrowOperationContext;
  transaction: ChainTransactionReference;
  now?: Date;
}

export interface SettlementActionInput {
  context: EscrowOperationContext;
  now?: Date;
}

export interface ResolveActionInput extends SettlementActionInput {
  buyerSharePct: number;
  sellerSharePct: number;
}

export interface BalanceInput {
  dealId: string;
  escrowAddress: string;
  selection: VersionedAsset;
}

export interface ReconciliationInput {
  context: EscrowOperationContext;
  primaryEvidence: ChainTransactionReference | null;
  independentEvidence: ChainTransactionReference | null;
  now?: Date;
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
  buildFundingRequest(input: FundingRequestInput): Promise<ChainActionRequest>;
  verifyFunding(input: VerifyFundingInput): Promise<NormalizedFundingResult>;
  release(input: SettlementActionInput): Promise<ChainActionRequest>;
  refund(input: SettlementActionInput): Promise<ChainActionRequest>;
  resolve(input: ResolveActionInput): Promise<ChainActionRequest>;
  readBalance(input: BalanceInput): Promise<NormalizedBalance>;
  reconcile(
    input: ReconciliationInput,
  ): Promise<NormalizedReconciliationResult>;
  readEscrow(
    dealId: string,
    chainId: string,
    asset: SettlementAsset,
  ): Promise<NormalizedEscrowSummary | null>;
}
