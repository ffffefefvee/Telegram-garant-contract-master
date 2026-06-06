import React from 'react';
import '../shared/shared.css';

/** Maps deal status to 3-step progress: pay → work → complete */
function getProgressStep(status: string): number {
  if (['pending_acceptance', 'pending_payment', 'draft'].includes(status)) return 0;
  if (['in_progress', 'funded', 'pending_confirmation'].includes(status)) return 1;
  if (['completed', 'disputed', 'dispute_resolved', 'resolved', 'cancelled', 'expired'].includes(status)) {
    return 2;
  }
  return 0;
}

interface DealProgressBarProps {
  status: string;
}

export const DealProgressBar: React.FC<DealProgressBarProps> = ({ status }) => {
  const current = getProgressStep(status);
  return (
    <div className="deal-progress" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`deal-progress__step ${
            i < current ? 'deal-progress__step--done' : i === current ? 'deal-progress__step--current' : ''
          }`}
        />
      ))}
    </div>
  );
};
