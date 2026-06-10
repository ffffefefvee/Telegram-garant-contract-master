import clsx from 'clsx';
import { DEAL_STEPPER_STEPS, getStepperIndex } from '../../constants/dealStatus';
import './ui.css';

interface StepperProps {
  status: string;
  className?: string;
}

export function Stepper({ status, className }: StepperProps) {
  const activeIndex = getStepperIndex(status);
  const isDispute = ['disputed', 'frozen'].includes(status);

  return (
    <div className={clsx('ui-stepper', className)}>
      {DEAL_STEPPER_STEPS.map((step, index) => {
        const isActive = index === activeIndex;
        const isDone = index < activeIndex;
        return (
          <div
            key={step.key}
            className={clsx(
              'ui-stepper__step',
              isDone && 'ui-stepper__step--done',
              isActive && 'ui-stepper__step--active',
            )}
          >
            <div className="ui-stepper__dot" />
            <div className="ui-stepper__label">{step.label}</div>
          </div>
        );
      })}
      {isDispute && (
        <div className="ui-stepper__step ui-stepper__step--active">
          <div className="ui-stepper__dot" style={{ background: 'var(--color-danger)' }} />
          <div className="ui-stepper__label" style={{ color: 'var(--color-danger)' }}>
            Спор
          </div>
        </div>
      )}
    </div>
  );
}
