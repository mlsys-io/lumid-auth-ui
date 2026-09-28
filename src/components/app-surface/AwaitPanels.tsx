// Inline results for `run_loop.await` actions: one card per tracked run under
// the table whose action fired it. Reads the module-level store in
// await-driver.ts, so a card outlives the dialog and every table refetch.

import { cn } from "@/lib/utils";
import { dismissRun, useTrackedRuns, type TrackedRun, type ClaimState, type Phase } from "./await-driver";
import { parseAxes, verdictOf, type Verdict, type AxisVerdict } from "./await-run";

const PHASES: Phase[] = ["queued", "running", "polling"];
const PHASE_LABEL: Record<Phase, string> = {
	queued: "Queued",
	running: "Running",
	polling: "Polling",
	done: "Result",
	failed: "Failed",
	timeout: "Still pending",
};

function Stepper({ phase }: { phase: Phase }) {
	const at = PHASES.indexOf(phase);
	const final = at < 0;
	return (
		<ol className="flex items-center gap-1 text-[10px] uppercase tracking-wide" aria-label="Progress">
			{[...PHASES, "done" as Phase].map((p, i) => {
				const reached = final ? true : i <= at;
				const current = final ? p === "done" : i === at;
				const label = p === "done" && final ? PHASE_LABEL[phase] : PHASE_LABEL[p];
				const tone =
					current && phase === "failed" ? "text-rose-700 font-semibold"
					: current && phase === "timeout" ? "text-amber-700 font-semibold"
					: current ? "text-gold-700 font-semibold"
					: reached ? "text-slate-500" : "text-slate-300";
				return (
					<li key={p} className={cn("inline-flex items-center gap-1", tone)} aria-current={current ? "step" : undefined}>
						{i > 0 && <span className="text-slate-300">→</span>}
						{current && !final && <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse" />}
						{label}
					</li>
				);
			})}
		</ol>
	);
}

const mark = (a: AxisVerdict) => (a.real === true ? "✓" : a.real === false ? "✗" : "?");
const axisTitle = (a: AxisVerdict) => (a.value ? `${a.label}: ${a.value}` : `${a.label}: not reported`);

function Axes({ v }: { v: Verdict }) {
	return (
		<span>
			Real on all three axes:{" "}
			{v.axes.map((a, i) => (
				<span key={a.label} title={axisTitle(a)}>
					{i > 0 && ", "}
					{a.label}{" "}
					<span className={a.real === true ? "text-emerald-700" : a.real === false ? "text-rose-600" : "text-slate-400"}>
						{mark(a)}
					</span>
				</span>
			))}
		</span>
	);
}

const num = (x: unknown) => (x == null || x === "" ? "—" : String(x));

function claimVerdict(c: ClaimState, run: TrackedRun): Verdict | null {
	if (!c.result) return null;
	return verdictOf(c.result, parseAxes(run.axes), { ...(run.matched ?? {}), claim_id: c.claim_id });
}

function VerdictBlock({ c, run }: { c: ClaimState; run: TrackedRun }) {
	const v = claimVerdict(c, run);
	const head = (
		<div className="text-[11px] text-slate-500">
			{c.label && c.label !== c.claim_id ? <span className="font-medium text-slate-700">{c.label} · </span> : null}
			claim <span className="font-mono">{c.claim_id || "—"}</span>
			{v?.claim_status ? <> · {v.claim_status}</> : null}
		</div>
	);
	if (!v) {
		return (
			<div className="space-y-0.5">
				{head}
				<div className={cn("text-[12px]", c.error ? "text-rose-600" : "text-slate-400")}>
					{c.error ? `Error: ${c.error}` : c.done ? "Resolved without a result row." : "Waiting for the claim to resolve…"}
				</div>
			</div>
		);
	}
	return (
		<div className="space-y-1">
			{head}
			<div className="text-[12px] text-slate-800">
				<span className="font-medium">{v.symbol || "—"}</span>
				{v.window ? <span className="text-slate-500"> · {v.window}</span> : null}
			</div>
			<div className="text-[12px] text-slate-700"><Axes v={v} /></div>
			{v.presentable ? (
				<div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-slate-700 tabular-nums">
					<span>Actions <b>{num(v.total_actions)}</b></span>
					<span>Filled lots <b>{num(v.filled_lots)}</b></span>
					<span>Realized PnL <b>{num(v.realized_pnl_ticks)}</b> ticks</span>
				</div>
			) : (
				<div className="text-[12px] text-amber-800">
					Not a performance number{v.note ? ` — ${v.note}` : "."}
				</div>
			)}
			{(v.error || c.error) && <div className="text-[12px] text-rose-600">Error: {v.error || c.error}</div>}
		</div>
	);
}

function CompareTable({ run }: { run: TrackedRun }) {
	const cols = run.claims.map((c) => ({ c, v: claimVerdict(c, run) }));
	const pending = (c: ClaimState) => (c.error ? `Error: ${c.error}` : c.done ? "—" : "pending…");
	const axisCount = cols[0]?.v?.axes.length ?? parseAxes(run.axes).length;
	const rows: { label: string; cell: (x: (typeof cols)[number]) => React.ReactNode }[] = [
		{ label: "Claim", cell: ({ c }) => <span className="font-mono">{c.claim_id || "—"}</span> },
		{ label: "Instrument", cell: ({ c, v }) => (v ? v.symbol || "—" : pending(c)) },
		{ label: "Window", cell: ({ v }) => (v ? v.window || "—" : "") },
		...Array.from({ length: axisCount }, (_, i) => ({
			label: parseAxes(run.axes)[i]?.label ?? `axis ${i + 1}`,
			cell: ({ v }: (typeof cols)[number]) => {
				const a = v?.axes[i];
				if (!a) return "";
				return (
					<span title={axisTitle(a)} className={a.real === true ? "text-emerald-700" : a.real === false ? "text-rose-600" : "text-slate-400"}>
						{mark(a)} {a.value || ""}
					</span>
				);
			},
		})),
		{ label: "Actions", cell: ({ v }) => (v ? (v.presentable ? num(v.total_actions) : "n/a") : "") },
		{ label: "Filled lots", cell: ({ v }) => (v ? (v.presentable ? num(v.filled_lots) : "n/a") : "") },
		{ label: "PnL (ticks)", cell: ({ v }) => (v ? (v.presentable ? num(v.realized_pnl_ticks) : "n/a") : "") },
		{
			label: "Presentable",
			cell: ({ v }) => (v ? (v.presentable ? <span className="text-emerald-700 font-medium">yes</span> : <span className="text-amber-800">no</span>) : ""),
		},
		{
			label: "Why",
			cell: ({ c, v }) => (v ? (v.error || c.error ? <span className="text-rose-600">{v.error || c.error}</span> : v.presentable ? "" : v.note) : ""),
		},
	];
	return (
		<div className="overflow-x-auto rounded border border-slate-200">
			<table className="min-w-full text-[12px] border-collapse">
				<thead className="bg-slate-50 border-b border-slate-200">
					<tr>
						<th className="px-2.5 py-1.5 text-left font-semibold text-slate-500" />
						{cols.map(({ c }, i) => (
							<th key={i} className="px-2.5 py-1.5 text-left font-semibold text-slate-700">{c.label || c.claim_id || `#${i + 1}`}</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.label} className="border-b border-slate-100 last:border-b-0">
							<th scope="row" className="px-2.5 py-1 text-left font-medium text-slate-500 whitespace-nowrap align-top">{r.label}</th>
							{cols.map((x, i) => (
								<td key={i} className="px-2.5 py-1 text-slate-700 align-top max-w-[320px] break-words">{r.cell(x)}</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{run.matched && (
				<div className="px-2.5 py-1 text-[11px] text-slate-400 border-t border-slate-100">
					Matched config: {String(run.matched.symbol ?? "—")}
					{run.matched.symbol_source ? ` (${String(run.matched.symbol_source)})` : ""}
					{run.matched.until ? ` · until ${String(run.matched.until)}` : ""}
				</div>
			)}
		</div>
	);
}

function RunCard({ run }: { run: TrackedRun }) {
	const finished = run.phase === "done" || run.phase === "failed" || run.phase === "timeout";
	return (
		<div
			className={cn(
				"rounded-lg border p-3 space-y-2",
				run.phase === "failed" ? "border-rose-200 bg-rose-50/40"
				: run.phase === "timeout" ? "border-amber-200 bg-amber-50/40"
				: "border-slate-200 bg-white",
			)}
			role="status"
			aria-live="polite"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="space-y-0.5 min-w-0">
					<div className="text-[12px] font-medium text-slate-800 truncate">{run.title}</div>
					<Stepper phase={run.phase} />
				</div>
				<div className="flex items-center gap-2 shrink-0 text-[10px] text-slate-400">
					{run.jobId && <span className="font-mono" title="Dispatch job id">job {run.jobId.slice(0, 8)}</span>}
					{run.polls > 0 && <span>{run.polls} poll{run.polls === 1 ? "" : "s"}</span>}
					{finished && (
						<button
							type="button"
							onClick={() => dismissRun(run.id)}
							className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 min-h-[24px]"
							aria-label="Dismiss this result"
						>
							Dismiss
						</button>
					)}
				</div>
			</div>
			{run.error && <div className="text-[12px] text-rose-700">{run.error}</div>}
			{run.message && <div className="text-[11px] text-slate-500">{run.message}</div>}
			{run.claims.length > 0 && (
				run.show === "compare"
					? <CompareTable run={run} />
					: (
						<div className="space-y-2 divide-y divide-slate-100">
							{run.claims.map((c, i) => <div key={i} className={i ? "pt-2" : ""}><VerdictBlock c={c} run={run} /></div>)}
						</div>
					)
			)}
		</div>
	);
}

export function AwaitPanels({ scope }: { scope: string }) {
	const runs = useTrackedRuns(scope);
	if (!runs.length) return null;
	return (
		<div className="space-y-2 pt-1">
			{runs.map((r) => <RunCard key={r.id} run={r} />)}
		</div>
	);
}
