import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { SettlementAsset, SettlementNetwork } from "../../deal/enums/deal.enum";
import {
  EscrowChainAdapter,
  NormalizedEscrowSummary,
  PrepareEscrowInput,
  PreparedEscrow,
} from "./escrow-chain-adapter";
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

  async readEscrow(
    _dealId: string,
    chainId: string,
    asset: SettlementAsset,
  ): Promise<NormalizedEscrowSummary | null> {
    this.assertSupports(chainId, asset);
    return null;
  }
}
