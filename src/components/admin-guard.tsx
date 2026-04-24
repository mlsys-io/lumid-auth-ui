import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Loading } from './ui/loading';

/**
 * Routes under /dashboard/admin/* — visible only to users whose
 * lum.id role is "admin" (or "super_admin", which inherits every
 * admin capability). Falls back to /dashboard for signed-in
 * non-admins; unauth users get a return_to back to the page they
 * wanted.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
	const { user, isLoading, isAuthenticated } = useAuth();
	const location = useLocation();

	if (isLoading) return <Loading fullScreen />;

	if (!isAuthenticated) {
		const here = location.pathname + location.search;
		return <Navigate to={`/auth/login?return_to=${encodeURIComponent(here)}`} replace />;
	}
	if (user?.role !== 'admin' && user?.role !== 'super_admin') {
		return <Navigate to="/dashboard" replace />;
	}
	return <>{children}</>;
}
