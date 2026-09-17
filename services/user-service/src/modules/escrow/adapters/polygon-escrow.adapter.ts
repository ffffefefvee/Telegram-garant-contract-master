import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ethers } from "ethers";
import { BlockchainConfig } from "../../blockchain/blockchain.config";
import { FeeModel as ContractFeeModel } from "../../blockchain/blockchain.types";
import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../../deal/enums/deal.enum";
import { EscrowService } from "../escrow.service";
import {
  BalanceInput,
  ChainActionRequest,
  EscrowChainAdapter,
  FundingRequestInput,
  NormalizedEscrowSummary,
  PrepareEscrowInput,
  PreparedEscrow,
  ReconciliationInput,
  ResolveActionInput,
  SettlementActionInput,
  VerifyFundingInput,
} from "./escrow-chain-adapter";
import {
  assertSameSettlementIdentity,
  assertValidChainTransactionReference,
  assertValidQuoteVersion,
  assertValidVersionedAsset,
  MULTICHAIN_DOMAIN_VERSION,
  NormalizedBalance,
  NormalizedFundingResult,
  NormalizedFundingStatus,
  NormalizedReconciliationResult,
  NormalizedSettlementStatus,
  PayoutAvailability,
} from "./multichain-domain-contract";

const CONTRACT_FEE_MODEL: Record<FeeModel, ContractFeeModel> = {
  [FeeModel.SPLIT_50_50]: ContractFeeModel.SPLIT_50_50,
  [FeeModel.BUYER_PAYS]: ContractFeeModel.BUYER_100,
  [FeeModel.SELLER_PAYS]: ContractFeeModel.SELLER_100,
};

const ERC20_INTERFACE = new ethers.Interface([
  "function transfer(address to,uint256 amount) returns (bool)",
]);
const ESCROW_INTERFACE = new ethers.Interface([
  "function release()",
  "function refund()",
  "function resolve(uint16 buyerSharePct,uint16 sellerSharePct)",
]);

@Injectable()
export class PolygonEscrowAdapter implements EscrowChainAdapter {
  readonly network = SettlementNetwork.POLYGON;

  constructor(
    private readonly escrow: EscrowService,
    private readonly config: BlockchainConfig,
  ) {}

  isReady(): boolean {
    return this.escrow.isEnabled() && this.config.chainId !== null;
  }

  assertSupports(chainId: string, asset: SettlementAsset): void {
    if (asset !== SettlementAsset.POLYGON_USDT) {
      throw new BadRequestException(
        `Polygon adapter does not support ${asset}`,
      );
    }
    if (this.config.chainId === null) {
      throw new ServiceUnavailableException(
        "Polygon settlement configuration is incomplete",
      );
    }
    if (chainId !== String(this.config.chainId)) {
      throw new BadRequestException(
        `Polygon chain ${chainId} does not match configured chain ${this.config.chainId}`,
      );
    }
  }

  normalizeAddress(address: string): string {
    if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
      throw new BadRequestException(`Invalid Polygon address: ${address}`);
    }
    return ethers.getAddress(address);
  }

  async prepareEscrow(input: PrepareEscrowInput): Promise<PreparedEscrow> {
    if (!this.isReady()) {
      throw new ServiceUnavailableException(
        "Polygon escrow adapter is not ready",
      );
    }
    this.assertSupports(input.chainId, input.asset);

    const result = await this.escrow.createEscrow(
      input.dealId,
      this.normalizeAddress(input.buyerAddress),
      this.normalizeAddress(input.sellerAddress),
      input.amount,
      CONTRACT_FEE_MODEL[input.feeModel],
      input.fundingDeadlineSec,
    );

    return {
      network: this.network,
      chainId: input.chainId,
      asset: input.asset,
      assetContract: this.normalizeAddress(this.config.tokenAddress),
      escrowAddress: this.normalizeAddress(result.escrowAddress),
      transactionHash: result.transactionHash,
      buyerFeeAtomic: result.buyerFee.toString(),
      sellerFeeAtomic: result.sellerFee.toString(),
    };
  }

  async buildFundingRequest(
    input: FundingRequestInput,
  ): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, true);
    this.normalizeAddress(input.buyerAddress);
    const escrowAddress = this.normalizeAddress(input.context.escrowAddress);
    return this.actionRequest(
      input.context,
      "fund",
      "buyer",
      this.normalizeAddress(this.config.tokenAddress),
      input.context.quote.totalFundingAtomic,
      ERC20_INTERFACE.encodeFunctionData("transfer", [
        escrowAddress,
        BigInt(input.context.quote.totalFundingAtomic),
      ]),
    );
  }

  async verifyFunding(
    input: VerifyFundingInput,
  ): Promise<NormalizedFundingResult> {
    this.assertOperationContext(input.context, input.now, false);
    assertValidChainTransactionReference(input.transaction, input.context);
    const summary = await this.readEscrow(
      input.context.dealId,
      input.context.chainId,
      input.context.asset,
    );
    const selection = this.selection(input.context);
    if (!summary) {
      return {
        ...selection,
        status: NormalizedFundingStatus.UNAVAILABLE,
        expectedAtomic: input.context.quote.totalFundingAtomic,
        observedAtomic: "0",
        finalized: false,
        transaction: input.transaction,
        evidenceHash: null,
        unavailableReason: "POLYGON_ESCROW_STATE_UNAVAILABLE",
      };
    }
    const funded = [
      "funded",
      "released",
      "refunded",
      "disputed",
      "resolved",
    ].includes(summary.status);
    return {
      ...selection,
      status: funded
        ? NormalizedFundingStatus.OBSERVED
        : summary.status === "expired"
          ? NormalizedFundingStatus.EXPIRED
          : NormalizedFundingStatus.AWAITING_FUNDING,
      expectedAtomic: input.context.quote.totalFundingAtomic,
      observedAtomic: summary.balanceAtomic,
      finalized: false,
      transaction: input.transaction,
      evidenceHash: null,
      unavailableReason: funded ? "POLYGON_FINALITY_GATE_PENDING" : null,
    };
  }

  async release(input: SettlementActionInput): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, false);
    return this.actionRequest(
      input.context,
      "release",
      "buyer",
      this.normalizeAddress(input.context.escrowAddress),
      "0",
      ESCROW_INTERFACE.encodeFunctionData("release"),
    );
  }

  async refund(input: SettlementActionInput): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, false);
    return this.actionRequest(
      input.context,
      "refund",
      "seller",
      this.normalizeAddress(input.context.escrowAddress),
      "0",
      ESCROW_INTERFACE.encodeFunctionData("refund"),
    );
  }

  async resolve(input: ResolveActionInput): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, false);
    if (
      !Number.isInteger(input.buyerSharePct) ||
      !Number.isInteger(input.sellerSharePct) ||
      input.buyerSharePct < 0 ||
      input.sellerSharePct < 0 ||
      input.buyerSharePct + input.sellerSharePct !== 100
    ) {
      throw new BadRequestException(
        "Resolution shares must be integers summing to 100",
      );
    }
    return this.actionRequest(
      input.context,
      "resolve",
      "arbitrator",
      this.normalizeAddress(input.context.escrowAddress),
      "0",
      ESCROW_INTERFACE.encodeFunctionData("resolve", [
        input.buyerSharePct,
        input.sellerSharePct,
      ]),
    );
  }

  async readBalance(input: BalanceInput): Promise<NormalizedBalance> {
    this.assertSelection(input.selection);
    if (this.normalizeAddress(input.escrowAddress) === ethers.ZeroAddress) {
      throw new BadRequestException("Invalid Polygon escrow address");
    }
    const summary = await this.readEscrow(
      input.dealId,
      input.selection.chainId,
      input.selection.asset,
    );
    return {
      ...this.selection(input.selection),
      available: summary !== null,
      balanceAtomic: summary?.balanceAtomic ?? "0",
      finalized: false,
      observedAt: new Date().toISOString(),
      evidenceHash: null,
      unavailableReason: summary
        ? "POLYGON_FINALITY_GATE_PENDING"
        : "POLYGON_ESCROW_STATE_UNAVAILABLE",
    };
  }

  async reconcile(
    input: ReconciliationInput,
  ): Promise<NormalizedReconciliationResult> {
    this.assertOperationContext(input.context, input.now, false);
    if (input.primaryEvidence) {
      assertValidChainTransactionReference(
        input.primaryEvidence,
        input.context,
      );
    }
    if (input.independentEvidence) {
      assertValidChainTransactionReference(
        input.independentEvidence,
        input.context,
      );
    }
    const summary = await this.readEscrow(
      input.context.dealId,
      input.context.chainId,
      input.context.asset,
    );
    const terminal =
      summary !== null &&
      ["released", "refunded", "resolved"].includes(summary.status);
    const liabilities = terminal
      ? 0n
      : BigInt(input.context.quote.totalFundingAtomic);
    const assets = BigInt(summary?.balanceAtomic ?? "0");
    return {
      ...this.selection(input.context),
      fundingStatus: summary
        ? NormalizedFundingStatus.OBSERVED
        : NormalizedFundingStatus.UNAVAILABLE,
      settlementStatus: terminal
        ? NormalizedSettlementStatus.PENDING
        : NormalizedSettlementStatus.NOT_STARTED,
      payoutAvailability: terminal
        ? PayoutAvailability.PROCESSING
        : PayoutAvailability.LOCKED,
      assetsAtomic: assets.toString(),
      liabilitiesAtomic: liabilities.toString(),
      deltaAtomic: (assets - liabilities).toString(),
      finalized: false,
      primaryEvidenceHash: null,
      independentEvidenceHash: null,
      unavailableReason: "POLYGON_INDEPENDENT_RECONCILIATION_GATE_PENDING",
    };
  }

  async readEscrow(
    dealId: string,
    chainId: string,
    asset: SettlementAsset,
  ): Promise<NormalizedEscrowSummary | null> {
    if (!this.isReady()) return null;
    this.assertSupports(chainId, asset);
    const summary = await this.escrow.getSummary(dealId);
    if (!summary) return null;

    return {
      network: this.network,
      chainId,
      asset,
      address: this.normalizeAddress(summary.address),
      status: summary.status,
      buyerAddress: this.normalizeAddress(summary.buyer),
      sellerAddress: this.normalizeAddress(summary.seller),
      amountAtomic: summary.amount.toString(),
      buyerFeeAtomic: summary.buyerFee.toString(),
      sellerFeeAtomic: summary.sellerFee.toString(),
      fundingDeadline: summary.fundingDeadline,
      assignedArbitratorAddress:
        summary.assignedArbitrator === ethers.ZeroAddress
          ? ethers.ZeroAddress
          : this.normalizeAddress(summary.assignedArbitrator),
      balanceAtomic: summary.balance.toString(),
    };
  }

  private assertOperationContext(
    context: FundingRequestInput["context"],
    now: Date | undefined,
    requireUnexpired: boolean,
  ): void {
    this.assertSelection(context);
    assertSameSettlementIdentity(context, context.quote);
    assertValidQuoteVersion(
      context.quote,
      context.terms,
      now ?? new Date(),
      requireUnexpired,
    );
    if (
      this.normalizeAddress(context.assetContract ?? "") !==
        this.normalizeAddress(this.config.tokenAddress) ||
      this.normalizeAddress(context.quote.assetContract ?? "") !==
        this.normalizeAddress(this.config.tokenAddress)
    ) {
      throw new BadRequestException(
        "Quote asset contract does not match the Polygon allowlist",
      );
    }
    this.normalizeAddress(context.escrowAddress);
  }

  private assertSelection(input: {
    domainVersion: 1;
    network: SettlementNetwork;
    chainId: string;
    asset: SettlementAsset;
    assetContract: string | null;
    decimals: number;
  }): void {
    assertValidVersionedAsset(input);
    if (input.network !== this.network) {
      throw new BadRequestException(
        "Polygon adapter received a different settlement network",
      );
    }
    this.assertSupports(input.chainId, input.asset);
    if (!input.assetContract) {
      throw new BadRequestException("Polygon asset contract is required");
    }
    if (
      this.normalizeAddress(input.assetContract) !==
      this.normalizeAddress(this.config.tokenAddress)
    ) {
      throw new BadRequestException(
        "Polygon asset contract is not allowlisted",
      );
    }
  }

  private selection(input: {
    network: SettlementNetwork;
    chainId: string;
    asset: SettlementAsset;
    assetContract: string | null;
    decimals: number;
  }) {
    return {
      domainVersion: MULTICHAIN_DOMAIN_VERSION,
      network: this.network,
      chainId: input.chainId,
      asset: input.asset,
      assetContract: this.normalizeAddress(input.assetContract ?? ""),
      decimals: input.decimals,
    } as const;
  }

  private actionRequest(
    context: FundingRequestInput["context"],
    action: ChainActionRequest["action"],
    signerRole: ChainActionRequest["signerRole"],
    to: string,
    amountAtomic: string,
    payload: string,
  ): ChainActionRequest {
    return {
      ...this.selection(context),
      action,
      signerRole,
      to,
      amountAtomic,
      payload,
      quoteHash: context.quote.hash,
      transaction: null,
    };
  }
}
