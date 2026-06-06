import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review } from './entities/review.entity';
import { ReputationScore } from './entities/reputation-score.entity';
import { ReviewService } from './review.service';
import { ReputationService } from './reputation.service';
import { ReviewController, ReputationController } from './review.controller';
import { UserModule } from '../user/user.module';
import { DealModule } from '../deal/deal.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Review, ReputationScore]),
    forwardRef(() => UserModule),
    forwardRef(() => DealModule),
  ],
  controllers: [ReviewController, ReputationController],
  providers: [ReviewService, ReputationService],
  exports: [ReviewService, ReputationService, TypeOrmModule],
})
export class ReviewModule {}
