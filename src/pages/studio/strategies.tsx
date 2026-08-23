// /studio/strategies — the caller's own LQT strategies, and what they did.
//
// Until now there was no way to see a strategy you had submitted. The read API
// for this has been deployed and RLS-enforced for weeks — lqt-data's own route
// config says it exists so that "the researcher UI [can] list the strategies the
// user has registered so it can then drill into /lqt/inspect/cycles/:strategy"
// — but nothing ever called it. Submitting was a curl, and confirming it worked
// was another curl.
//
// Two things this surfaces that were previously invisible in the product:
//
//   • WHETHER YOUR STRATEGY COMPILED. Compilation is asynchronous: the submit
//     endpoint answers 200 "queued", and a worker compiles afterwards. An empty
//     program_hash means it never compiled, and there was no way to learn that
//     short of listing the API by hand.
//   • WHY IT ISN'T TRADING. A registered strategy that proposes orders and has
//     every one rejected looks identical, from outside, to one that is idle.
//     The reject_reasons distribution is the answer and it was being thrown away.
//
// Read-only by design. Submitting is still POST /lqt/submit/lqt_inbox with a
// PAT carrying `lqt:strategy` (see /docs/lqt-strategies); this page deliberately
// does not mint that capability — see the `lqt` audience in SessionBearerHandler.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, CheckCircle2,
	Clock, FlaskConical, Ban,
} from "lucide-react";
import { toast } from "sonner";
import {
	listStrategies, listCycles, summarizeCycles, LqtAuthError,
	type LqtStrategy, type LqtCycle,
} from "@/api/lqt";
import { cn } from "@/lib/utils";

function rel(iso?: string | null): string {
	if (!iso) return "—";
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "—";
	const diff = (Date.now() - t) / 1000;
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

const ms = (ns?: number | null) =>
	ns == null ? "—" : ns >= 1e6 ? `${(ns / 1e6).toFixed(1)}ms` : `${(ns / 1e3).toFixed(0)}µs`;

/** Compiled state is the single most useful thing about a submitted strategy. */
function CompiledBadge({ hash }: { hash: string | null }) {
	const ok = !!hash;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
				ok ? "bg-gold-50 text-gold-700" : "bg-amber-50 text-amber-700",
			)}
			title={ok ? `program_hash ${hash}` : "No program_hash — the DSL never compiled. Check strategy.ack on your outbox for the compiler diagnostic."}
		>
			{ok ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
			{ok ? "Compiled" : "Not compiled"}
		</span>
	);
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
	return (
		<div className="rounded-lg border border-slate-200 px-3 py-2">
			<div className="text-xs text-slate-500">{label}</div>
			<div className={cn("text-lg font-semibold tabular-nums", tone || "text-slate-900")}>{value}</div>
		</div>
	);
}

function StrategyDetail({ s, onBack }: { s: LqtStrategy; onBack: () => void }) {
	const [cycles, setCycles] = useState<LqtCycle[] | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		setCycles(null); setErr(null);
		listCycles(s.strategy_id)
			.then((c) => { if (live) setCycles(c); })
			.catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
		return () => { live = false; };
	}, [s.strategy_id]);

	const sum = useMemo(() => summarizeCycles(cycles || []), [cycles]);

	return (
		<div className="space-y-4">
			<button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
				<ChevronLeft className="w-4 h-4" /> All strategies
			</button>

			<div className="flex flex-wrap items-center gap-2">
				<h2 className="text-lg font-semibold text-slate-900">{s.name}</h2>
				<span className="text-xs text-slate-500">v{s.version}</span>
				<CompiledBadge hash={s.program_hash} />
			</div>
			<div className="text-xs text-slate-500 font-mono break-all">
				{s.strategy_id} · registered {rel(s.registered_at)} · updated {rel(s.updated_at)}
			</div>

			{!s.program_hash && (
				<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
					<AlertTriangle className="w-4 h-4 inline mr-1" />
					This strategy has no <code>program_hash</code>, so it never compiled and cannot run.
					Compilation is asynchronous — a <code>200</code> on submit means <em>queued</em>, not
					compiled. The compiler's diagnostic is on your outbox as <code>strategy.ack</code>.{" "}
					<Link to="/docs/lqt-strategies" className="underline">Reading results →</Link>
				</div>
			)}

			{err && (
				<div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{err}</div>
			)}

			{cycles === null && !err && <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />}

			{cycles !== null && cycles.length === 0 && (
				<div className="rounded-lg border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
					No runtime cycles yet.
					{s.program_hash
						? " The strategy is registered and compiled, but no field box has run a cycle for it yet."
						: " It has not compiled, so no box can load it."}
				</div>
			)}

			{cycles !== null && cycles.length > 0 && (
				<>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
						<Stat label="Proposed" value={sum.proposed} />
						<Stat label="Submitted" value={sum.submitted} tone={sum.submitted ? "text-gold-700" : undefined} />
						<Stat label="Rejected" value={sum.rejected} tone={sum.rejected ? "text-rose-700" : undefined} />
						<Stat label="Suppressed" value={sum.suppressed} />
					</div>

					{/* The funnel is the point: proposing a lot and submitting nothing is
					    the common failure, and it is indistinguishable from idle without
					    the reason distribution. */}
					{sum.proposed > 0 && sum.submitted === 0 && (
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
							<Ban className="w-4 h-4 inline mr-1" />
							This strategy proposed {sum.proposed} order{sum.proposed === 1 ? "" : "s"} and
							submitted none — it is being gated, not idle.
						</div>
					)}

					{sum.topReasons.length > 0 && (
						<div>
							<div className="text-sm font-medium text-slate-900 mb-1.5">Why orders were rejected</div>
							<div className="flex flex-wrap gap-1.5">
								{sum.topReasons.map(([reason, n]) => (
									<span key={reason} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
										<span className="font-mono">{reason}</span>
										<span className="tabular-nums text-slate-500">{n}</span>
									</span>
								))}
							</div>
						</div>
					)}

					<div>
						<div className="text-sm font-medium text-slate-900 mb-1.5">
							Recent cycles <span className="text-xs font-normal text-slate-500">({cycles.length})</span>
						</div>
						<div className="overflow-x-auto rounded-lg border border-slate-200">
							<table className="w-full text-sm">
								<thead className="bg-slate-50 text-xs text-slate-500">
									<tr>
										{["When", "Box", "Seq", "Prop", "Sub", "Rej", "Supp", "Decide"].map((h) => (
											<th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
										))}
									</tr>
								</thead>
								<tbody>
									{cycles.slice(0, 100).map((c) => (
										<tr key={c.cycle_id} className="border-t border-slate-100">
											<td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{rel(c.ts)}</td>
											<td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs text-slate-500">{c.box_id}</td>
											<td className="px-3 py-1.5 tabular-nums text-slate-500">{c.loop_seq}</td>
											<td className="px-3 py-1.5 tabular-nums">{c.n_proposed}</td>
											<td className="px-3 py-1.5 tabular-nums">{c.n_submitted}</td>
											<td className="px-3 py-1.5 tabular-nums">{c.n_rejected}</td>
											<td className="px-3 py-1.5 tabular-nums">{c.suppressed}</td>
											<td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{ms(c.decision_latency_ns)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{cycles.length > 100 && (
							<div className="text-xs text-slate-500 mt-1">
								Showing the 100 most recent of {cycles.length} fetched.
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}

export default function StudioStrategies({ embedded = false }: { embedded?: boolean }) {
	const [rows, setRows] = useState<LqtStrategy[] | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [authErr, setAuthErr] = useState(false);
	const [sel, setSel] = useState<LqtStrategy | null>(null);

	const load = async () => {
		try {
			setRows(await listStrategies());
			setErr(null); setAuthErr(false);
		} catch (e) {
			setAuthErr(e instanceof LqtAuthError);
			setErr(e instanceof Error ? e.message : String(e));
		}
	};
	useEffect(() => { load(); }, []);

	const wrap = (children: React.ReactNode) => (
		<div className={cn("w-full space-y-5", !embedded && "max-w-5xl mx-auto px-1 py-2")}>{children}</div>
	);

	if (rows === null && !err) {
		return wrap(<>
			<div className="h-8 w-48 rounded bg-slate-100 animate-pulse" />
			<div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
		</>);
	}

	if (sel) return wrap(<StrategyDetail s={sel} onBack={() => setSel(null)} />);

	return wrap(<>
		<div className="flex items-center justify-between gap-3">
			<div className="min-w-0">
				<h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
					<FlaskConical className="w-4 h-4 text-gold-500" /> Strategies
				</h1>
				<p className="text-sm text-slate-500 mt-0.5">
					LQT strategies registered under your account. Read-only —{" "}
					<Link to="/docs/lqt-strategies" className="underline">how to write and submit one →</Link>
				</p>
			</div>
			<button
				onClick={() => { load(); toast.success("Strategies refreshed"); }}
				className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
			>
				<RefreshCw className="w-3.5 h-3.5" /> Refresh
			</button>
		</div>

		{err && (
			<div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
				<AlertTriangle className="w-4 h-4 inline mr-1" />
				{authErr
					? "Could not authenticate to LQT. If you are signed in, the `lqt` session-bearer audience may not be deployed yet."
					: err}
			</div>
		)}

		{rows !== null && rows.length === 0 && !err && (
			<div className="rounded-lg border border-slate-200 px-4 py-10 text-center">
				<div className="text-sm text-slate-900 font-medium">No strategies yet</div>
				<p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
					Strategies are written in the LQT DSL and submitted with a PAT carrying the{" "}
					<code>lqt:strategy</code> scope. They run paper against live prediction markets —
					no real orders.
				</p>
				<Link to="/docs/lqt-strategies" className="inline-block mt-3 text-sm underline">
					Write &amp; submit a strategy →
				</Link>
			</div>
		)}

		{rows !== null && rows.length > 0 && (
			<div className="overflow-x-auto rounded-lg border border-slate-200">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-xs text-slate-500">
						<tr>
							{["Name", "Version", "Kind", "Status", "Registered", "Updated", ""].map((h) => (
								<th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((s) => (
							<tr
								key={s.strategy_id}
								onClick={() => setSel(s)}
								className="border-t border-slate-100 cursor-pointer hover:bg-slate-50"
							>
								<td className="px-3 py-2 font-medium text-slate-900">{s.name}</td>
								<td className="px-3 py-2 text-slate-600 whitespace-nowrap">v{s.version}</td>
								<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{s.kind}</td>
								<td className="px-3 py-2"><CompiledBadge hash={s.program_hash} /></td>
								<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{rel(s.registered_at)}</td>
								<td className="px-3 py-2 text-slate-500 whitespace-nowrap">{rel(s.updated_at)}</td>
								<td className="px-3 py-2 text-slate-400"><ChevronRight className="w-4 h-4" /></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)}
	</>);
}
