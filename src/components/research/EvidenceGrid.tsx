// EvidenceGrid — "Each version, step by step": an experiment's versions down
// the side, the feedback steps of its workflow across the top, each cell the
// step's number for that version with a mark for what happened there.
//
//                    Quick check  Full run       Stress test
//   Baseline         ✓ 96%        ✓ 1.1          ✓ 0.7      ← best
//   Wider window     ✓ 97%        ✕ 0.21         ○
//   Short horizon    ✓ 98%        ✓ 0.9          ○
//                    4 runs·$0.04 3 runs·$0.60   1 run·$1.50
//   [Run Short horizon through Stress test (about 1 run)]
//
// Generic (round 10, 2026-11-28): a step with a gate says passed/didn't pass
// (the reason in its tooltip and aria-label); a step without one just shows
// its number — an app with one ungated step gets a scoreboard, an app whose
// steps carry gates sees which versions got how far. Words come from
// lib/evidence.ts. Nothing runs without the press.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Play, X } from "lucide-react";
import { me, waitForIntent, type MeExperiment, type MeExperimentRow } from "@/api/me";
import { askOrStash } from "@/components/chat/askBus";
import { Button } from "@/components/ui/button";
import { bestWords, cellValue, cellWords, evidenceOf, nextWords, runningVersions, stepFootWords, stepPassWords, type CellState, type Evidence, type EvidenceNext, type EvidenceStepSpec } from "@/lib/evidence";
import { batchProgress, experimentLoop, humanId, versionsOf, type BatchProgress, experimentLabel} from "@/lib/research-map";
import type { QueueRow } from "@/lib/compute";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { cn } from "@/lib/utils";

const SHOWN = 12;

/** The mark beside a cell's number. Shape and words carry the state; colour only adds to it. */
function Mark({ state }: { state: CellState }) {
	if (state === "passed") return <Check className="h-3 w-3 flex-shrink-0 text-gold-700" strokeWidth={3} aria-hidden />;
	if (state === "failed") return <X className="h-3 w-3 flex-shrink-0 text-brick-700" strokeWidth={3} aria-hidden />;
	if (state === "running") return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-lagoon-500 animate-lumen-breathe" aria-hidden />;
	if (state === "not run") return <span className="h-2 w-2 flex-shrink-0 rounded-full border border-ink-300" aria-hidden />;
	return null;
}

/** The grid itself, from a computed Evidence (the gallery renders it from fixtures). */
export function EvidenceTable({ ev, onPick, picked, action }: {
	ev: Evidence;
	onPick?: (version: string) => void;
	picked?: string | null;
	/** The "ready for the next step" button, under the grid. */
	action?: React.ReactNode;
}) {
	const [all, setAll] = useState(false);
	const rows = all ? ev.versions : ev.versions.slice(0, SHOWN);
	const best = bestWords(ev);
	const one = ev.steps.length === 1;
	return (
		<section aria-label="Each version, step by step" className="space-y-1.5" data-evidence="">
			<h3 className="eyebrow">Each version, step by step</h3>
			<div className="overflow-x-auto overscroll-x-contain">
				<table className="w-full border-separate border-spacing-0 text-caption">
					<thead>
						<tr>
							<th scope="col" className="sticky left-0 z-[1] bg-card px-1 pb-1 text-left align-bottom text-micro font-medium text-ink-600">Version</th>
							{ev.steps.map((s) => (
								<th key={s.step} scope="col" title={s.gateText} className="min-w-[4.5rem] px-1 pb-1 text-left align-bottom font-medium">
									<div className="text-micro leading-tight text-ink-800">{one ? s.metricLabel || s.label : s.label}</div>
									{!one && <div className="text-nano font-normal leading-tight text-ink-600">{stepPassWords(s) || (s.gated ? "has a pass rule" : s.metricLabel || "measures")}</div>}
									{one && !s.higherIsBetter && <div className="text-nano font-normal text-ink-600">lower is better</div>}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((v) => {
							const cells = ev.cells.get(v.id)!;
							const on = picked === v.id;
							return (
								<tr key={v.id} className={cn("group", on && "[&>*]:bg-plum-50")}>
									<th scope="row" className="sticky left-0 z-[1] max-w-[7.5rem] border-t border-ink-100 bg-card px-1 py-1 text-left font-normal group-hover:bg-ink-50">
										<button type="button" onClick={() => onPick?.(v.id)} disabled={!onPick} aria-pressed={on}
											className={cn("block w-full truncate text-left font-medium text-ink-900", onPick && "hover:underline")} title={v.label}>{v.label}</button>
									</th>
									{ev.steps.map((s) => {
										const c = cells.get(s.step)!;
										const isBest = ev.best?.version === v.id && ev.best.step === s.step;
										const words = cellWords(c, s) + (isBest ? " — the best so far" : "");
										return (
											<td key={s.step} title={words} aria-label={words} className={cn("border-t border-ink-100 px-1 py-1 group-hover:bg-ink-50", isBest && "bg-gold-100")}>
												<span className="flex items-center gap-1">
													<Mark state={c.state} />
													<span className={cn("truncate tabular-nums", c.state === "failed" ? "text-brick-700" : c.state === "not run" || c.state === "running" ? "text-ink-600" : "text-ink-900", isBest && "font-semibold text-gold-800")}>
														{c.state === "running" ? "running" : c.state === "not run" ? "" : cellValue(c, s)}
													</span>
												</span>
											</td>
										);
									})}
								</tr>
							);
						})}
					</tbody>
					<tfoot>
						<tr>
							<td className="sticky left-0 z-[1] border-t border-ink-200 bg-card px-1 pt-1 align-top text-nano text-ink-600">{one ? "In all" : "Each step"}</td>
							{ev.steps.map((s) => <td key={s.step} className="border-t border-ink-200 px-1 pt-1 align-top text-nano leading-tight tabular-nums text-ink-600">{stepFootWords(s, ev.fromState)}</td>)}
						</tr>
					</tfoot>
				</table>
			</div>
			{ev.versions.length > SHOWN && (
				<button type="button" onClick={() => setAll((x) => !x)} className="text-micro text-ink-700 hover:text-ink-900 hover:underline">
					{all ? "Show fewer" : `Show all ${ev.versions.length} versions`}
				</button>
			)}
			{best && <p className="text-micro text-ink-700">{best}</p>}
			{ev.unplaced > 0 && <p className="text-micro text-ink-600">{ev.unplaced} result{ev.unplaced === 1 ? " names a step" : "s name steps"} this workflow doesn&apos;t have — not shown.</p>}
			{action}
		</section>
	);
}

// Read the batch back from the app's queue until every run has finished
// (the same pattern as RunVersions).
function useBatch(app: string, sent: { intents: string[]; labels: string[] } | null, onFinished: () => void): BatchProgress | null {
	const [prog, setProg] = useState<BatchProgress | null>(null);
	const finished = useRef(onFinished);
	finished.current = onFinished;
	useEffect(() => {
		if (!sent) { setProg(null); return; }
		let stop = false, timer = 0;
		const t0 = Date.now();
		setProg(batchProgress([], sent.intents, sent.labels));
		const tick = async () => {
			try {
				const q = await me.appQueue(app);
				if (stop) return;
				const p = batchProgress((q.rows || []) as QueueRow[], sent.intents, sent.labels);
				setProg(p);
				if (p.finished) {
					window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["experiments", "runs"] } }));
					finished.current();
					return;
				}
			} catch { /* keep polling; one failed read isn't the answer */ }
			if (!stop && Date.now() - t0 < 30 * 60_000) timer = window.setTimeout(tick, 2500);
		};
		timer = window.setTimeout(tick, 1200);
		return () => { stop = true; window.clearTimeout(timer); };
	}, [app, sent]);
	return prog;
}

/** "Run the N ready versions through <step>": one queued run per version,
 *  attributed to the experiment — the same request RunVersions sends. */
function RunReady({ app, e, next }: { app: string; e: MeExperiment; next?: EvidenceNext }) {
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState<{ intents: string[]; labels: string[] } | null>(null);
	const [chat, setChat] = useState(false);
	const [over, setOver] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const prog = useBatch(app, sent, () => setOver(true));
	const loop = experimentLoop(e);
	// Stays mounted while its batch runs, even once no version is waiting.
	if (!loop || (!next && !sent && !chat)) return null;
	const go = async () => {
		if (!next) return;
		setErr(null);
		setOver(false);
		if (e.dispatch?.ask) {
			askOrStash({
				prompt: `Run ${next.versions.join(", ")} of the "${experimentLabel(e)}" experiment on ${app} through ${next.label} with dispatch_experiment_arm. ${e.dispatch.ask} Ask me for anything you don't know, then queue them.`,
				context: { page: "research", app, loop },
			});
			setChat(true);
			return;
		}
		setBusy(true);
		try {
			const arms = new Map((e.arms || []).map((a) => [String(a.id), a]));
			const intents: string[] = [];
			for (const id of next.versions) {
				const { id: _id, description: _d, ...overrides } = (arms.get(id) || { id }) as Record<string, unknown>;
				// Through THIS step, not the whole chain: the steps after it wait
				// for their own press (until_step — the engine holds them).
				const r = await me.enqueueRuns(app, loop, { variants: [{ ...overrides, arm: id }], branch_label: id, priority: 50, experiment_id: e.id, args: { until_step: next.step } });
				intents.push(r.intent_id);
			}
			setSent({ intents, labels: next.labels });
			Promise.all(intents.map((i) => waitForIntent(i, { timeoutMs: 90_000 }).catch(() => null))).then((rs) => {
				const failed = rs.map((r) => (r?.result || {}) as Record<string, unknown>).find((o) => o.ok === false);
				if (failed) setErr(String(failed.error || "The scheduler could not queue every run."));
			});
		} catch (ex) {
			setErr(ex instanceof Error ? ex.message : String(ex));
		} finally {
			setBusy(false);
		}
	};
	const running = !!sent && !over;
	return (
		<div className="min-w-0 space-y-1 pt-0.5">
			<Button size="sm" variant="secondary" onClick={go} disabled={busy || running || chat || !next} className="h-auto min-h-8 whitespace-normal py-1 text-left text-caption">
				<Play className="h-3.5 w-3.5 flex-shrink-0" /> {busy ? "Queuing…" : running ? "Running…" : next ? nextWords(next) : "Nothing else is ready"}
			</Button>
			{prog && <p className={cn("text-micro", prog.finished && prog.failed ? "text-brick-700" : prog.finished ? "text-gold-700" : "text-ink-700")} role="status">{prog.text}</p>}
			{chat && <p className="text-caption text-ink-700" role="status">Handed to the chat — it needs a detail only you can give.</p>}
			{err && <p className="text-caption text-brick-700" role="alert">Couldn&apos;t queue every run: {err}</p>}
		</div>
	);
}

/** The grid for one experiment: reads its results and the app's queue. Renders
 *  nothing until some result lands in a step. */
export default function EvidenceGrid({ app, e, steps, onPickVersion, pickedVersion }: {
	app: string; e: MeExperiment;
	/** The feedback steps of its workflow (lib/evidence experimentSteps). */
	steps: EvidenceStepSpec[];
	onPickVersion?: (version: string) => void; pickedVersion?: string | null;
}) {
	const [rows, setRows] = useState<MeExperimentRow[] | null>(null);
	const [running, setRunning] = useState<Set<string>>(() => new Set());
	const load = useCallback(() => {
		let live = true;
		me.experiment(app, e.id).then((d) => { if (live) setRows(d.results || []); }).catch(() => { if (live) setRows((r) => r ?? []); });
		me.appQueue(app).then((q) => { if (live) setRunning(runningVersions((q.rows || []) as QueueRow[], e.id)); }).catch(() => {});
		return () => { live = false; };
	}, [app, e.id]);
	useEffect(() => load(), [load]);
	useStudioRefetch(["experiments", "runs"], () => { load(); });
	const metric = e.metric?.name || e.metric_name;
	const hib = !(e.higher_is_better === false || e.metric?.higher_is_better === false);
	const ev = useMemo(() => rows && evidenceOf({
		steps, rows, running, metric, higherIsBetter: hib,
		versions: versionsOf(e).map((v) => ({ id: v.id, label: v.label })),
		aggregates: e.comparable === false ? undefined : e.variants ?? undefined,
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}), [rows, running, steps, metric, hib, e.id, e.arms, e.variants]);
	if (!ev || ev.steps.every((s) => s.runs === 0)) return null;
	const done = !!e.status && /concluded|done|archived|closed/i.test(e.status);
	return (
		<EvidenceTable ev={ev} onPick={onPickVersion} picked={pickedVersion}
			action={done ? null : <RunReady app={app} e={e} next={ev.next[0]} />} />
	);
}
