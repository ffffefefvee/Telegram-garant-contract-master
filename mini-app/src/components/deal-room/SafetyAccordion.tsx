import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, HelpCircle, Shield, Users, Lock } from 'lucide-react';
import './deal-room.css';

const SAFETY_ITEMS = [
  {
    icon: Shield,
    text: 'Смарт-контракт нельзя подделать',
  },
  {
    icon: Users,
    text: 'Арбитр решит спор, если что-то пойдёт не так',
  },
  {
    icon: Lock,
    text: 'Деньги заморожены, продавец получит их только после вашего подтверждения',
  },
] as const;

const TOOLTIP_TEXT =
  'Это программа, которая сама переведёт деньги продавцу после сделки. Никто не может её обмануть.';

export const SmartContractTooltip: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div className="smart-contract-tooltip" ref={ref}>
      <button
        type="button"
        className="smart-contract-tooltip__btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Что такое смарт-контракт"
        aria-expanded={open}
      >
        <HelpCircle size={16} />
      </button>
      {open && (
        <div className="smart-contract-tooltip__popup" role="tooltip">
          {TOOLTIP_TEXT}
        </div>
      )}
    </div>
  );
};

interface SafetyAccordionProps {
  defaultOpen?: boolean;
}

export const SafetyAccordion: React.FC<SafetyAccordionProps> = ({ defaultOpen = true }) => {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className={`safety-accordion ${expanded ? 'safety-accordion--open' : ''}`}>
      <button
        type="button"
        className="safety-accordion__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Shield size={18} className="safety-accordion__header-icon" />
        <span>Почему это безопасно?</span>
        <ChevronDown size={18} className="safety-accordion__chevron" />
      </button>
      {expanded && (
        <div className="safety-accordion__body">
          {SAFETY_ITEMS.map(({ icon: Icon, text }) => (
            <div key={text} className="safety-accordion__item">
              <span className="safety-accordion__item-icon">
                <Icon size={16} />
              </span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
