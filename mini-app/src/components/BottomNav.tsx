import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Bot, Scale, User } from 'lucide-react';
import './BottomNav.css';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  matchPrefix?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/deals', label: 'Сделки', icon: <Home size={22} strokeWidth={1.75} /> },
  { path: '/bots', label: 'Боты', icon: <Bot size={22} strokeWidth={1.75} />, matchPrefix: true },
  { path: '/disputes', label: 'Споры', icon: <Scale size={22} strokeWidth={1.75} />, matchPrefix: true },
  { path: '/profile', label: 'Профиль', icon: <User size={22} strokeWidth={1.75} /> },
];

export const BottomNav: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (item: NavItem) =>
    item.matchPrefix
      ? location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
      : location.pathname === item.path;

  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.path}
          type="button"
          className={`nav-item ${isActive(item) ? 'active' : ''}`}
          onClick={() => navigate(item.path)}
        >
          <span className="nav-item__icon-wrap">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
};
