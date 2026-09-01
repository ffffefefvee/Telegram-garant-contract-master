import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { SettlementAsset, SettlementNetwork } from "../../deal/enums/deal.enum";
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
  VersionedAsset,
} from "./multichain-domain-contract";
import { normalizeTonAddress } from "./ton-address";
import {
  TonEscrowArtifactStatus,
  verifyTonEscrowArtifact,
} from "./ton-escrow-artifact";

const TON_ASSETS = new Set<SettlementAsset>([
  SettlementAsset.TON_USDT,
  SettlementAsset.TON_NATIVE,
]);

/**
 * Fail-closed native TON adapter boundary. It deliberately cannot move money
 * until the full lifecycle indexer, recovery controls and audited release are
 * connected. Funding ingestion alone is intentionally insufficient.
 */
@Injectable()
export class TonEscrowAdapter implements EscrowChainAdapter {
  readonly network = SettlementNetwork.TON;
  readonly nativeArtifact: TonEscrowArtifactStatus;

  constructor(config: ConfigService) {
    const artifactPath = config.get<string>(
      "TON_NATIVE_ESCROW_ARTIFACT_PATH",
      "",
    );
    const artifactSha256 = config.get<string>(
      "TON_NATIVE_ESCROW_ARTIFACT_SHA256",
      "",
    );
    const codeHash = config.get<string>("TON_NATIVE_ESCROW_CODE_HASH", "");

    if (!artifactPath || !artifactSha256 || !codeHash) {
      this.nativeArtifact = {
        verified: false,
        reason: "artifact_configuration_missing",
      };
      return;
    }

    try {
      this.nativeArtifact = verifyTonEscrowArtifact(
        readFileSync(artifactPath),
        artifactSha256,
        codeHash,
      );
    } catch {
      this.nativeArtifact = {
        verified: false,
        reason: "artifact_unreadable",
      };
    }
  }

  isReady(): boolean {
    // Artifact verification is necessary but not sufficient. Keep this false
    // until every lifecycle action, independent-provider reconciliation,
    // recovery tooling, testnet drills and the external audit are complete.
    return false;
  }

  isNativeArtifactVerified(): boolean {
    return this.nativeArtifact.verified;
  }

  assertSupports(chainId: string, asset: SettlementAsset): void {
    if (chainId !== "mainnet" && chainId !== "testnet") {
      throw new BadRequestException(`Unsupported TON network: ${chainId}`);
    }
    if (!TON_ASSETS.has(asset)) {
      throw new BadRequestException(`TON adapter does not support ${asset}`);
    }
  }

  normalizeAddress(address: string): string {
    const normalized = normalizeTonAddress(address);
    if (!normalized) {
      throw new BadRequestException("Invalid TON address");
    }
    return normalized;
  }

  async prepareEscrow(input: PrepareEscrowInput): Promise<PreparedEscrow> {
    this.assertSupports(input.chainId, input.asset);
    throw new ServiceUnavailableException(
      "Native TON escrow is not enabled yet",
    );
  }

  async buildFundingRequest(
    input: FundingRequestInput,
  ): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, true);
    throw this.unavailable();
  }

  async verifyFunding(
    input: VerifyFundingInput,
  ): Promise<NormalizedFundingResult> {
    this.assertOperationContext(input.context, input.now, false);
    assertValidChainTransactionReference(input.transaction, input.context);
    return {
      ...this.selection(input.context),
      status: NormalizedFundingStatus.UNAVAILABLE,
      expectedAtomic: input.context.quote.totalFundingAtomic,
      observedAtomic: "0",
      finalized: false,
      transaction: input.transaction,
      evidenceHash: null,
      unavailableReason: "TON_REAL_FUNDS_GATE_DISABLED",
    };
  }

  async release(input: SettlementActionInput): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, false);
    throw this.unavailable();
  }

  async refund(input: SettlementActionInput): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, false);
    throw this.unavailable();
  }

  async resolve(input: ResolveActionInput): Promise<ChainActionRequest> {
    this.assertOperationContext(input.context, input.now, false);
    throw this.unavailable();
  }

  async readBalance(input: BalanceInput): Promise<NormalizedBalance> {
    this.assertSelection(input.selection);
    this.normalizeAddress(input.escrowAddress);
    return {
      ...this.selection(input.selection),
      available: false,
      balanceAtomic: "0",
      finalized: false,
      observedAt: new Date().toISOString(),
      evidenceHash: null,
      unavailableReason: "TON_REAL_FUNDS_GATE_DISABLED",
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
    return {
      ...this.selection(input.context),
      fundingStatus: NormalizedFundingStatus.UNAVAILABLE,
      settlementStatus: NormalizedSettlementStatus.NOT_STARTED,
      payoutAvailability: PayoutAvailability.UNAVAILABLE,
      assetsAtomic: "0",
      liabilitiesAtomic: "0",
      deltaAtomic: "0",
      finalized: false,
      primaryEvidenceHash: null,
      independentEvidenceHash: null,
      unavailableReason: "TON_REAL_FUNDS_GATE_DISABLED",
    };
  }

  async readEscrow(
    _dealId: string,
    chainId: string,
    asset: SettlementAsset,
  ): Promise<NormalizedEscrowSummary | null> {
    this.assertSupports(chainId, asset);
    return null;
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
    this.normalizeAddress(context.escrowAddress);
  }

  private assertSelection(input: VersionedAsset): void {
    assertValidVersionedAsset(input);
    if (input.network !== this.network) {
      throw new BadRequestException(
        "TON adapter received a different settlement network",
      );
    }
    this.assertSupports(input.chainId, input.asset);
    if (
      (input.asset === SettlementAsset.TON_USDT && !input.assetContract) ||
      (input.asset === SettlementAsset.TON_NATIVE && input.assetContract)
    ) {
      throw new BadRequestException("TON asset identity is incomplete");
    }
  }

  private selection(input: VersionedAsset) {
    return {
      domainVersion: MULTICHAIN_DOMAIN_VERSION,
      network: this.network,
      chainId: input.chainId,
      asset: input.asset,
      assetContract: input.assetContract,
      decimals: input.decimals,
    } as const;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      "TON escrow remains disabled until testnet and audit gates pass",
    );
  }
}
