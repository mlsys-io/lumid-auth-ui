/**
 * Operations status page — `/status/operations`. super_admin-gated
 * (SuperAdminGuard at the route in App.tsx).
 *
 * A live, richer analogue of lum.id/findata/status. It reads the
 * whole-stack `stack_check` scorecard plus the per-box venue-health and
 * per-scope resource-usage readers from the LQT gateway (lumid.trade),
 * using the shared `getJson` helper from src/lqt/utils/axios.ts which
 * forwards a short-lived scoped session-bearer cross-domain.
 *
 * Endpoints (all served by the gateway; built in parallel — Stream D):
 *   GET /lqt/stack-check              → { rows: StackCheckRow[] }
 *   GET /lqt/resource-usage/:scope    → { boxes: ResourceUsageBox[] }
 *   GET /lqt/venue-health/:box        → { venues: VenueHealthEntry[] }
 *
 * Any endpoint that 404s (probe not deployed yet) degrades to a graceful
 * "not yet available" panel rather than blanking the page. Auto-refreshes
 * every ~30s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, RefreshCcw, Server } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { getJson, LqtGatewayError } from '@/lqt/utils/axios';

// ---- wire types (mirror the Stream D scorecard readers) ----

type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | string;

interface StackCheckRow {
	dimension: string;
	check_name: string;
	status: CheckStatus;
	detail?: string;
	remediation?: string;
	cadence?: string;
	ts?: string;
}

interface StackCheckBody {
	rows: StackCheckRow[];
}

interface ResourceUsageBox {
	box: string;
	cpu_pct?: number | null;
	mem_pct?: number | null;
	disk_pct?: number | null;
	load1?: number | null;
	load5?: number | null;
	ncpu?: number | null;
	ts?: string;
}

interface ResourceUsageBody {
	boxes: ResourceUsageBox[];
}

interface VenueHealthEntry {
	venue: string;
	status?: CheckStatus;
	book_age_ms?: number | null;
	detail?: string;
	ts?: string;
}

interface VenueHealthBody {
	box: string;
	venues: VenueHealthEntry[];
}

// The lqt read endpoints return BARE ARRAYS of raw obs.* rows (full history, snake_case
// columns like `box_id`/`check_name`). Normalize each to the wrapped, latest-run shape the
// section components consume (tolerant of both a bare array and a pre-wrapped object).
/* eslint-disable @typescript-eslint/no-explicit-any */
function latestKey(r: any): string {
	return String(r.run_id ?? r.ts ?? '');
}
function normStackCheck(raw: unknown): StackCheckBody {
	const arr: any[] = Array.isArray(raw) ? raw : ((raw as any)?.rows ?? []);
	if (arr.length === 0) return { rows: [] };
	// Show each check's CURRENT status: keep the latest row per (dimension, check_name)
	// across all runs. obs.stack_check interleaves the periodic full 17-dimension sweep with
	// lightweight opsagent heartbeats, so a naive "latest run_id" would surface only the
	// heartbeat (one `opsagent` row). Latest-per-check surfaces every dimension.
	const byCheck = new Map<string, any>();
	for (const r of arr) {
		const k = `${r.dimension} ${r.check_name ?? r.check}`;
		const prev = byCheck.get(k);
		if (!prev || latestKey(r) > latestKey(prev)) byCheck.set(k, r);
	}
	const rows = [...byCheck.values()].map((r) => ({
		dimension: r.dimension,
		check_name: r.check_name ?? r.check,
		status: r.status,
		detail: r.detail,
		remediation: r.remediation,
		cadence: r.cadence,
		ts: r.ts,
	}));
	return { rows };
}
function normResource(raw: unknown): ResourceUsageBody {
	const arr: any[] = Array.isArray(raw) ? raw : ((raw as any)?.boxes ?? []);
	const byBox = new Map<string, any>();
	for (const r of arr) {
		const b = r.box ?? r.box_id ?? r.name ?? 'unknown';
		const prev = byBox.get(b);
		if (!prev || String(r.ts ?? '') > String(prev.ts ?? '')) byBox.set(b, r);
	}
	const boxes = [...byBox.entries()].map(([box, r]) => ({
		box,
		cpu_pct: r.cpu_pct,
		mem_pct: r.mem_pct,
		disk_pct: r.disk_pct,
		load1: r.load1,
		load5: r.load5,
		ncpu: r.ncpu,
		ts: r.ts,
	}));
	return { boxes };
}
function normVenue(raw: unknown): VenueHealthBody {
	const arr: any[] = Array.isArray(raw) ? raw : ((raw as any)?.venues ?? []);
	const byV = new Map<string, any>();
	for (const r of arr) {
		const v = r.venue ?? r.name ?? 'unknown';
		const prev = byV.get(v);
		if (!prev || String(r.ts ?? '') > String(prev.ts ?? '')) byV.set(v, r);
	}
	const venues = [...byV.entries()].map(([venue, r]) => {
		// The obs.venue_health feed carries ws_connected + last_msg_age_s (not a
		// precomputed status/book_age). Derive: disconnected → FAIL; connected but
		// the last message is stale (>120s) → WARN; else PASS. book_age ← last_msg_age.
		const ageS = r.last_msg_age_s ?? null;
		let status = r.status as string | undefined;
		if (!status) {
			if (r.ws_connected === false) status = 'FAIL';
			else if (ageS != null && ageS > 120) status = 'WARN';
			else if (r.ws_connected === true) status = 'PASS';
			else status = 'UNKNOWN';
		}
		return {
			venue,
			status,
			book_age_ms: r.book_age_ms ?? (ageS != null ? Math.round(ageS * 1000) : undefined),
			detail: r.detail ?? (r.feed ? `feed=${r.feed}` : undefined),
			ts: r.ts,
		};
	});
	return { box: '', venues };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// A section's fetch resolves to one of: data | not-available (404) | error.
type SectionState<T> =
	| { kind: 'loading' }
	| { kind: 'ok'; data: T }
	| { kind: 'unavailable' } // 404 — probe not deployed yet
	| { kind: 'error'; message: string };

// Fetch a gateway path into a SectionState, mapping 404 → unavailable so a
// not-yet-deployed probe shows a graceful placeholder instead of an error.
async function fetchSection<T>(
	path: string,
	normalize?: (raw: unknown) => T,
): Promise<SectionState<T>> {
	try {
		const raw = await getJson<unknown>(path);
		const data = normalize ? normalize(raw) : (raw as T);
		return { kind: 'ok', data };
	} catch (e) {
		if (e instanceof LqtGatewayError && e.status === 404) {
			return { kind: 'unavailable' };
		}
		const message =
			e instanceof LqtGatewayError
				? `${e.message}${e.status ? ` (${e.status})` : ''}`
				: String(e);
		return { kind: 'error', message };
	}
}

// The boxes we probe venue health for. If a box has no venues (or 404s),
// its strip is simply omitted / shown as unavailable.
const VENUE_BOXES = ['denmark', 'nyc', 'chicago'] as const;
const RESOURCE_SCOPE = 'host';

const REFRESH_MS = 30_000;

// ---- status → color helpers ----

function statusRank(s: CheckStatus): number {
	const u = (s || '').toUpperCase();
	if (u === 'FAIL') return 0;
	if (u === 'WARN') return 1;
	if (u === 'PASS') return 2;
	return 3;
}

function worstStatus(rows: { status: CheckStatus }[]): CheckStatus {
	if (rows.length === 0) return 'UNKNOWN';
	return rows.slice().sort((a, b) => statusRank(a.status) - statusRank(b.status))[0].status;
}

function chipClasses(s: CheckStatus): string {
	const u = (s || '').toUpperCase();
	if (u === 'PASS') return 'bg-green-100 text-green-800 border-green-200';
	if (u === 'WARN') return 'bg-amber-100 text-amber-800 border-amber-200';
	if (u === 'FAIL') return 'bg-red-100 text-red-800 border-red-200';
	return 'bg-gray-100 text-gray-700 border-gray-200';
}

function borderClasses(s: CheckStatus): string {
	const u = (s || '').toUpperCase();
	if (u === 'PASS') return 'border-l-green-500';
	if (u === 'WARN') return 'border-l-amber-500';
	if (u === 'FAIL') return 'border-l-red-500';
	return 'border-l-gray-300';
}

function StatusChip({ status }: { status: CheckStatus }) {
	return (
		<span
			className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipClasses(
				status,
			)}`}
		>
			{status || '—'}
		</span>
	);
}

function pctTone(pct: number | null | undefined): string {
	if (pct == null) return 'text-gray-500';
	if (pct >= 90) return 'text-red-600 font-semibold';
	if (pct >= 80) return 'text-amber-600 font-medium';
	return 'text-green-600';
}

function fmtTs(ts?: string): string {
	if (!ts) return '—';
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return ts;
	const ageS = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
	if (ageS < 60) return `${ageS}s ago`;
	if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
	if (ageS < 86400) return `${Math.floor(ageS / 3600)}h ago`;
	return `${Math.floor(ageS / 86400)}d ago`;
}

// ---- small placeholders reused by every section ----

function SectionUnavailable({ what }: { what: string }) {
	return (
		<div className="rounded border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-muted-foreground">
			<div className="font-medium text-gray-700">{what} not yet available</div>
			<div className="text-xs mt-1">
				The probe endpoint returned 404 — it hasn&apos;t been deployed to the
				gateway yet. This section will populate automatically once the reader
				ships.
			</div>
		</div>
	);
}

function SectionError({ what, message }: { what: string; message: string }) {
	return (
		<div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
			<div className="font-medium flex items-center gap-1.5">
				<AlertTriangle className="w-3.5 h-3.5" />
				{what} unavailable
			</div>
			<div className="text-xs mt-1 font-mono break-all">{message}</div>
		</div>
	);
}

function SectionLoading() {
	return (
		<div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
			<Loader2 className="w-4 h-4 animate-spin" />
			Loading…
		</div>
	);
}

// ---- Scorecard: per-dimension summary + expandable per-check table ----

function ScorecardSection({ state }: { state: SectionState<StackCheckBody> }) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const dims = useMemo(() => {
		if (state.kind !== 'ok') return [];
		const byDim = new Map<string, StackCheckRow[]>();
		for (const row of state.data.rows) {
			const list = byDim.get(row.dimension) ?? [];
			list.push(row);
			byDim.set(row.dimension, list);
		}
		return Array.from(byDim.entries())
			.map(([dimension, rows]) => {
				const counts = { PASS: 0, WARN: 0, FAIL: 0, OTHER: 0 };
				for (const r of rows) {
					const u = (r.status || '').toUpperCase();
					if (u === 'PASS') counts.PASS++;
					else if (u === 'WARN') counts.WARN++;
					else if (u === 'FAIL') counts.FAIL++;
					else counts.OTHER++;
				}
				return { dimension, rows, counts, worst: worstStatus(rows) };
			})
			.sort((a, b) => {
				const r = statusRank(a.worst) - statusRank(b.worst);
				return r !== 0 ? r : a.dimension.localeCompare(b.dimension);
			});
	}, [state]);

	const toggle = (dim: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(dim)) next.delete(dim);
			else next.add(dim);
			return next;
		});

	if (state.kind === 'loading') return <SectionLoading />;
	if (state.kind === 'unavailable') return <SectionUnavailable what="Scorecard" />;
	if (state.kind === 'error') return <SectionError what="Scorecard" message={state.message} />;

	if (dims.length === 0) {
		return (
			<div className="text-sm text-muted-foreground py-4 text-center">
				No checks reported by the scorecard.
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{dims.map((d) => {
				const isOpen = expanded.has(d.dimension);
				return (
					<div
						key={d.dimension}
						className={`bg-white border border-gray-200 border-l-4 rounded ${borderClasses(
							d.worst,
						)}`}
					>
						<button
							type="button"
							onClick={() => toggle(d.dimension)}
							className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition"
						>
							<div className="flex items-center gap-2">
								<StatusChip status={d.worst} />
								<span className="text-sm font-medium">{d.dimension}</span>
								<span className="text-xs text-muted-foreground">
									{d.rows.length} check{d.rows.length === 1 ? '' : 's'}
								</span>
							</div>
							<div className="text-xs text-muted-foreground flex items-center gap-3">
								<span className="text-green-600">{d.counts.PASS} pass</span>
								<span className="text-amber-600">{d.counts.WARN} warn</span>
								<span className="text-red-600">{d.counts.FAIL} fail</span>
								<span>{isOpen ? '▾' : '▸'}</span>
							</div>
						</button>
						{isOpen && (
							<div className="px-4 pb-3 overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="text-[10px] uppercase">check</TableHead>
											<TableHead className="text-[10px] uppercase">status</TableHead>
											<TableHead className="text-[10px] uppercase">detail</TableHead>
											<TableHead className="text-[10px] uppercase">remediation</TableHead>
											<TableHead className="text-[10px] uppercase">cadence</TableHead>
											<TableHead className="text-[10px] uppercase">last seen</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{d.rows
											.slice()
											.sort((a, b) => statusRank(a.status) - statusRank(b.status))
											.map((r) => (
												<TableRow key={r.check_name}>
													<TableCell className="font-mono text-xs">
														{r.check_name}
													</TableCell>
													<TableCell>
														<StatusChip status={r.status} />
													</TableCell>
													<TableCell className="text-xs text-muted-foreground max-w-xs break-words">
														{r.detail || '—'}
													</TableCell>
													<TableCell>
														{r.remediation ? (
															<Badge
																variant="outline"
																className="text-[10px] font-mono"
															>
																{r.remediation}
															</Badge>
														) : (
															<span className="text-xs text-muted-foreground">—</span>
														)}
													</TableCell>
													<TableCell className="font-mono text-xs text-muted-foreground">
														{r.cadence || '—'}
													</TableCell>
													<TableCell className="font-mono text-xs text-muted-foreground">
														{fmtTs(r.ts)}
													</TableCell>
												</TableRow>
											))}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ---- Resource usage strip (per-box cpu/mem/disk) ----

function ResourceStrip({ state }: { state: SectionState<ResourceUsageBody> }) {
	if (state.kind === 'loading') return <SectionLoading />;
	if (state.kind === 'unavailable') return <SectionUnavailable what="Resource usage" />;
	if (state.kind === 'error')
		return <SectionError what="Resource usage" message={state.message} />;

	const boxes = state.data.boxes ?? [];
	if (boxes.length === 0) {
		return (
			<div className="text-sm text-muted-foreground py-2">No boxes reported.</div>
		);
	}
	return (
		<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
			{boxes.map((b) => (
				<div key={b.box} className="bg-white border border-gray-200 rounded p-3">
					<div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center justify-between">
						<span className="font-medium text-gray-700">{b.box}</span>
						<span className="text-[10px]">{fmtTs(b.ts)}</span>
					</div>
					<div className="grid grid-cols-3 gap-2 text-center">
						{(['cpu_pct', 'mem_pct', 'disk_pct'] as const).map((k) => {
							const label = k.replace('_pct', '');
							const v = b[k];
							return (
								<div key={k}>
									<div className={`text-lg font-semibold ${pctTone(v)}`}>
										{v == null ? '—' : `${Math.round(v)}%`}
									</div>
									<div className="text-[10px] uppercase text-muted-foreground">
										{label}
									</div>
								</div>
							);
						})}
					</div>
					{b.load1 != null && b.ncpu ? (
						<div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
							<span className="uppercase text-muted-foreground">load (1m)</span>
							<span
								className={`font-mono font-medium ${
									b.load1 > b.ncpu ? 'text-red-600'
									: b.load1 > b.ncpu * 0.7 ? 'text-amber-600'
									: 'text-green-700'
								}`}
							>
								{b.load1.toFixed(2)} / {b.ncpu} cpu
								{b.load5 != null ? ` \u00b7 5m ${b.load5.toFixed(2)}` : ''}
							</span>
						</div>
					) : null}
				</div>
			))}
		</div>
	);
}

// ---- Venue health strip (per box) ----

function VenueHealthStrip({
	states,
}: {
	states: { box: string; state: SectionState<VenueHealthBody> }[];
}) {
	const anyLoading = states.some((s) => s.state.kind === 'loading');
	if (states.length === 0 || anyLoading) {
		if (anyLoading) return <SectionLoading />;
	}

	// All boxes 404 → treat the whole strip as not-available.
	const allUnavailable =
		states.length > 0 && states.every((s) => s.state.kind === 'unavailable');
	if (allUnavailable) return <SectionUnavailable what="Venue health" />;

	const withData = states.filter((s) => s.state.kind === 'ok');
	if (withData.length === 0) {
		const firstErr = states.find((s) => s.state.kind === 'error');
		if (firstErr && firstErr.state.kind === 'error') {
			return <SectionError what="Venue health" message={firstErr.state.message} />;
		}
		return <div className="text-sm text-muted-foreground py-2">No venue data.</div>;
	}

	return (
		<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
			{states.map(({ box, state }) => {
				if (state.kind !== 'ok') {
					// Per-box graceful note (unavailable / error) without blanking peers.
					return (
						<div key={box} className="bg-white border border-gray-200 rounded p-3">
							<div className="text-xs uppercase tracking-wide text-muted-foreground mb-1 font-medium text-gray-700">
								{box}
							</div>
							<div className="text-xs text-muted-foreground">
								{state.kind === 'unavailable' ? 'not yet available' : 'unavailable'}
							</div>
						</div>
					);
				}
				const venues = state.data.venues ?? [];
				const worst = worstStatus(venues.map((v) => ({ status: v.status ?? 'UNKNOWN' })));
				return (
					<div
						key={box}
						className={`bg-white border border-gray-200 border-l-4 rounded p-3 ${borderClasses(
							worst,
						)}`}
					>
						<div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center justify-between">
							<span className="font-medium text-gray-700">{box}</span>
							<StatusChip status={worst} />
						</div>
						{venues.length === 0 ? (
							<div className="text-xs text-muted-foreground">No venues.</div>
						) : (
							<ul className="space-y-1">
								{venues.map((v) => (
									<li
										key={v.venue}
										className="flex items-center justify-between text-xs"
									>
										<span className="font-mono">{v.venue}</span>
										<span className="flex items-center gap-2">
											{v.book_age_ms != null && (
												<span className="text-muted-foreground">
													{v.book_age_ms}ms
												</span>
											)}
											<StatusChip status={v.status ?? 'UNKNOWN'} />
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ---- section wrapper (mirrors super-admin dashboard) ----

function Section({
	icon: Icon,
	label,
	children,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			<h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-3 flex items-center gap-1.5">
				<Icon className="w-3 h-3" />
				{label}
			</h2>
			{children}
		</section>
	);
}

// ---- page ----

export default function OperationsStatusPage() {
	const [scorecard, setScorecard] = useState<SectionState<StackCheckBody>>({
		kind: 'loading',
	});
	const [resources, setResources] = useState<SectionState<ResourceUsageBody>>({
		kind: 'loading',
	});
	const [venues, setVenues] = useState<
		{ box: string; state: SectionState<VenueHealthBody> }[]
	>(VENUE_BOXES.map((box) => ({ box, state: { kind: 'loading' } })));
	const [refreshing, setRefreshing] = useState(false);
	const [lastRefresh, setLastRefresh] = useState<number | null>(null);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		const [sc, rs, ...vh] = await Promise.all([
			fetchSection<StackCheckBody>('/lqt/stack-check', normStackCheck),
			fetchSection<ResourceUsageBody>(`/lqt/resource-usage/${RESOURCE_SCOPE}`, normResource),
			...VENUE_BOXES.map((box) =>
				fetchSection<VenueHealthBody>(`/lqt/venue-health/${box}`, normVenue),
			),
		]);
		setScorecard(sc);
		setResources(rs);
		setVenues(VENUE_BOXES.map((box, i) => ({ box, state: vh[i] })));
		setLastRefresh(Date.now());
		setRefreshing(false);
	}, []);

	useEffect(() => {
		void refresh();
		const timer = setInterval(() => void refresh(), REFRESH_MS);
		return () => clearInterval(timer);
	}, [refresh]);

	return (
		<div className="space-y-6 p-4 max-w-6xl mx-auto">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold flex items-center gap-2">
						<Server className="w-4 h-4 text-indigo-700" />
						Operations status
					</h1>
					<p className="text-xs text-muted-foreground mt-0.5">
						Live stack_check scorecard · auto-refresh 30s ·{' '}
						<Link to="/docs/operations" className="text-indigo-600 hover:underline">
							checklist doc →
						</Link>
					</p>
				</div>
				<button
					type="button"
					onClick={() => void refresh()}
					className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-indigo-700 transition"
				>
					<RefreshCcw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
					{lastRefresh ? `refreshed ${fmtTs(new Date(lastRefresh).toISOString())}` : 'refresh'}
				</button>
			</div>

			{/* 1. Scorecard — per-dimension summary + expandable per-check table */}
			<Section icon={Server} label="Scorecard · by dimension">
				<ScorecardSection state={scorecard} />
			</Section>

			{/* 2. Resource usage — per-box cpu/mem/disk strip */}
			<Section icon={Server} label="Resource usage">
				<ResourceStrip state={resources} />
			</Section>

			{/* 3. Venue health — per-box venue freshness strip */}
			<Section icon={Server} label="Venue health">
				<VenueHealthStrip states={venues} />
			</Section>
		</div>
	);
}
