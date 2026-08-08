import React, { useCallback, useState } from 'react';
import { ToastContext } from './ToastContext';
import './ui.css';

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setMessage(msg);
    window.setTimeout(() => setMessage(null), 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div className="ui-toast-container">
          <div className="ui-toast" role="status">
            {message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
