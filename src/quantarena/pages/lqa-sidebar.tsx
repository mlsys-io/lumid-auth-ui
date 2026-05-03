import { useEffect, useMemo, useState } from 'react';
import { NavLink, useResolvedPath, useMatch } from 'react-router-dom';
import { LayoutGrid, Activity, Code2, Database, BookOpen } from 'lucide-react';
import { getSimulationStrategies, ApiError } from '../api';
import type { SimulationStrategyInfo } from '../api/types';
import { cn } from '../lib/utils';

// Single sidebar for the entire LQA shell (was: outer horizontal
// QuantLayout strip + inner CompetitionShell sidebar — collapsed on
// 2026-05-03 because three navigation surfaces in one page was one
// too many). Sections:
//
//   1. Compete       — Browse + My strategies (cross-competition)
//   2. My contests  — derived client-side from getSimulationStrategies;
//                     only renders if the user has joined any. Sorted
//                     Competing-first.
//   3. Build         — Strategy (backtests) + Data sources
//   4. Reference     — Pathways (REST vs MCP snippets)
//
// All NavLinks use paths relative to /dashboard/quant; the parent
// QuantLayout route at /quant catches them. URLs are unchanged from
// the prior CompetitionShell layout so deep-links keep working —
// only the rendering shell consolidates.

type Joined = {
	competition_id: number;
	competition_name: string;
	competing: boolean;
};

const ROSTER_INVALIDATE_EVENT = 'competition-roster:invalidate';

function deriveJoined(strategies: SimulationStrategyInfo[]): Joined[] {
	const byId = new Map<number, Joined>();
	for (const s of strategies) {
		if (!s.competition_id) continue;
		const existing = byId.get(s.competition_id);
		const competing = s.status === 'Competing';
		if (existing) {
			existing.competing = existing.competing || competing;
		} else {
			byId.set(s.competition_id, {
				competition_id: s.competition_id,
				competition_name: s.competition_name ?? `Competition ${s.competition_id}`,
				competing,
			});
		}
	}
	return Array.from(byId.values()).sort((a, b) => {
		if (a.competing !== b.competing) return a.competing ? -1 : 1;
		return a.competition_name.localeCompare(b.competition_name);
	});
}

export function LqaSidebar({ onNavigate }: { onNavigate?: () => void }) {
	const [joined, setJoined] = useState<Joined[]>([]);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const r = await getSimulationStrategies({ page: 1, page_size: 200 });
				if (!cancelled) setJoined(deriveJoined(r.data?.strategies ?? []));
			} catch (e) {
				if (e instanceof ApiError && e.ret_code === 401) return;
				// non-fatal — sidebar just shows an empty My contests section
			}
		};
		load();
		const handler = () => load();
		window.addEventListener(ROSTER_INVALIDATE_EVENT, handler);
		return () => {
			cancelled = true;
			window.removeEventListener(ROSTER_INVALIDATE_EVENT, handler);
		};
	}, []);

	const competeLinks = useMemo(
		() => [
			{ to: 'competition/lobby', label: 'Browse', icon: LayoutGrid },
			{ to: 'competition/my', label: 'My strategies', icon: Activity },
		],
		[],
	);

	const buildLinks = useMemo(
		() => [
			{ to: 'strategy', label: 'Strategy', icon: Code2 },
			{ to: 'datasource', label: 'Data sources', icon: Database },
		],
		[],
	);

	return (
		<aside className="flex flex-col gap-6 py-4 pr-3 text-sm">
			<Section heading="Compete">
				{competeLinks.map((it) => (
					<SidebarLink key={it.to} to={it.to} onNavigate={onNavigate}>
						<it.icon className="w-4 h-4" />
						{it.label}
					</SidebarLink>
				))}
			</Section>

			{joined.length > 0 && (
				<Section heading="My contests">
					{joined.map((c) => (
						<ContestLink
							key={c.competition_id}
							to={`competition/${c.competition_id}`}
							competing={c.competing}
							onNavigate={onNavigate}
						>
							{c.competition_name}
						</ContestLink>
					))}
				</Section>
			)}

			<Section heading="Build">
				{buildLinks.map((it) => (
					<SidebarLink key={it.to} to={it.to} onNavigate={onNavigate}>
						<it.icon className="w-4 h-4" />
						{it.label}
					</SidebarLink>
				))}
			</Section>

			<Section heading="Reference">
				<SidebarLink to="competition/pathways" onNavigate={onNavigate}>
					<BookOpen className="w-4 h-4" />
					Pathways
				</SidebarLink>
			</Section>
		</aside>
	);
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<div className="text-[11px] uppercase tracking-wide text-slate-400 px-2 mb-0.5">
				{heading}
			</div>
			{children}
		</div>
	);
}

function SidebarLink({
	to,
	onNavigate,
	children,
}: {
	to: string;
	onNavigate?: () => void;
	children: React.ReactNode;
}) {
	return (
		<NavLink
			to={to}
			end={false}
			onClick={onNavigate}
			className={({ isActive }) =>
				cn(
					'flex items-center gap-2 px-2 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors',
					isActive && 'bg-indigo-50 text-indigo-700 font-medium hover:bg-indigo-50',
				)
			}
		>
			{children}
		</NavLink>
	);
}

// Per-contest entry uses useMatch on the dynamic competition path —
// NavLink's default isActive treats every numeric :competitionId
// route as the same match, so Crypto Live would highlight when NVDA
// Q2 is selected. We resolve the relative path and compare exactly
// instead.
function ContestLink({
	to,
	competing,
	onNavigate,
	children,
}: {
	to: string;
	competing: boolean;
	onNavigate?: () => void;
	children: React.ReactNode;
}) {
	const resolved = useResolvedPath(to);
	const match = useMatch({ path: resolved.pathname + '/*', end: false });
	const isActive = !!match;
	return (
		<NavLink
			to={to}
			onClick={onNavigate}
			className={cn(
				'flex items-center gap-2 px-2 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors',
				isActive && 'bg-indigo-50 text-indigo-700 font-medium hover:bg-indigo-50',
			)}
		>
			<span
				className={cn(
					'inline-block w-1.5 h-1.5 rounded-full mr-1 flex-none',
					competing ? 'bg-emerald-500' : 'bg-slate-300',
				)}
				aria-hidden
			/>
			<span className="truncate">{children}</span>
		</NavLink>
	);
}

export function dispatchRosterInvalidate() {
	window.dispatchEvent(new CustomEvent(ROSTER_INVALIDATE_EVENT));
}
