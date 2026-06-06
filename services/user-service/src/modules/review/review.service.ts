import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { Review } from './entities/review.entity';
import { ReputationScore } from './entities/reputation-score.entity';
import { User } from '../user/entities/user.entity';
import { Deal } from '../deal/entities/deal.entity';
import { ReviewType, ReviewStatus, ReputationEventType, TrustLevel } from './enums/review.enum';
import { UserService } from '../user/user.service';

export interface CreateReviewDto {
  authorId: string;
  targetId: string;
  dealId?: string;
  type: ReviewType;
  rating: number;
  comment?: string;
  isAnonymous?: boolean;
  ratings?: Record<string, number>;
}

export interface ReviewFilterDto {
  targetId?: string;
  authorId?: string;
  dealId?: string;
  rating?: number;
  status?: ReviewStatus;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'rating' | 'helpfulCount';
  sortOrder?: 'ASC' | 'DESC';
}

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,
    @InjectRepository(ReputationScore)
    private reputationRepository: Repository<ReputationScore>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Deal)
    private dealRepository: Repository<Deal>,
    private userService: UserService,
  ) {}

  /**
   * Создание отзыва
   */
  async createReview(data: CreateReviewDto): Promise<Review> {
    // Валидация рейтинга
    if (data.rating < 1 || data.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    // Проверка существования пользователя
    const target = await this.userRepository.findOne({ where: { id: data.targetId } });
    if (!target) {
      throw new NotFoundException('Target user not found');
    }

    // Проверка сделки если указана
    if (data.dealId) {
      const deal = await this.dealRepository.findOne({ where: { id: data.dealId } });
      if (!deal) {
        throw new NotFoundException('Deal not found');
      }

      // Проверка что сделка завершена
      if (deal.status !== 'completed') {
        throw new ConflictException('Can only review completed deals');
      }

      // Проверка что отзыв ещё не был оставлен
      const existingReview = await this.reviewRepository.findOne({
        where: { dealId: data.dealId, authorId: data.authorId },
      });

      if (existingReview) {
        throw new ConflictException('Review for this deal already exists');
      }
    }

    // Создание отзыва
    const review = this.reviewRepository.create({
      ...data,
      isAnonymous: data.isAnonymous || false,
      ratings: data.ratings || {},
      status: ReviewStatus.PUBLISHED,
      publishedAt: new Date(),
    });

    const savedReview = await this.reviewRepository.save(review);

    // Обновление репутации
    await this.updateReputation(data.targetId, savedReview);

    this.logger.log(`Review created: ${savedReview.id} for user ${data.targetId}`);

    return savedReview;
  }

  /**
   * Поиск отзыва по ID
   */
  async findById(id: string): Promise<Review> {
    const review = await this.reviewRepository.findOne({
      where: { id },
      relations: ['author', 'target', 'deal'],
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    return review;
  }

  /**
   * Фильтрация отзывов
   */
  async findMany(filter: ReviewFilterDto): Promise<{ reviews: Review[]; total: number }> {
    const query = this.reviewRepository.createQueryBuilder('review');

    query.leftJoinAndSelect('review.author', 'author');
    query.leftJoinAndSelect('review.target', 'target');
    query.leftJoinAndSelect('review.deal', 'deal');

    // Фильтры
    if (filter.targetId) {
      query.andWhere('review.targetId = :targetId', { targetId: filter.targetId });
    }

    if (filter.authorId) {
      query.andWhere('review.authorId = :authorId', { authorId: filter.authorId });
    }

    if (filter.dealId) {
      query.andWhere('review.dealId = :dealId', { dealId: filter.dealId });
    }

    if (filter.rating) {
      query.andWhere('review.rating = :rating', { rating: filter.rating });
    }

    if (filter.status) {
      query.andWhere('review.status = :status', { status: filter.status });
    } else {
      // По умолчанию показываем только опубликованные
      query.andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED });
    }

    // Сортировка
    const sortBy = filter.sortBy || 'createdAt';
    const sortOrder = filter.sortOrder || 'DESC';
    query.orderBy(`review.${sortBy}`, sortOrder);

    // Пагинация
    const limit = filter.limit || 20;
    const offset = filter.offset || 0;
    query.skip(offset).take(limit);

    const [reviews, total] = await query.getManyAndCount();

    return { reviews, total };
  }

  /**
   * Получение отзывов пользователя
   */
  async getUserReviews(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ reviews: Review[]; total: number; averageRating: number }> {
    const result = await this.findMany({
      targetId: userId,
      limit,
      offset,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });

    // Расчёт среднего рейтинга
    const averageRating = await this.calculateAverageRating(userId);

    return {
      ...result,
      averageRating,
    };
  }

  /**
   * Обновление полезности отзыва
   */
  async markReviewHelpful(id: string, isHelpful: boolean): Promise<Review> {
    const review = await this.findById(id);

    review.markHelpful(isHelpful);
    return this.reviewRepository.save(review);
  }

  /**
   * Удаление отзыва (автором)
   */
  async deleteReview(id: string, userId: string): Promise<void> {
    const review = await this.findById(id);

    if (review.authorId !== userId) {
      throw new ForbiddenException('Can only delete your own reviews');
    }

    review.delete();
    await this.reviewRepository.save(review);
  }

  /**
   * Скрытие отзыва (модерация)
   */
  async hideReview(id: string, reason: string, hiddenBy: string): Promise<Review> {
    const review = await this.findById(id);

    review.hide(reason, hiddenBy);
    return this.reviewRepository.save(review);
  }

  /**
   * Расчёт среднего рейтинга пользователя
   */
  async calculateAverageRating(userId: string): Promise<number> {
    const result = await this.reviewRepository
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'average')
      .where('review.targetId = :userId', { userId })
      .andWhere('review.status = :status', { status: ReviewStatus.PUBLISHED })
      .getRawOne();

    return result?.average ? Math.round(parseFloat(result.average) * 10) / 10 : 0;
  }

  /**
   * Получение статистики отзывов
   */
  async getReviewStats(userId: string): Promise<{
    total: number;
    averageRating: number;
    ratingDistribution: Record<number, number>;
    positiveCount: number;
    negativeCount: number;
  }> {
    const reviews = await this.reviewRepository.find({
      where: { targetId: userId, status: ReviewStatus.PUBLISHED },
    });

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;

    reviews.forEach((review) => {
      ratingDistribution[review.rating] = (ratingDistribution[review.rating] || 0) + 1;
      totalRating += review.rating;
    });

    const total = reviews.length;
    const averageRating = total > 0 ? Math.round((totalRating / total) * 10) / 10 : 0;
    const positiveCount = ratingDistribution[4] + ratingDistribution[5];
    const negativeCount = ratingDistribution[1] + ratingDistribution[2];

    return {
      total,
      averageRating,
      ratingDistribution,
      positiveCount,
      negativeCount,
    };
  }

  /**
   * Обновление репутации пользователя
   */
  private async updateReputation(targetId: string, review: Review): Promise<void> {
    // Расчёт дельты репутации
    const delta = Review.calculateReputationDelta(review.rating, review.ratings);

    if (delta === 0) return;

    // Получение текущего scores пользователя
    const user = await this.userRepository.findOne({ where: { id: targetId } });
    if (!user) return;

    const currentScore = user.reputationScore;
    const newScore = Math.max(0, Math.min(100, currentScore + delta));

    // Создание записи об изменении репутации
    const scoreChange = ReputationScore.createScoreChange(
      targetId,
      ReputationEventType.REVIEW_RECEIVED,
      delta,
      currentScore,
      `Отзыв от сделки ${review.deal?.dealNumber || 'N/A'}`,
      `Rating: ${review.rating}`,
    );

    const reputationScore = this.reputationRepository.create(scoreChange);
    await this.reputationRepository.save(reputationScore);

    // Обновление пользователя
    user.reputationScore = newScore;
    await this.userRepository.save(user);

    this.logger.log(`Reputation updated for user ${targetId}: ${currentScore} → ${newScore} (${delta >= 0 ? '+' : ''}${delta})`);
  }

  /**
   * Определение уровня доверия
   */
  getTrustLevel(score: number): TrustLevel {
    if (score >= 81) return TrustLevel.VERIFIED;
    if (score >= 61) return TrustLevel.RELIABLE;
    if (score >= 41) return TrustLevel.EXPERIENCED;
    if (score >= 21) return TrustLevel.BEGINNER;
    return TrustLevel.NEW;
  }

  /**
   * Проверка может ли пользователь оставить отзыв
   */
  async canLeaveReview(userId: string, targetId: string, dealId?: string): Promise<{
    canLeave: boolean;
    reason?: string;
  }> {
    if (userId === targetId) {
      return { canLeave: false, reason: 'Cannot review yourself' };
    }

    if (dealId) {
      const deal = await this.dealRepository.findOne({
        where: { id: dealId },
        relations: ['buyer', 'seller'],
      });

      if (!deal) {
        return { canLeave: false, reason: 'Deal not found' };
      }

      if (deal.status !== 'completed') {
        return { canLeave: false, reason: 'Can only review completed deals' };
      }

      // Проверка что пользователь участвовал в сделке
      if (deal.buyerId !== userId && deal.sellerId !== userId) {
        return { canLeave: false, reason: 'Not a participant of this deal' };
      }

      // Проверка что отзыв ещё не был оставлен
      const existingReview = await this.reviewRepository.findOne({
        where: { dealId, authorId: userId },
      });

      if (existingReview) {
        return { canLeave: false, reason: 'Review already exists' };
      }
    }

    return { canLeave: true };
  }
}
