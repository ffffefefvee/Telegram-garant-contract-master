import React from 'react';
import './profile.css';

interface TrustScoreBarProps {
  score: number;
  max?: number;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 50) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

export const TrustScoreBar: React.FC<TrustScoreBarProps> = ({ score, max = 100 }) => {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  return (
    <div className="trust-score">
      <div className="trust-score__head">
        <span>TrustScore</span>
        <strong style={{ color: scoreColor(score) }}>{score}</strong>
      </div>
      <div className="trust-score__track">
        <div
          className="trust-score__fill"
          style={{ width: `${pct}%`, background: scoreColor(score) }}
        />
      </div>
    </div>
  );
};
