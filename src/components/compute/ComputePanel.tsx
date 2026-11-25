// ComputePanel — "where are my runs, and how busy are the machines?"
// (Novix's Running panel, in Lumid's words.)
//
//   COMPUTE                                   Runs wait here for a free machine.
//   Running    [Simulate · C16 · Running simulate… · 1m 20s ▓▓▓░]
//              ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
//              ╎ Starts next  Simulate · C8                   ╎  ← the free slot
//              └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
//   Waiting    Simulate · C4                   #2 in line
//   Done       [● Simulate · succeeded · 3m ago]  (bordered rows)
//   ─────────
//   Machines   RTX 5080  ■□□  1/3   ·   CPU ■■■□…  6/22       (small, last)
//
// Generic: an experiment's runs go to compute and come back as feedback.
// Compute is limited, so runs wait; each says its place in line. Which
// machine a run gets is the app's business, so the panel never guesses it.
//
// Sources: running runs from the runs feed + SSE (useRunsFeed), the queue from
// GET /me/apps/:app/queue (scheduler's own queue), machines from GET
// /me/compute (counts only). A source that isn't available is left out, not
// faked — no capacity means no slots.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cpu } from "lucide-react";
import { me } from "@/api/me";
import { RunningCard } from "@/components/activity/ActivityView";
import { useNowSec, useRunsFeed } from "@/components/activity/hooks";
import { fmtAgo, groupActivity, loopOfRun } from "@/lib/activity";
import { capacityLine, capacityRows, queueItems, versionLabel, type ComputeCapacity, type QueueRow } from "@/lib/compute";
import { runPath } from "@/lib/run-routes";
import { loopLabel } from "@/lib/workflow-names";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";

const SLOT_MAX = 12;

function usePoll<T>(fn: () => Promise<T>, everyMs: number, key: string): { data: T | null; failed: boolean } {
	const [data, setData] = useState<T | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let live = true;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tick = async () => {
			if (!document.hidden) {
				try { const d = await fn(); if (live) { setData(d); setFailed(false); } } catch { if (live) setFailed(true); }
			}
			if (live) timer = setTimeout(tick, everyMs);
		};
		tick();
		return () => { live = false; if (timer) clearTimeout(timer); };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, everyMs]);
	return { data, failed };
}

function Slots({ total, busy }: { total: number; busy: number }) {
	const n = Math.min(total, SLOT_MAX);
	const b = Math.round((busy / Math.max(1, total)) * n);
	return (
		<span className="inline-flex items-center gap-0.5" aria-hidden>
			{Array.from({ length: n }, (_, i) => (
				<span key={i} className={cn("w-2.5 h-2.5 rounded-[3px]", i < b ? "bg-lagoon-500" : "border border-dashed border-ink-300")} />
			))}
			{total > SLOT_MAX && <span className="text-nano text-ink-600 ml-0.5">…</span>}
		</span>
	);
}

function Label({ children }: { children: React.ReactNode }) {
	return <div className="eyebrow text-ink-600 mb-1.5">{children}</div>;
}

export default function ComputePanel({ app, className, compact = false }: { app: string; className?: string; compact?: boolean }) {
	const { runs } = useRunsFeed(7);
	const queue = usePoll(() => me.appQueue(app), 10_000, `q:${app}`);
	const cap = usePoll(() => me.computeSummary(), 30_000, "compute");
	const act = runs ? groupActivity(runs, { app }) : null;
	const running = act?.running ?? [];
	const now = useNowSec(running.length > 0);
	const nowSec = running.length ? now : Date.now() / 1000;
	const q = queue.data ? queueItems(queue.data.rows as QueueRow[]) : null;
	const machines = cap.data ? capacityRows(cap.data.capacity as ComputeCapacity[]) : null;
	const finished = (runs || [])
		.filter((r) => (r.app || "") === app && (r.state === "succeeded" || r.state === "failed"))
		.sort((a, b) => (b.started_at || 0) - (a.started_at || 0))
		.slice(0, 4);
	const waiting = q?.waiting ?? [];
	const queuedRunning = q?.running ?? [];

	if (compact) {
		// A strip above the map when there is no room beside it: one line of
		// machines, then what's running and waiting. Finished runs stay on Activity.
		const last = finished[0];
		return (
			<section aria-label="Compute" className={cn("rounded-xl border border-ink-200 bg-card px-3 py-2 space-y-2", className)}>
				<div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-caption">
					<h2 className="eyebrow flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" aria-hidden /> Compute</h2>
					{/* The news first (running · next), machines after, small. */}
					<span className="text-ink-800">
						{running.length ? `${running.length} running` : "Nothing running"}
						{q ? (waiting[0]
							? <> · starts next: <b className="font-medium text-ink-900">{loopLabel("", waiting[0].loop)}{waiting[0].version ? ` · ${versionLabel(waiting[0].version)}` : ""}</b>{waiting.length > 1 ? ` (+${waiting.length - 1} waiting)` : ""}</>
							: " · nothing waiting") : null}
						{!running.length && last ? <span className="text-ink-600"> · last {loopLabel("", loopOfRun(last))} {last.state} {fmtAgo(last.started_at)}</span> : null}
					</span>
					<span className="ml-auto inline-flex items-center gap-3 text-micro text-ink-600">
						{[...(machines || []).filter((m) => m.gpu).slice(0, 3), ...(machines || []).filter((m) => !m.gpu)].map((m) => (
							<span key={m.label} className="inline-flex items-center gap-1" title={`${m.label}: ${capacityLine(m)}`}>
								<span className="text-ink-700">{m.label}</span>
								<span className="tabular-nums">{m.busy}/{m.total}</span>
							</span>
						))}
					</span>
				</div>
				{running.length > 0 && (
					<div className="grid gap-2 sm:grid-cols-2">
						{running.map((it) => <RunningCard key={it.run.run_id} item={it} now={nowSec} showApp={false} />)}
					</div>
				)}
			</section>
		);
	}

	// Novix-style slots: what holds a machine now, then the one empty slot the
	// next run will take (named, when something is waiting), then the line,
	// then what finished. Machines go last and small — they explain the wait,
	// they are not the news.
	const next = waiting[0];
	const later = waiting.slice(1);
	return (
		<section aria-label="Compute" className={cn("rounded-xl border border-ink-200 bg-card p-3 space-y-3.5", className)}>
			<div className="flex items-baseline gap-2">
				<h2 className="eyebrow flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" aria-hidden /> Compute</h2>
				<span className="text-micro text-ink-600">Runs wait here for a free machine.</span>
			</div>

			<div>
				<Label>Running{running.length ? ` · ${running.length}` : queuedRunning.length ? ` · ${queuedRunning.length}` : ""}</Label>
				<div className="grid gap-2">
					{running.map((it) => <RunningCard key={it.run.run_id} item={it} now={nowSec} showApp={false} />)}
					{!running.length && queuedRunning.map((r) => (
						<div key={r.key} className="flex items-center gap-2 rounded-lg border border-lagoon-200 bg-lagoon-50/50 px-2.5 py-2 text-caption">
							<span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0 animate-lumen-breathe", TONES.running.dot)} />
							<span className="font-medium text-ink-900 truncate">{loopLabel("", r.loop)}{r.version ? ` · ${versionLabel(r.version)}` : ""}</span>
							<span className="ml-auto text-micro text-ink-600 whitespace-nowrap">{r.line}</span>
						</div>
					))}
					<div data-slot="next" className="rounded-lg border border-dashed border-ink-300 px-2.5 py-2 text-caption">
						{next ? (
							<>
								<div className="text-micro text-ink-600">Starts next</div>
								<div className="font-medium text-ink-900 truncate">{loopLabel("", next.loop)}{next.version ? ` · ${versionLabel(next.version)}` : ""}</div>
							</>
						) : (
							<div className="text-ink-600">{running.length || queuedRunning.length ? "Nothing waiting — the next run starts here." : "Free — runs start here."}</div>
						)}
					</div>
				</div>
			</div>

			{later.length > 0 && (
				<div>
					<Label>Waiting · {later.length} more</Label>
					<ul className="space-y-1">
						{later.map((w) => (
							<li key={w.key} className="flex items-center gap-2 text-caption min-w-0">
								<span className="w-2.5 h-2.5 rounded-[3px] border border-dashed border-lagoon-400 flex-shrink-0" aria-hidden />
								<span className="font-medium text-ink-900 truncate">{loopLabel("", w.loop)}{w.version ? ` · ${versionLabel(w.version)}` : ""}</span>
								<span className="ml-auto text-micro text-ink-600 whitespace-nowrap">{w.line}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{finished.length > 0 && (
				<div>
					<Label>Done</Label>
					<ul className="space-y-1.5">
						{finished.map((r) => {
							const loop = loopOfRun(r);
							const ok = r.state === "succeeded";
							return (
								<li key={r.run_id}>
									<Link to={runPath(app, loop, r.run_id)}
										className="flex items-center gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5 text-caption hover:border-ink-300 hover:bg-muted/50 transition-colors">
										<span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", ok ? TONES.ok.dot : TONES.failing.dot)} />
										<span className="font-medium text-ink-900 truncate">{loopLabel("", loop)}</span>
										<span className={cn("text-micro", ok ? "text-gold-700" : "text-brick-700")}>{ok ? "succeeded" : "failed"}</span>
										<span className="ml-auto text-micro text-ink-600 whitespace-nowrap">{fmtAgo(r.started_at)}</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{machines && machines.length > 0 && (
				<div className="pt-2.5 border-t border-ink-100">
					<Label>Machines</Label>
					<ul className="space-y-0.5">
						{machines.map((m) => (
							<li key={m.label} className="flex items-center gap-2 text-micro min-w-0" title={`${m.label}: ${capacityLine(m)}${m.sites.length === 1 ? ` · ${m.sites[0]}` : ""}`}>
								<span className="w-20 flex-shrink-0 text-ink-800 truncate">{m.label}</span>
								<Slots total={m.total} busy={m.busy} />
								<span className="ml-auto text-ink-600 tabular-nums whitespace-nowrap">{m.busy}/{m.total}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
