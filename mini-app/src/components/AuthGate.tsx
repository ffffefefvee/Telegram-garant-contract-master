import React from 'react';
import { useAppStore } from '../store/appStore';
import { useAuthBootstrap } from '../hooks/useAuthBootstrap';

interface AuthGateProps {
  children: React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  useAuthBootstrap();
  const { authStatus, authError } = useAppStore((s) => ({
    authStatus: s.authStatus,
    authError: s.authError,
  }));

  if (authStatus === 'authenticated') {
    return <>{children}</>;
  }

  if (authStatus === 'error') {
    return (
      <div className="app-container">
        <div className="loading-screen">
          <h2>Не удалось войти</h2>
          <p className="auth-error-message">{authError}</p>
          <p>Откройте мини-приложение заново из Telegram.</p>
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Загрузка...</p>
      </div>
    </div>
  );
};
