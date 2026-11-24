// StandaloneFrame — the Lumen frame for the two operator pages that live
// outside StudioShell: /code (the Claude token dashboard) and /claude-sessions.
//
// They used to render bare: no padding, a 16px heading flush against the top
// edge, and no way back into Studio. This gives them the same paper, a slim
// wordmark bar that returns to Studio, sibling links between the two pages,
// and the shared content column.

import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { StrandMark } from '@/components/illustrations/StrandMark';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export function StandaloneFrame({ children }: { children: React.ReactNode }) {
	const { user } = useAuth();
	const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
	const links = [
		...(isAdmin ? [{ to: '/code', label: 'Token dashboard' }] : []),
		{ to: '/claude-sessions', label: 'Sessions' },
	];
	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
				<div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-5 sm:px-8">
					<Link
						to="/studio"
						className="group inline-flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
						aria-label="Back to Lumid Studio"
					>
						<ArrowLeft className="h-3.5 w-3.5 text-ink-500 transition-transform duration-180 group-hover:-translate-x-0.5" aria-hidden />
						<StrandMark size={20} className="-mt-0.5" />
						<span className="font-display text-title font-medium text-ink-900">Lumid</span>
					</Link>
					{links.length > 1 && (
						<nav className="ml-2 flex items-center gap-1" aria-label="Claude pool">
							{links.map((l) => (
								<NavLink
									key={l.to}
									to={l.to}
									className={({ isActive }) =>
										cn(
											'rounded-full px-3 py-1 text-meta font-medium transition-colors duration-180',
											isActive ? 'bg-ink-900 text-ink-50' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
										)
									}
								>
									{l.label}
								</NavLink>
							))}
						</nav>
					)}
				</div>
			</header>
			<main className="mx-auto w-full max-w-[1280px] px-5 pb-16 sm:px-8 animate-lumen-rise">{children}</main>
		</div>
	);
}
