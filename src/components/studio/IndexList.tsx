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
// fireAsk() dispatches `studio:ask`; the chat pre-fills the prompt and the
// user sends it (StudioShell parks it first when no chat is mounted). The dense detail surfaces of
// old (observability panels, run inspectors, install drawers) survive as a
// quiet hover-only "details →" escape hatch via `detailsHref`.

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { NoMatches } from '@/components/illustrations/scenes';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, MessageSquare, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TONES, type ToneKey } from '@/lib/tones';
import type { ViewingContext } from '@/components/StudioContext';
import { setStudioSelection, type StudioSelectionKind } from '@/components/StudioContext';

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
	/** Tooltip for the status word (e.g. what the source system said). */
	statusTitle?: string;
	/** Light grouping label (e.g. the app's ui.sidebar.section). */
	section?: string;
	/** The grounded prompt fired on click — the conversational interface. */
	ask: IndexAsk;
	/** Quiet hover-only escape hatch to the old dense detail surface. */
	detailsHref?: string;
	/** When set, the PRIMARY click navigates here (e.g. an app's overview page)
	 *  instead of opening the chat; the grounded `ask` then moves to a quiet
	 *  hover "ask" affordance. Apps use this so a row click lands on the
	 *  overview, not the conversation. */
	navTo?: string;
	/** With navTo: show the "ask" button always, not only on hover. */
	askVisible?: boolean;
}

/** Fire a grounded ask into the chat: it pre-fills; the user sends. */
export function fireAsk(ask: IndexAsk): void {
	// Set the page selection so the chat shows a context chip while the user
	// reviews the pre-filled prompt.
	if (ask.selection) setStudioSelection({ ...ask.selection });
	window.dispatchEvent(new CustomEvent('studio:ask', {
		detail: { prompt: ask.prompt, context: ask.context },
	}));
}

function Row({ row }: { row: IndexRow }) {
	const navigate = useNavigate();
	const Icon = row.icon;
	const tone = row.tone ? TONES[row.tone] : null;
	// navTo rows (apps) open their overview on click; everything else opens the
	// grounded chat (the conversational index).
	const activate = () => { if (row.navTo) navigate(row.navTo); else fireAsk(row.ask); };
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={activate}
			onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
			className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-lg hover:bg-ink-100/60 transition-colors duration-120"
		>
			{tone ? (
				<span className={`w-2 h-2 rounded-full shrink-0 ${tone.dot}`} />
			) : Icon ? (
				<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
			) : (
				<span className="w-2 h-2 shrink-0" />
			)}
			<div className="min-w-0 flex-1">
				<div className="text-body text-foreground truncate">{row.title}</div>
				{row.meta && <div className="text-caption text-muted-foreground truncate">{row.meta}</div>}
			</div>
			{row.statusLabel && (
				<span className={`text-micro shrink-0 ${tone ? tone.text : 'text-muted-foreground'}`} title={row.statusTitle}>
					{row.statusLabel}
				</span>
			)}
			{row.navTo ? (
				// Primary click already opens the overview — the chat is the quiet
				// hover affordance here.
				<button
					type="button"
					onClick={(e) => { e.stopPropagation(); fireAsk(row.ask); }}
					className={row.askVisible
						? "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border text-micro text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
						: "shrink-0 inline-flex items-center gap-0.5 text-micro text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"}
					title="Ask the AI about this"
				>
					{row.askVisible ? <>Ask <MessageSquare className="w-3 h-3" /></> : <>ask <MessageSquare className="w-3 h-3" /></>}
				</button>
			) : row.detailsHref ? (
				<Link
					to={row.detailsHref}
					onClick={(e) => e.stopPropagation()}
					className="shrink-0 inline-flex items-center gap-0.5 text-micro text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
					title="Open the full details view"
				>
					details <ArrowUpRight className="w-3 h-3" />
				</Link>
			) : null}
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
	/** Rendered when there are zero rows (and no active search). A string is
	 *  the empty state's teaching line; pair it with `emptyTitle`/`emptyArt`. */
	empty?: React.ReactNode;
	/** Lumen empty state: a short title over `empty`, led by a Strands scene. */
	emptyTitle?: string;
	emptyArt?: React.ReactNode;
	/** Rows are still loading — render skeleton rows, NOT the empty copy
	 *  (Skills/Studies/Runs used to say "nothing here" while fetching). */
	loading?: boolean;
	/** Hide the serif title row (the page above already names it, e.g. a
	 *  Library tab). The search box moves to the toolbar line. */
	showTitle?: boolean;
	/** A failed load: render ErrorState with Retry instead of an empty list. */
	error?: unknown;
	onRetry?: () => void;
	/** Order sections appear in. Unlisted sections sort after, alphabetically. */
	sectionOrder?: string[];
}

export default function IndexList({
	title, rows, search, searchPlaceholder, toolbar, footer, empty, sectionOrder,
	emptyTitle, emptyArt, loading, error, onRetry, showTitle = true,
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
		<div className={showTitle ? "max-w-[760px] mx-auto w-full px-1 py-2" : "max-w-[760px] w-full"}>
			<div className={showTitle ? "flex items-center gap-3 mb-4 px-2" : "flex items-center justify-end gap-3 mb-3 px-2 empty:hidden"}>
				{showTitle && <h1 className="font-display text-h2 font-medium tracking-tight text-foreground flex-1">{title}</h1>}
				{search && (
					<div className="relative w-48">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-500" />
						<input
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder={searchPlaceholder || 'Search…'}
							className="w-full h-8 pl-8 pr-3 text-meta rounded-full border border-border bg-card shadow-e1 outline-none focus:border-ring/70 focus:ring-4 focus:ring-ring/15 placeholder:text-ink-500 transition-[border-color,box-shadow] duration-120"
						/>
					</div>
				)}
			</div>

			{toolbar && <div className="mb-3 px-2">{toolbar}</div>}

			{error ? (
				<ErrorState error={error} what={title.toLowerCase()} onRetry={onRetry} size="sm" />
			) : loading ? (
				// Skeleton rows in the list's own shape, so nothing jumps on arrival.
				<div className="divide-y divide-border/60" role="status" aria-label={`Loading ${title.toLowerCase()}`}>
					{[72, 54, 64, 48, 60].map((w, i) => (
						<div key={i} className="flex items-center gap-3 px-3 py-3">
							<Skeleton className="h-2 w-2 rounded-full" />
							<div className="flex-1 space-y-1.5">
								<Skeleton className="h-3 rounded-full" style={{ width: `${w}%` }} />
								<Skeleton className="h-2.5 rounded-full" style={{ width: `${w - 22}%` }} />
							</div>
						</div>
					))}
				</div>
			) : filtered.length === 0 ? (
				q.trim() ? (
					<EmptyState
						size="sm"
						framed={false}
						art={<NoMatches />}
						title={`No matches for “${q.trim()}”`}
						body="Try a shorter word, or clear the search to see everything."
						actionLabel="Clear search"
						onAction={() => setQ('')}
					/>
				) : typeof empty === 'string' || emptyTitle || emptyArt ? (
					<EmptyState
						art={emptyArt}
						title={emptyTitle ?? (typeof empty === 'string' ? empty : 'Nothing here yet')}
						body={emptyTitle ? empty : undefined}
					/>
				) : (
					<div className="px-2 py-12 text-center text-meta text-ink-600">{empty ?? 'Nothing here yet.'}</div>
				)
			) : (
				<div className="space-y-5">
					{groups.map(([section, sectionRows], gi) => (
						<div key={section || '_'}>
							{section && <div className="eyebrow px-3 mb-1">{section}</div>}
							<div className="divide-y divide-border/60">
								{sectionRows.map((r, i) => (
									// First screenful staggers in (<= 8 rows, 30ms apart).
									<div
										key={r.id}
										className={gi === 0 && i < 8 ? 'animate-lumen-rise' : undefined}
										style={gi === 0 && i < 8 ? { animationDelay: `${i * 30}ms` } : undefined}
									>
										<Row row={r} />
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{footer && <div className="mt-6 px-2">{footer}</div>}
		</div>
	);
}
