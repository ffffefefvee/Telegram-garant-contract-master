import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserRole } from '../types';

interface ForbiddenScreenProps {
  role: UserRole;
}

const ROLE_LABELS: Record<UserRole, string> = {
  buyer: 'покупателя',
  seller: 'продавца',
  arbitrator: 'арбитра',
  admin: 'администратора',
};

export const ForbiddenScreen: React.FC<ForbiddenScreenProps> = ({ role }) => {
  const navigate = useNavigate();
  return (
    <div className="loading-screen">
      <h2>Доступ запрещён</h2>
      <p>
        Этот раздел доступен только пользователям с ролью{' '}
        <strong>{ROLE_LABELS[role] ?? role}</strong>.
      </p>
      <button className="primary-button" onClick={() => navigate('/deals')}>
        Вернуться к сделкам
      </button>
    </div>
  );
};
