// IndexList — the one claude.ai-style index every Studio nav page renders
// through. It extracts the pattern common to every app/entity (an icon, a
// name, one status line, a health tone, and an "ask about it" affordance)
// and routes them ALL through the same conversational interface: clicking a
// row drops you into the grounded chat.
//
// This is deliberately NOT a dashboard. No tables, no stat-chip clutter, no
// master-detail. Hairline-divided rows, ink text, a single tone dot for
// color, one metadata line. The same visual vocabulary as the chat's inline
// entity cards (chat/entityCards.tsx), so the index and the chat's answer
// read as one continuous surface.
//
// Each row carries an `ask` (prompt + optional ViewingContext). On click,
// fireAsk() reads the landing preference and dispatches `studio:ask` with
// autosend set accordingly — the existing StudioShell→StudioChat bridge
// handles navigation + (auto-send | pre-fill). The dense detail surfaces of
// old (observability panels, run inspectors, install drawers) survive as a
// quiet hover-only "details →" escape hatch via `detailsHref`.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TONES, type ToneKey } from '@/lib/tones';
import type { ViewingContext } from '@/components/StudioContext';
import { setStudioSelection, type StudioSelectionKind } from '@/components/StudioContext';
import { getLandingPref } from '@/lib/landing-pref';

export interface IndexAsk {
	prompt: string;
	context?: Partial<ViewingContext>;
	/** Optional grounding selection applied on the ready-to-type path so the
	 *  chat shows a context chip even before the user sends. */
	selection?: { kind: StudioSelectionKind; id: string; label?: string };
}

export interface IndexRow {
	id: string;
	title: string;
	/** One-line metadata (e.g. "healthy · 5m ago"). Kept terse. */
	meta?: string;
	icon?: LucideIcon;
	tone?: ToneKey;
	/** Short status word shown right-aligned, colored by tone. */
	statusLabel?: string;
	/** Light grouping label (e.g. the app's ui.sidebar.section). */
	section?: string;
	/** The grounded prompt fired on click — the conversational interface. */
	ask: IndexAsk;
	/** Quiet hover-only escape hatch to the old dense detail surface. */
	detailsHref?: string;
}

/** Fire a grounded ask into the chat, honoring the landing preference. */
export function fireAsk(ask: IndexAsk): void {
	const autosend = getLandingPref() === 'ask';
	if (!autosend && ask.selection) {
		// Ready-to-type: set the page selection so the chat surfaces a context
		// chip while the user edits the pre-filled prompt.
		setStudioSelection({ ...ask.selection });
	}
	window.dispatchEvent(new CustomEvent('studio:ask', {
		detail: { prompt: ask.prompt, autosend, context: ask.context },
	}));
}

function Row({ row }: { row: IndexRow }) {
	const Icon = row.icon;
	const tone = row.tone ? TONES[row.tone] : null;
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => fireAsk(row.ask)}
			onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fireAsk(row.ask); } }}
			className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg hover:bg-muted transition-colors"
		>
			{tone ? (
				<span className={`w-2 h-2 rounded-full shrink-0 ${tone.dot}`} />
			) : Icon ? (
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
			) : (
				<span className="w-2 h-2 shrink-0" />
			)}
			<div className="min-w-0 flex-1">
				<div className="text-[14px] text-foreground truncate">{row.title}</div>
				{row.meta && <div className="text-[11.5px] text-muted-foreground truncate">{row.meta}</div>}
			</div>
			{row.statusLabel && (
				<span className={`text-[11px] shrink-0 ${tone ? tone.text : 'text-muted-foreground'}`}>
					{row.statusLabel}
				</span>
			)}
			{row.detailsHref && (
				<Link
					to={row.detailsHref}
					onClick={(e) => e.stopPropagation()}
					className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
					title="Open the full details view"
				>
					details <ArrowUpRight className="w-3 h-3" />
				</Link>
			)}
		</div>
	);
}

export interface IndexListProps {
	title: string;
	rows: IndexRow[];
	/** Show the search box (client-side filter on title + meta). */
	search?: boolean;
	searchPlaceholder?: string;
	/** Shown above the list (e.g. tabs); below the title. */
	toolbar?: React.ReactNode;
	/** Shown below the list (e.g. a "set up a new app" launcher). */
	footer?: React.ReactNode;
	/** Rendered when there are zero rows (and no active search). */
	empty?: React.ReactNode;
	/** Order sections appear in. Unlisted sections sort after, alphabetically. */
	sectionOrder?: string[];
}

export default function IndexList({
	title, rows, search, searchPlaceholder, toolbar, footer, empty, sectionOrder,
}: IndexListProps) {
	const [q, setQ] = useState('');

	const filtered = useMemo(() => {
		if (!q.trim()) return rows;
		const needle = q.toLowerCase();
		return rows.filter((r) =>
			r.title.toLowerCase().includes(needle) || (r.meta || '').toLowerCase().includes(needle));
	}, [rows, q]);

	// Group by section, preserving sectionOrder then alpha. Rows without a
	// section land in a single unlabeled lead group.
	const groups = useMemo(() => {
		const bySection = new Map<string, IndexRow[]>();
		for (const r of filtered) {
			const k = r.section || '';
			const arr = bySection.get(k);
			if (arr) arr.push(r); else bySection.set(k, [r]);
		}
		const order = (s: string) => {
			if (s === '') return -1; // unlabeled group leads
			const i = sectionOrder?.indexOf(s) ?? -1;
			return i >= 0 ? i : 1000;
		};
		return [...bySection.entries()].sort((a, b) => {
			const d = order(a[0]) - order(b[0]);
			return d !== 0 ? d : a[0].localeCompare(b[0]);
		});
	}, [filtered, sectionOrder]);

	return (
		<div className="max-w-[760px] mx-auto w-full px-1 py-2">
			<div className="flex items-center gap-3 mb-4 px-2">
				<h1 className="font-display text-[26px] font-medium tracking-tight text-foreground flex-1">{title}</h1>
				{search && (
					<div className="relative w-48">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
						<input
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder={searchPlaceholder || 'Search…'}
							className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-full border border-border bg-card focus:outline-none focus:border-foreground/25 placeholder:text-muted-foreground transition-colors"
						/>
					</div>
				)}
			</div>

			{toolbar && <div className="mb-3 px-2">{toolbar}</div>}

			{filtered.length === 0 ? (
				<div className="px-2 py-12 text-center text-[13px] text-muted-foreground">
					{q.trim() ? `No matches for “${q}”.` : (empty ?? 'Nothing here yet.')}
				</div>
			) : (
				<div className="space-y-4">
					{groups.map(([section, sectionRows]) => (
						<div key={section || '_'}>
							{section && (
								<div className="px-3 mb-0.5 text-[11px] font-medium tracking-wide text-foreground/45 uppercase">{section}</div>
							)}
							<div className="divide-y divide-border/60">
								{sectionRows.map((r) => <Row key={r.id} row={r} />)}
							</div>
						</div>
					))}
				</div>
			)}

			{footer && <div className="mt-6 px-2">{footer}</div>}
		</div>
	);
}
