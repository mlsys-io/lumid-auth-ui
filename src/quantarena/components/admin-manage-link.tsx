import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

// Shared admin-only quick-link to the relevant /dashboard/admin/*
// management UI. Renders nothing for non-admin users so user-facing
// QA pages stay clean. Used on the Competition lobby, Templates,
// Markets/Bundles, etc. — anywhere a regular page has a sibling
// admin CRUD surface.

interface AdminManageLinkProps {
	to: string;
	label?: string;
	className?: string;
}

export function AdminManageLink({ to, label = 'Manage', className }: AdminManageLinkProps) {
	const { user } = useAuth();
	const role = (user as { role?: string } | null)?.role;
	if (role !== 'admin' && role !== 'super_admin') return null;
	return (
		<Link
			to={to}
			className={
				className ??
				'inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium'
			}
		>
			<Settings className="w-3.5 h-3.5" />
			{label}
		</Link>
	);
}
