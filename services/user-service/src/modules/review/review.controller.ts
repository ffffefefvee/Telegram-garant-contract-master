import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { ReviewService, CreateReviewDto, ReviewFilterDto } from './review.service';
import { Review } from './entities/review.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPayload } from '../auth/auth.middleware';

@Controller('reviews')
export class ReviewController {
  constructor(private reviewService: ReviewService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createReview(
    @Body() data: CreateReviewDto,
    @CurrentUser() user: UserPayload,
  ): Promise<Review> {
    data.authorId = user.id;
    return this.reviewService.createReview(data);
  }

  @Get()
  async findMany(@Query() filter: ReviewFilterDto): Promise<{
    reviews: Review[];
    total: number;
  }> {
    return this.reviewService.findMany(filter);
  }

  @Get('user/:userId')
  async getUserReviews(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit', ParseIntPipe) limit: number = 20,
    @Query('offset', ParseIntPipe) offset: number = 0,
  ): Promise<{
    reviews: Review[];
    total: number;
    averageRating: number;
  }> {
    return this.reviewService.getUserReviews(userId, limit, offset);
  }

  @Get('stats/:userId')
  async getReviewStats(@Param('userId', ParseUUIDPipe) userId: string): Promise<{
    total: number;
    averageRating: number;
    ratingDistribution: Record<number, number>;
    positiveCount: number;
    negativeCount: number;
  }> {
    return this.reviewService.getReviewStats(userId);
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<Review> {
    return this.reviewService.findById(id);
  }

  @Post(':id/helpful')
  async markHelpful(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { isHelpful: boolean },
  ): Promise<Review> {
    return this.reviewService.markReviewHelpful(id, body.isHelpful);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<void> {
    await this.reviewService.deleteReview(id, user.id);
  }

  @Get('check/:targetId')
  async canLeaveReview(
    @Param('targetId', ParseUUIDPipe) targetId: string,
    @CurrentUser() user: UserPayload,
    @Query('dealId') dealId?: string,
  ): Promise<{
    canLeave: boolean;
    reason?: string;
  }> {
    return this.reviewService.canLeaveReview(user.id, targetId, dealId);
  }
}

@Controller('reputation')
export class ReputationController {
  constructor(private reviewService: ReviewService) {}

  @Get('user/:userId')
  async getUserReputation(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit', ParseIntPipe) limit: number = 50,
    @Query('offset', ParseIntPipe) offset: number = 0,
  ): Promise<{
    scores: any[];
    total: number;
    averageRating: number;
    trustLevel: string;
  }> {
    const [scores, total] = await this.reviewService['reputationRepository'].findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const averageRating = await this.reviewService.calculateAverageRating(userId);
    const user = await this.reviewService['userRepository'].findOne({ where: { id: userId } });
    const trustLevel = this.reviewService.getTrustLevel(user?.reputationScore || 0);

    return {
      scores,
      total,
      averageRating,
      trustLevel,
    };
  }
}
