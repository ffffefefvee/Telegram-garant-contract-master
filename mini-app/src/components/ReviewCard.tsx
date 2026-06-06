import React, { useState } from 'react';
import { Review } from '../../types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import './ReviewCard.css';

interface ReviewCardProps {
  review: Review;
  onHelpful?: (id: string, isHelpful: boolean) => void;
  showAuthor?: boolean;
}

const ratingLabels: Record<number, string> = {
  5: 'Отлично',
  4: 'Хорошо',
  3: 'Нормально',
  2: 'Плохо',
  1: 'Ужасно',
};

const ratingColors: Record<number, string> = {
  5: '#4caf50',
  4: '#8bc34a',
  3: '#ff9800',
  2: '#f44336',
  1: '#d32f2f',
};

export const ReviewCard: React.FC<ReviewCardProps> = ({
  review,
  onHelpful,
  showAuthor = true,
}) => {
  const [helpfulAction, setHelpfulAction] = useState<'helpful' | 'not-helpful' | null>(null);

  const formattedDate = format(new Date(review.createdAt), 'dd.MM.yyyy', { locale: ru });

  const handleHelpful = (isHelpful: boolean) => {
    if (!onHelpful || helpfulAction) return;
    
    setHelpfulAction(isHelpful ? 'helpful' : 'not-helpful');
    onHelpful(review.id, isHelpful);
  };

  return (
    <div className="review-card">
      <div className="review-header">
        <div className="review-rating">
          <div className="stars">
            {'★'.repeat(review.rating)}
            {'☆'.repeat(5 - review.rating)}
          </div>
          <span className="rating-label" style={{ color: ratingColors[review.rating] }}>
            {ratingLabels[review.rating]}
          </span>
        </div>

        {showAuthor && review.author && !review.isAnonymous && (
          <div className="review-author">
            {review.author.telegramFirstName || review.author.telegramUsername}
          </div>
        )}

        <span className="review-date">{formattedDate}</span>
      </div>

      {review.comment && (
        <div className="review-comment">
          {review.comment}
        </div>
      )}

      {review.ratings && Object.keys(review.ratings).length > 0 && (
        <div className="review-ratings">
          {Object.entries(review.ratings).map(([key, value]) => (
            <div key={key} className="rating-item">
              <span className="rating-name">{key}</span>
              <div className="rating-stars">
                {'★'.repeat(value)}
                {'☆'.repeat(5 - value)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="review-footer">
        <div className="review-helpful">
          <span className="helpful-count">{review.helpfulCount}</span>
          <button
            className={`helpful-btn ${helpfulAction === 'helpful' ? 'active' : ''}`}
            onClick={() => handleHelpful(true)}
            disabled={!!helpfulAction}
          >
            Полезно
          </button>
          <button
            className={`helpful-btn ${helpfulAction === 'not-helpful' ? 'active' : ''}`}
            onClick={() => handleHelpful(false)}
            disabled={!!helpfulAction}
          >
            Бесполезно
          </button>
        </div>

        {review.helpfulCount > 0 && (
          <div className="review-helpfulness">
            {Math.round((review.helpfulCount / (review.helpfulCount + review.notHelpfulCount)) * 100)}%
            нашли отзыв полезным
          </div>
        )}
      </div>
    </div>
  );
};
