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
  EscrowChainAdapter,
  NormalizedEscrowSummary,
  PrepareEscrowInput,
  PreparedEscrow,
} from "./escrow-chain-adapter";

const CONTRACT_FEE_MODEL: Record<FeeModel, ContractFeeModel> = {
  [FeeModel.SPLIT_50_50]: ContractFeeModel.SPLIT_50_50,
  [FeeModel.BUYER_PAYS]: ContractFeeModel.BUYER_100,
  [FeeModel.SELLER_PAYS]: ContractFeeModel.SELLER_100,
};

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
}
