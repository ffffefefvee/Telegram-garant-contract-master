import React from 'react';
import clsx from 'clsx';
import { FileText, ScrollText, Wallet, CheckCircle, CircleCheck } from 'lucide-react';
import {
  DEAL_FLOW_STEPS,
  getDealFlowStepIndex,
  type DealFlowProgressContext,
} from '../../constants/dealStatus';
import './deal-room.css';

const STEP_ICONS = [FileText, ScrollText, Wallet, CheckCircle, CircleCheck] as const;

interface DealFlowProgressBarProps {
  status: string;
  progressContext?: DealFlowProgressContext;
  className?: string;
}

export const DealFlowProgressBar: React.FC<DealFlowProgressBarProps> = ({
  status,
  progressContext,
  className,
}) => {
  const activeIndex = getDealFlowStepIndex(status, progressContext);

  return (
    <div className={clsx('deal-flow-progress', className)} aria-label="Прогресс сделки">
      <div className="deal-flow-progress__track">
        {DEAL_FLOW_STEPS.map((step, index) => {
          const Icon = STEP_ICONS[index];
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          const isPending = index > activeIndex;

          return (
            <div
              key={step.key}
              className={clsx(
                'deal-flow-progress__step',
                isDone && 'deal-flow-progress__step--done',
                isActive && 'deal-flow-progress__step--active',
                isPending && 'deal-flow-progress__step--pending',
              )}
            >
              <div className="deal-flow-progress__icon-wrap">
                <Icon size={14} strokeWidth={2} />
              </div>
              <span className="deal-flow-progress__label">{step.label}</span>
              <span className="deal-flow-progress__desc">{step.description}</span>
            </div>
          );
        })}
      </div>
      <div className="deal-flow-progress__bar">
        {DEAL_FLOW_STEPS.map((step, index) => (
          <div
            key={`bar-${step.key}`}
            className={clsx(
              'deal-flow-progress__bar-segment',
              index <= activeIndex && 'deal-flow-progress__bar-segment--filled',
            )}
          />
        ))}
      </div>
    </div>
  );
};
