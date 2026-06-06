import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deal } from './entities/deal.entity';
import { DealMessage } from './entities/deal-message.entity';
import { DealAttachment } from './entities/deal-attachment.entity';
import { DealInvite } from './entities/deal-invite.entity';
import { DealEvent } from './entities/deal-event.entity';
import { DealService } from './deal.service';
import { DealController } from './deal.controller';
import { DealGateway } from './deal.gateway';
import { DealGatewayService } from './deal-gateway.service';
import { UserModule } from '../user/user.module';
import { EscrowModule } from '../escrow/escrow.module';
import { OpsModule } from '../ops/ops.module';
import { ReviewModule } from '../review/review.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Deal,
      DealMessage,
      DealAttachment,
      DealInvite,
      DealEvent,
    ]),
    forwardRef(() => UserModule),
    forwardRef(() => ReviewModule),
    EscrowModule,
    OpsModule,
    AuthModule,
  ],
  controllers: [DealController],
  providers: [DealService, DealGateway, DealGatewayService],
  exports: [DealService, TypeOrmModule, DealGatewayService],
})
export class DealModule {}
