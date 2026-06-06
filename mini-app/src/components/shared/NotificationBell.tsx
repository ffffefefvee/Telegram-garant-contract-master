import React from 'react';
import { Bell } from 'lucide-react';
import { MOCK_NOTIFICATION_COUNT } from '../../mocks/dashboard';
import './shared.css';

interface NotificationBellProps {
  count?: number;
  onClick?: () => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  count = MOCK_NOTIFICATION_COUNT,
  onClick,
}) => (
  <button type="button" className="notification-bell" onClick={onClick} aria-label="Уведомления">
    <Bell size={20} />
    {count > 0 && <span className="notification-bell__badge">{count > 9 ? '9+' : count}</span>}
  </button>
);
