import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities
import { Dispute } from './entities/dispute.entity';
import { Evidence } from './entities/evidence.entity';
import { ArbitrationChat } from './entities/arbitration-chat.entity';
import { ArbitrationChatMessage } from './entities/arbitration-chat-message.entity';
import { ArbitrationDecision } from './entities/arbitration-decision.entity';
import { ArbitrationEvent } from './entities/arbitration-event.entity';
import { Appeal } from './entities/appeal.entity';
import { DealTerms } from './entities/deal-terms.entity';
import { ArbitrationSettings } from './entities/arbitration-settings.entity';
import { ArbitratorProfile } from './entities/arbitrator-profile.entity';

// Services
import { ArbitrationService } from './arbitration.service';
import { DisputeService } from './dispute.service';
import { EvidenceService } from './evidence.service';
import { ArbitratorService } from './arbitrator.service';
import { ArbitrationSettingsService } from './arbitration-settings.service';
import { ArbitratorSelectionService } from './arbitrator-selection.service';
import { DisputeBlockchainService } from './dispute-blockchain.service';

// Controllers
import { ArbitrationController } from './arbitration.controller';
import { AdminArbitrationController } from './admin-arbitration.controller';
import { DisputeBlockchainController } from './dispute-blockchain.controller';

// External modules
import { UserModule } from '../user/user.module';
import { DealModule } from '../deal/deal.module';
import { PaymentModule } from '../payment/payment.module';
import { ReviewModule } from '../review/review.module';
import { EscrowModule } from '../escrow/escrow.module';
import { OpsModule } from '../ops/ops.module';
import { Deal } from '../deal/entities/deal.entity';
import { User } from '../user/entities/user.entity';

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
      Deal,
      User,
    ]),
    forwardRef(() => UserModule),
    forwardRef(() => DealModule),
    forwardRef(() => PaymentModule),
    ReviewModule,
    EscrowModule,
    OpsModule,
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
  ],
  exports: [
    ArbitrationService,
    DisputeService,
    EvidenceService,
    ArbitratorService,
    ArbitrationSettingsService,
    ArbitratorSelectionService,
    DisputeBlockchainService,
    TypeOrmModule,
  ],
})
export class ArbitrationModule {}
