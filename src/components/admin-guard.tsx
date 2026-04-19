import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Loading } from './ui/loading';

/**
 * Routes under /account/admin/* — visible only to users whose lum.id
 * role is "admin". Falls back to /account for signed-in non-admins;
 * unauth users hit AuthGuard first and get bounced to /login.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
	const { user, isLoading, isAuthenticated } = useAuth();
	if (isLoading) return <Loading fullScreen />;
	if (!isAuthenticated) return <Navigate to="/login" replace />;
	if (user?.role !== 'admin') return <Navigate to="/account" replace />;
	return <>{children}</>;
}
