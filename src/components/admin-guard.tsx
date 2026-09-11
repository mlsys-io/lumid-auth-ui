import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Loading } from './ui/loading';

/**
 * Routes under /studio/admin/* — visible only to users whose
 * lum.id role is "admin" (or "super_admin", which inherits every
 * admin capability). Falls back to /studio for signed-in
 * non-admins; unauth users get a return_to back to the page they
 * wanted.
 */
export function AdminGuard({
	children,
	fallback = '/studio',
}: {
	children: ReactNode;
	/** Where a signed-in non-admin is sent. Defaults to /studio.
	 *
	 *  /studio/compute overrides it: that section is partly public, so a
	 *  non-admin deep-linking to its admin-only tab should land on the fleet
	 *  view they CAN see, not be bounced out of the section entirely. */
	fallback?: string;
}) {
	const { user, isLoading, isAuthenticated } = useAuth();
	const location = useLocation();

	if (isLoading) return <Loading fullScreen />;

	if (!isAuthenticated) {
		const here = location.pathname + location.search;
		return <Navigate to={`/auth/login?return_to=${encodeURIComponent(here)}`} replace />;
	}
	if (user?.role !== 'admin' && user?.role !== 'super_admin') {
		return <Navigate to={fallback} replace />;
	}
	return <>{children}</>;
}
