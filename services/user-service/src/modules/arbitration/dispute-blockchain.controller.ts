import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { DisputeService } from './dispute.service';
import {
  ArbitratorSelectionService,
  ArbitratorCandidate,
} from './arbitrator-selection.service';
import {
  DisputeBlockchainService,
  AssignArbitratorOnChainResult,
  RecordResolutionInput,
} from './dispute-blockchain.service';
import { Dispute } from './entities/dispute.entity';

class RecordResolutionDto implements RecordResolutionInput {
  txHash: string;
  buyerSharePct: number;
  sellerSharePct: number;
}

class AutoAssignOptionsDto {
  /** Override default capacity cap (default 5). */
  maxConcurrent?: number;
  /** Force-skip these arbitrator user-IDs (manual CoI override). */
  excludeUserIds?: string[];
}

interface AutoAssignResponse {
  dispute: Dispute;
  candidate: ArbitratorCandidate;
  onChain: AssignArbitratorOnChainResult;
}

/**
 * On-chain dispute lifecycle endpoints. Layered on top of the existing
 * `ArbitrationController` (which handles the off-chain DB flow) — this
 * one is responsible for the bridge to the escrow clone.
 *
 * Mounted at `/api/arbitration` (same prefix as the existing controller).
 */
@Controller('arbitration')
export class DisputeBlockchainController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly selection: ArbitratorSelectionService,
    private readonly bridge: DisputeBlockchainService,
  ) {}

  /**
   * POST /api/arbitration/disputes/:id/auto-assign
   *
   * Selects an eligible arbitrator (active, walletAddress set, not a party
   * to the deal, has capacity), assigns them in the DB via DisputeService,
   * and pushes the assignment to the on-chain escrow clone.
   *
   * Idempotent in the same sense as DisputeService.assignArbitrator —
   * re-assignment only works if the dispute is still in an "open" state.
   */
  @Post('disputes/:id/auto-assign')
  @HttpCode(HttpStatus.OK)
  async autoAssign(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) disputeId: string,
    @Body() opts: AutoAssignOptionsDto = {},
  ): Promise<AutoAssignResponse> {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Not authenticated');
    }

    const dispute = await this.disputes.getDispute(disputeId);

    const candidate = await this.selection.selectForDeal(dispute.dealId, {
      maxConcurrent: opts.maxConcurrent,
      excludeUserIds: opts.excludeUserIds,
    });

    const updated = await this.disputes.assignArbitrator(
      disputeId,
      candidate.userId,
      userId,
      true,
    );

    const onChain = await this.bridge.syncArbitratorAssignmentOnChain(disputeId);

    return { dispute: updated, candidate, onChain };
  }

  /**
   * POST /api/arbitration/disputes/:id/record-resolution
   *
   * Called by the arbitrator's mini-app after they have signed and
   * broadcast the on-chain `resolve(buyerPct, sellerPct)` tx. We record
   * the tx hash + decision and transition the deal to DISPUTE_RESOLVED.
   */
  @Post('disputes/:id/record-resolution')
  @HttpCode(HttpStatus.OK)
  async recordResolution(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) disputeId: string,
    @Body() body: RecordResolutionDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Not authenticated');
    }
    return this.bridge.recordResolutionTx(disputeId, body);
  }
}
