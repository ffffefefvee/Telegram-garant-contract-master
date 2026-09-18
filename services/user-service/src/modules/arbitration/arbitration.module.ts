import { Module, forwardRef } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";

// Entities
import { Dispute } from "./entities/dispute.entity";
import { Evidence } from "./entities/evidence.entity";
import { ArbitrationChat } from "./entities/arbitration-chat.entity";
import { ArbitrationChatMessage } from "./entities/arbitration-chat-message.entity";
import { ArbitrationDecision } from "./entities/arbitration-decision.entity";
import { ArbitrationEvent } from "./entities/arbitration-event.entity";
import { Appeal } from "./entities/appeal.entity";
import { DealTerms } from "./entities/deal-terms.entity";
import { ArbitrationSettings } from "./entities/arbitration-settings.entity";
import { ArbitratorProfile } from "./entities/arbitrator-profile.entity";
import { EvidenceFileManifest } from "./entities/evidence-file-manifest.entity";

// Services
import { ArbitrationService } from "./arbitration.service";
import { DisputeService } from "./dispute.service";
import { EvidenceService } from "./evidence.service";
import { ArbitratorService } from "./arbitrator.service";
import { ArbitrationSettingsService } from "./arbitration-settings.service";
import { ArbitratorSelectionService } from "./arbitrator-selection.service";
import { DisputeBlockchainService } from "./dispute-blockchain.service";
import { TonNativeResolutionRequestService } from "./ton-native-resolution-request.service";
import { EvidencePipelineService } from "./evidence-pipeline.service";
import {
  DisabledEvidenceMalwareScanner,
  DisabledEvidenceObjectStorage,
  EVIDENCE_MALWARE_SCANNER,
  EVIDENCE_OBJECT_STORAGE,
} from "./evidence-pipeline.ports";

// Controllers
import { ArbitrationController } from "./arbitration.controller";
import { AdminArbitrationController } from "./admin-arbitration.controller";
import { DisputeBlockchainController } from "./dispute-blockchain.controller";

// External modules
import { UserModule } from "../user/user.module";
import { DealModule } from "../deal/deal.module";
import { PaymentModule } from "../payment/payment.module";
import { ReviewModule } from "../review/review.module";
import { EscrowModule } from "../escrow/escrow.module";
import { OpsModule } from "../ops/ops.module";
import { Deal } from "../deal/entities/deal.entity";
import { User } from "../user/entities/user.entity";
import { RolesGuard } from "../admin/guards/roles.guard";
import { ArbitratorAccessGuard } from "./arbitrator-access.guard";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dispute,
      Evidence,
      ArbitrationChat,
      ArbitrationChatMessage,
      ArbitrationDecision,
      ArbitrationEvent,
      Appeal,
      DealTerms,
      ArbitrationSettings,
      ArbitratorProfile,
      EvidenceFileManifest,
      Deal,
      User,
    ]),
    forwardRef(() => UserModule),
    forwardRef(() => DealModule),
    forwardRef(() => PaymentModule),
    ReviewModule,
    EscrowModule,
    OpsModule,
    JwtModule.register({}),
  ],
  controllers: [
    ArbitrationController,
    AdminArbitrationController,
    DisputeBlockchainController,
  ],
  providers: [
    ArbitrationService,
    DisputeService,
    EvidenceService,
    ArbitratorService,
    ArbitrationSettingsService,
    ArbitratorSelectionService,
    DisputeBlockchainService,
    TonNativeResolutionRequestService,
    EvidencePipelineService,
    DisabledEvidenceObjectStorage,
    DisabledEvidenceMalwareScanner,
    {
      provide: EVIDENCE_OBJECT_STORAGE,
      useExisting: DisabledEvidenceObjectStorage,
    },
    {
      provide: EVIDENCE_MALWARE_SCANNER,
      useExisting: DisabledEvidenceMalwareScanner,
    },
    RolesGuard,
    ArbitratorAccessGuard,
    { provide: APP_GUARD, useClass: ArbitratorAccessGuard },
  ],
  exports: [
    ArbitrationService,
    DisputeService,
    EvidenceService,
    ArbitratorService,
    ArbitrationSettingsService,
    ArbitratorSelectionService,
    DisputeBlockchainService,
    TonNativeResolutionRequestService,
    EvidencePipelineService,
    TypeOrmModule,
  ],
})
export class ArbitrationModule {}
