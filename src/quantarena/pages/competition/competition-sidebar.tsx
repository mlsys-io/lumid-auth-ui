import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid, Activity, BookOpen } from 'lucide-react';
import { getSimulationStrategies, ApiError } from '../../api';
import type { SimulationStrategyInfo } from '../../api/types';
import { cn } from '../../lib/utils';

// Sidebar for the Competition shell — three sections:
//   1. Browse  — Lobby (all competitions) + My strategies (cross-comp)
//   2. My contests — competitions the user has at least one
//      simulation strategy for, derived client-side from the
//      getSimulationStrategies roster (option (b) — no backend
//      change). Sorted "Competing first, then Idle"; secondary
//      sort by name.
//   3. Reference — Pathways (REST vs MCP snippets).
//
// The fetch runs once when the shell mounts; refresh when a strategy
// is created/deleted is via the `competition-roster:invalidate`
// custom event (the create-strategy dialog dispatches it after a
// successful POST).

type Joined = {
	competition_id: number;
	competition_name: string;
	competing: boolean; // true if any strategy on it has status=Competing
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

export function CompetitionSidebar({ onNavigate }: { onNavigate?: () => void }) {
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

	const browseLinks = useMemo(
		() => [
			{ to: 'lobby', label: 'Lobby', icon: LayoutGrid },
			{ to: 'my', label: 'My strategies', icon: Activity },
		],
		[],
	);

	return (
		<aside className="flex flex-col gap-6 py-4 pr-3 text-sm">
			<Section heading="Browse">
				{browseLinks.map((it) => (
					<SidebarLink key={it.to} to={it.to} onNavigate={onNavigate}>
						<it.icon className="w-4 h-4" />
						{it.label}
					</SidebarLink>
				))}
			</Section>

			{joined.length > 0 && (
				<Section heading="My contests">
					{joined.map((c) => (
						<SidebarLink
							key={c.competition_id}
							to={String(c.competition_id)}
							onNavigate={onNavigate}
						>
							<span
								className={cn(
									'inline-block w-1.5 h-1.5 rounded-full mr-1 flex-none',
									c.competing ? 'bg-emerald-500' : 'bg-slate-300',
								)}
								aria-hidden
							/>
							<span className="truncate">{c.competition_name}</span>
						</SidebarLink>
					))}
				</Section>
			)}

			<Section heading="Reference">
				<SidebarLink to="pathways" onNavigate={onNavigate}>
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
			end={to === 'lobby' || to === 'my' || to === 'pathways' ? false : true}
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

export function dispatchRosterInvalidate() {
	window.dispatchEvent(new CustomEvent(ROSTER_INVALIDATE_EVENT));
}
