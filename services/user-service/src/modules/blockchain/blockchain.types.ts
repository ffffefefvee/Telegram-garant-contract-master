/**
 * Domain types for the BlockchainModule. Mirror the on-chain enums from
 * `contracts/contracts/EscrowImplementation.sol` and `EscrowFactory.sol`
 * so backend callers don't have to know magic numbers.
 */

export enum FeeModel {
  SPLIT_50_50 = 0,
  BUYER_100 = 1,
  SELLER_100 = 2,
}

/// Mirrors EscrowImplementation.Status
export enum EscrowStatus {
  NONE = 0,
  AWAITING_FUNDING = 1,
  FUNDED = 2,
  RELEASED = 3,
  REFUNDED = 4,
  DISPUTED = 5,
  RESOLVED = 6,
  CANCELLED = 7,
  EXPIRED = 8,
}

export interface CreateEscrowParams {
  dealId: string;          // 0x-prefixed bytes32
  buyer: string;           // 0x address
  seller: string;          // 0x address
  amount: bigint;          // USDT in 6-decimal wei
  feeModel: FeeModel;
  fundingDeadline: number; // unix seconds
}

export interface EscrowSnapshot {
  address: string;
  status: EscrowStatus;
  buyer: string;
  seller: string;
  amount: bigint;          // expected escrow amount (without fees)
  buyerFee: bigint;
  sellerFee: bigint;
  fundingDeadline: number;
  assignedArbitrator: string;
  balance: bigint;         // current token balance held in clone
}

export interface FeeQuote {
  totalFee: bigint;
  buyerFee: bigint;
  sellerFee: bigint;
  /** Total amount the buyer must transfer in (amount + buyerFee). */
  buyerPayable: bigint;
  /** Net payout the seller will receive on release (amount - sellerFee). */
  sellerNet: bigint;
}

export interface ResolveParams {
  buyerSharePct: number;
  sellerSharePct: number;
}
