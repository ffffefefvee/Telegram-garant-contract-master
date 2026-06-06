import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { ToastProvider } from './components/ui';
import { AppShell } from './components/AppShell';
import { DealsPage } from './pages/DealsPage';
import { DealNewPage } from './pages/DealNewPage';
import { DealChatPage } from './pages/DealChatPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { ArbitratorPage } from './pages/ArbitratorPage';
import { ArbitratorDisputePage } from './pages/ArbitratorDisputePage';
import { AdminPage } from './pages/AdminPage';
import { DisputesPage } from './pages/DisputesPage';
import { DisputeDetailPage } from './pages/DisputeDetailPage';
import { BotsPage } from './pages/BotsPage';
import { BotEditPage } from './pages/BotEditPage';
import { BotStatsPage } from './pages/BotStatsPage';
import { AuthGate } from './components/AuthGate';
import { RoleGuard } from './components/RoleGuard';
import { UserRole } from './types';
import './styles/global.css';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthGate>
            <AppShell>
              <Routes>
                <Route path="/" element={<Navigate to="/deals" replace />} />
                <Route path="/deals" element={<DealsPage />} />
                <Route path="/deal/new" element={<DealNewPage />} />
                <Route path="/deals/new" element={<Navigate to="/deal/new" replace />} />
                <Route path="/deals/:id" element={<DealChatPage />} />
                <Route path="/deal/:id" element={<DealChatPage />} />
                <Route path="/disputes" element={<DisputesPage />} />
                <Route path="/disputes/:id" element={<DisputeDetailPage />} />
                <Route path="/bots" element={<BotsPage />} />
                <Route path="/bots/new" element={<BotEditPage />} />
                <Route path="/bots/:id/stats" element={<BotStatsPage />} />
                <Route path="/bots/:id" element={<BotEditPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route
                  path="/arbitrator"
                  element={
                    <RoleGuard role={UserRole.ARBITRATOR}>
                      <ArbitratorPage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/arbitrator/dispute/:id"
                  element={
                    <RoleGuard role={UserRole.ARBITRATOR}>
                      <ArbitratorDisputePage />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/*"
                  element={
                    <RoleGuard role={UserRole.ADMIN}>
                      <AdminPage />
                    </RoleGuard>
                  }
                />
              </Routes>
            </AppShell>
          </AuthGate>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
};

export default App;
