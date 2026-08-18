import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Deal } from "./entities/deal.entity";
import { DealMessage } from "./entities/deal-message.entity";
import { DealAttachment } from "./entities/deal-attachment.entity";
import { DealInvite } from "./entities/deal-invite.entity";
import { DealEvent } from "./entities/deal-event.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import { TonNativeEscrowWatch } from "./entities/ton-native-escrow-watch.entity";
import { TonNativeChainEvent } from "./entities/ton-native-chain-event.entity";
import { TonNativeLifecycleIntent } from "./entities/ton-native-lifecycle-intent.entity";
import { TonNativeRecoveryRequest } from "./entities/ton-native-recovery-request.entity";
import { DealService } from "./deal.service";
import { DealController } from "./deal.controller";
import { DealGateway } from "./deal.gateway";
import { DealGatewayService } from "./deal-gateway.service";
import { UserModule } from "../user/user.module";
import { EscrowModule } from "../escrow/escrow.module";
import { OpsModule } from "../ops/ops.module";
import { ReviewModule } from "../review/review.module";
import { AuthModule } from "../auth/auth.module";
import { ArbitrationModule } from "../arbitration/arbitration.module";
import { TonNativeFundingService } from "./ton-native-funding.service";
import { TonCenterV3Service } from "./ton-center-v3.service";
import { TonNativeFundingIngestionService } from "./ton-native-funding-ingestion.service";
import { TonNativeFundingIngestionScheduler } from "./ton-native-funding-ingestion.scheduler";
import { TonNativeLifecycleRequestService } from "./ton-native-lifecycle-request.service";
import { TonNativeLifecycleIngestionService } from "./ton-native-lifecycle-ingestion.service";
import { TonNativeLifecycleIngestionScheduler } from "./ton-native-lifecycle-ingestion.scheduler";
import { TonNativeEventApplyLockService } from "./ton-native-event-apply-lock.service";
import { TonNativeReconciliationService } from "./ton-native-reconciliation.service";
import { TonNativeRecoveryService } from "./ton-native-recovery.service";
import { TonNativeBackfillService } from "./ton-native-backfill.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Deal,
      DealMessage,
      DealAttachment,
      DealInvite,
      DealEvent,
      TonNativeEscrowPreparation,
      TonNativeEscrowWatch,
      TonNativeChainEvent,
      TonNativeLifecycleIntent,
      TonNativeRecoveryRequest,
    ]),
    forwardRef(() => UserModule),
    forwardRef(() => ReviewModule),
    forwardRef(() => ArbitrationModule),
    EscrowModule,
    OpsModule,
    AuthModule,
  ],
  controllers: [DealController],
  providers: [
    DealService,
    TonNativeFundingService,
    TonCenterV3Service,
    TonNativeFundingIngestionService,
    TonNativeFundingIngestionScheduler,
    TonNativeLifecycleRequestService,
    TonNativeLifecycleIngestionService,
    TonNativeLifecycleIngestionScheduler,
    TonNativeEventApplyLockService,
    TonNativeReconciliationService,
    TonNativeRecoveryService,
    TonNativeBackfillService,
    DealGateway,
    DealGatewayService,
  ],
  exports: [
    DealService,
    TonNativeFundingService,
    TonNativeFundingIngestionService,
    TonNativeLifecycleRequestService,
    TonNativeLifecycleIngestionService,
    TonNativeRecoveryService,
    TonNativeBackfillService,
    TypeOrmModule,
    DealGatewayService,
  ],
})
export class DealModule {}
