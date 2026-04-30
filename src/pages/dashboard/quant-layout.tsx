import { NavLink, Outlet } from 'react-router-dom';

// Layout shell for the migrated Lumid-Market pages under
// /dashboard/quant/*. Each ported page already renders its own h1
// and tagline (Strategy, Ranking, Backtesting, …), so this layout
// only contributes the tab bar — no redundant "Lumid Market" hero
// stack on top of the page header.
//
// Two pages were promoted out of this sub-nav on 2026-04-30:
//   - Market data → top-level "Datasets" section (cross-pipeline,
//     not LQA-only). Route still resolves at /dashboard/quant/
//     market-data.
//   - Trading jobs → unified Running-jobs page at /dashboard/jobs
//     with a Source: All / Quant / Lumid filter. The legacy route
//     /dashboard/quant/flowmesh-jobs redirects to ?source=quant.

const TABS: { to: string; label: string }[] = [
	{ to: '/dashboard/quant/competition', label: 'Competition' },
	{ to: '/dashboard/quant/strategy', label: 'Strategy' },
	{ to: '/dashboard/quant/backtesting', label: 'Backtesting' },
	{ to: '/dashboard/quant/ranking', label: 'Ranking' },
	{ to: '/dashboard/quant/template', label: 'Templates' },
	{ to: '/dashboard/quant/datasource', label: 'Data sources' },
];

export default function QuantLayout() {
	return (
		<div className="-mx-4 md:-mx-8 -mt-6">
			<div className="sticky top-0 md:top-0 z-20 bg-slate-50/95 backdrop-blur border-b border-slate-200 px-4 md:px-8">
				<nav className="flex gap-5 overflow-x-auto -mb-px">
					{TABS.map((it) => (
						<NavLink
							key={it.to}
							to={it.to}
							className={({ isActive }) =>
								`py-3 text-[13px] border-b-2 transition-colors whitespace-nowrap ${
									isActive
										? 'text-indigo-700 border-indigo-500 font-medium'
										: 'text-slate-500 border-transparent hover:text-slate-800'
								}`
							}
						>
							{it.label}
						</NavLink>
					))}
				</nav>
			</div>
			<div className="px-4 md:px-8 pt-5">
				<Outlet />
			</div>
		</div>
	);
}
