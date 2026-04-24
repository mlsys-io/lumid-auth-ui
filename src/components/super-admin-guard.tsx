import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Loading } from './ui/loading';

/**
 * Billing + accounting routes — super_admin only. Regular admins
 * can do everything else (users, clusters, workflows, reviews) but
 * not touch money-moving endpoints. Falls back to /dashboard/admin
 * for signed-in admins, /dashboard for regular users.
 */
export function SuperAdminGuard({ children }: { children: ReactNode }) {
	const { user, isLoading, isAuthenticated } = useAuth();
	const location = useLocation();

	if (isLoading) return <Loading fullScreen />;
	if (!isAuthenticated) {
		const here = location.pathname + location.search;
		return <Navigate to={`/auth/login?return_to=${encodeURIComponent(here)}`} replace />;
	}
	if (user?.role !== 'super_admin') {
		const fallback =
			user?.role === 'admin' ? '/dashboard/admin' : '/dashboard';
		return <Navigate to={fallback} replace />;
	}
	return <>{children}</>;
}
