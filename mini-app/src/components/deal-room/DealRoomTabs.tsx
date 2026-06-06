import React from 'react';
import './deal-room.css';

export type DealRoomTab = 'chat' | 'conditions' | 'contract';

interface DealRoomTabsProps {
  active: DealRoomTab;
  onChange: (tab: DealRoomTab) => void;
}

const TABS: { id: DealRoomTab; label: string }[] = [
  { id: 'chat', label: 'Чат' },
  { id: 'conditions', label: 'Условия' },
  { id: 'contract', label: 'Контракт' },
];

export const DealRoomTabs: React.FC<DealRoomTabsProps> = ({ active, onChange }) => (
  <div className="deal-room-tabs" role="tablist">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        className={`deal-room-tab ${active === tab.id ? 'deal-room-tab--active' : ''}`}
        onClick={() => onChange(tab.id)}
      >
        {tab.label}
      </button>
    ))}
  </div>
);
