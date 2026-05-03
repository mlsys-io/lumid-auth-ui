import { NavLink, Outlet } from 'react-router-dom';
import { TooltipProvider } from '../../components/ui/tooltip';
import { cn } from '../../lib/utils';

// 2026-05-03 — single page for "everything competitions" with a
// two-tab strip: Browse (lobby of all competitions) and My
// strategies (the cross-competition simulation roster). Replaces
// what used to be two separate sidebar entries; the parent
// /dashboard/quant/competition route in the global sidebar now
// points here.
//
// Pathways and per-competition detail pages still render directly
// (without these tabs) because they're not list-views — they have
// their own page shape.
const TABS: { to: string; label: string; end?: boolean }[] = [
	{ to: 'lobby', label: 'Browse' },
	{ to: 'my', label: 'My strategies' },
];

export default function Competitions() {
	return (
		<TooltipProvider>
			<div className="mb-4">
				<h1 className="text-3xl font-bold">Competitions</h1>
				<p className="text-muted-foreground">
					Browse open competitions, register a strategy, and watch it run.
				</p>
			</div>
			<div className="border-b border-slate-200 mb-5">
				<nav className="flex gap-5 -mb-px">
					{TABS.map((t) => (
						<NavLink
							key={t.to}
							to={t.to}
							end={t.end}
							className={({ isActive }) =>
								cn(
									'py-2 text-sm border-b-2 transition-colors whitespace-nowrap',
									isActive
										? 'text-indigo-700 border-indigo-500 font-medium'
										: 'text-slate-500 border-transparent hover:text-slate-800',
								)
							}
						>
							{t.label}
						</NavLink>
					))}
				</nav>
			</div>
			<Outlet />
		</TooltipProvider>
	);
}
