import React, { useState, useEffect, useCallback } from 'react';
import { Review } from '../../types';
import { reviewsApi } from '../api';
import { ReviewCard } from './ReviewCard';
import './ReviewList.css';

interface ReviewListProps {
  userId: string;
  limit?: number;
  onReviewClick?: (review: Review) => void;
}

export const ReviewList: React.FC<ReviewListProps> = ({
  userId,
  limit = 10,
  onReviewClick,
}) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    total: number;
    averageRating: number;
    ratingDistribution: Record<number, number>;
  } | null>(null);

  const fetchReviews = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await reviewsApi.getUserReviews(userId, limit);
      setReviews(response.reviews);
      setStats({
        total: response.total,
        averageRating: response.averageRating,
        // Stats endpoint returns full distribution; here we approximate from reviews
        ratingDistribution: [1, 2, 3, 4, 5].reduce(
          (acc, r) => ({ ...acc, [r]: response.reviews.filter((rv) => rv.rating === r).length }),
          {} as Record<number, number>,
        ),
      });
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
      setError('Не удалось загрузить отзывы');
    } finally {
      setIsLoading(false);
    }
  }, [userId, limit]);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  const handleHelpful = async (reviewId: string, isHelpful: boolean) => {
    try {
      await reviewsApi.markHelpful(reviewId, isHelpful);
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? { ...r, helpfulCount: r.helpfulCount + (isHelpful ? 1 : 0) }
            : r,
        ),
      );
    } catch (err) {
      console.error('Failed to mark review helpful:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="review-list-loading">
        <div className="spinner"></div>
        <p>Загрузка отзывов...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="review-list-empty">
        <p>{error}</p>
        <button onClick={() => void fetchReviews()} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer' }}>Повторить</button>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="review-list-empty">
        <p>Пока нет отзывов</p>
      </div>
    );
  }

  return (
    <div className="review-list">
      {stats && (
        <div className="review-stats">
          <div className="stats-average">
            <div className="average-value">{stats.averageRating}</div>
            <div className="average-stars">
              {'★'.repeat(Math.round(stats.averageRating))}
              {'☆'.repeat(5 - Math.round(stats.averageRating))}
            </div>
            <div className="average-total">{stats.total} отзывов</div>
          </div>

          <div className="stats-distribution">
            {[5, 4, 3, 2, 1].map(rating => {
              const count = stats.ratingDistribution[rating] || 0;
              const percentage = stats.total > 0 ? (count / stats.total) * 100 : 0;
              
              return (
                <div key={rating} className="distribution-row">
                  <span className="distribution-rating">{rating} ★</span>
                  <div className="distribution-bar">
                    <div 
                      className="distribution-fill" 
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="distribution-count">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="reviews">
        {reviews.map((review) => (
          <ReviewCard
            key={review.id}
            review={review}
            onHelpful={handleHelpful}
          />
        ))}
      </div>
    </div>
  );
};
