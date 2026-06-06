import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore, hasRole } from '../store/appStore';
import type { UserRole } from '../types';
import { ForbiddenScreen } from './ForbiddenScreen';

interface RoleGuardProps {
  /** One of the `UserRole` constants. The user must hold this role. */
  role: UserRole;
  /** Path to redirect to when unauthenticated. Defaults to `/`. */
  fallbackPath?: string;
  children: React.ReactNode;
}

/**
 * Gates a subtree behind a single role check. Renders 403 screen if the
 * current user exists but lacks the role; redirects home if the user is
 * not loaded yet (AuthGate handles the pending state above us).
 */
export const RoleGuard: React.FC<RoleGuardProps> = ({
  role,
  fallbackPath = '/',
  children,
}) => {
  const user = useAppStore((s) => s.user);

  if (!user) {
    return <Navigate to={fallbackPath} replace />;
  }
  if (!hasRole(user, role)) {
    return <ForbiddenScreen role={role} />;
  }
  return <>{children}</>;
};
