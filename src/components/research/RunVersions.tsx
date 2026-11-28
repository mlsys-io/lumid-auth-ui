// RunVersions — the experiment's one obvious next step: run the versions it
// hasn't tried (or, once all have run, each once more). Without this an
// experiment could only be fed from the chat or by a run started as one of its
// versions — MLSys Research sat at "no results" for every experiment while its
// workflow had run nine times by hand.
//
// Each version becomes one queued run attributed to the experiment (identity
// sets payload.experiment from experiment_id), exactly as the chat's
// dispatch_experiment_arm does. Runs start as compute frees up; the queue is
// shown in Compute (ComputePanel). An app whose runs need a subject this
// button cannot know (dispatch.ask) hands the request to the chat instead.

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { me, waitForIntent, type MeExperiment } from "@/api/me";
import { askOrStash } from "@/components/chat/askBus";
import { Button } from "@/components/ui/button";
import { batchProgress, experimentLoop, humanId, roundOver, versionsToRun, type BatchProgress, experimentLabel} from "@/lib/research-map";
import type { QueueRow } from "@/lib/compute";
import { cn } from "@/lib/utils";
import { loopLabel } from "@/lib/workflow-names";
import { useAppGraph } from "@/hooks/useAppGraph";
import { experimentSteps } from "@/lib/evidence";
import { estimateThrough, throughChoices } from "@/lib/run-through";
import { pressWords } from "@/lib/spend";
import { useAppUsage } from "@/components/research/SpendLine";
import { useExperimentRows } from "@/components/research/ExperimentSpend";

type Sent = { n: number; loop: string; intents: string[]; labels: string[]; exp: string; ids: string[]; sentAt: number } | { chat: true };

// A batch outlives its panel: closing and reopening the experiment (or the
// panel re-rendering after the results refresh) used to drop the progress.
const sentByExperiment = new Map<string, Sent>();

// Read the batch back from the app's queue until every run has finished —
// the button used to say "Queued" once and go quiet while runs started,
// finished in ~20 s and added results nobody saw arrive.
function useBatch(app: string, sent: Sent | null, onFinished: () => void): BatchProgress | null {
	const [prog, setProg] = useState<BatchProgress | null>(null);
	const finished = useRef(onFinished);
	finished.current = onFinished;
	useEffect(() => {
		if (!sent || !("intents" in sent)) { setProg(null); return; }
		let stop = false, timer = 0;
		const t0 = Date.now();
		setProg(batchProgress([], sent.intents, sent.labels));
		const tick = async () => {
			try {
				const q = await me.appQueue(app);
				if (stop) return;
				const p = batchProgress((q.rows || []) as QueueRow[], sent.intents, sent.labels, { experiment: sent.exp, versions: sent.ids, sentAt: sent.sentAt });
				setProg(p);
				if (p.finished) {
					// The results are in: the chart and the map re-read them now.
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

const DOT: Record<string, string> = {
	waiting: "border border-ink-300 bg-transparent",
	running: "bg-plum-500 animate-lumen-breathe",
	done: "bg-gold-500",
	failed: "bg-brick-500",
};

export default function RunVersions({ app, e, onQueued, only, tried }: { app: string; e: MeExperiment; onQueued?: () => void;
	/** Just this version (a version's own panel). */
	only?: string;
	/** Versions with a row at any step (see triedVersions). */
	tried?: string[] }) {
	const key = only ? `${e.id}:${only}` : e.id;
	const [busy, setBusy] = useState(false);
	const [sent, setSentState] = useState<Sent | null>(() => sentByExperiment.get(key) ?? null);
	const setSent = (s: Sent | null) => { if (s) sentByExperiment.set(key, s); else sentByExperiment.delete(key); setSentState(s); };
	const [err, setErr] = useState<string | null>(null);
	const loop = experimentLoop(e);
	const all = versionsToRun(e, tried);
	const ids = only ? [only] : all.ids;
	const untried = only ? !(e.variants?.[only]?.n) && !(tried || []).includes(only) : all.untried;
	const [over, setOver] = useState(false);
	const prog = useBatch(app, sent, () => { setOver(true); sentByExperiment.delete(key); });
	// How far the press runs a chain: through each step but the last, or all
	// the way (lib/run-through). The default holds only the last step — the
	// expensive or final one — for a later press; priced from this
	// experiment's own metered history, checked against the app's budget.
	const { graph } = useAppGraph(app);
	const steps = graph ? experimentSteps(graph.spec, e, graph.text) : [];
	const rows = useExperimentRows(app, e.id);
	// …and never a PAID step unasked (the default stops before one).
	const { choices, preferred } = throughChoices(steps, rows);
	const [pick, setPick] = useState<number | null>(null);
	const choice = choices.length ? choices[Math.min(pick ?? preferred, choices.length - 1)] : null;
	const usage = useAppUsage(app);
	const press = choice ? pressWords({ runs: ids.length, estimate: estimateThrough(rows, steps, choice.until), usage, through: choice.through }) : null;
	// Shared experiments are measured centrally (sharedLine): nothing to run here.
	if (!loop || !ids.length || e.shared || e.status && /concluded|done|archived|closed/i.test(e.status)) return null;
	// A finished gated round asks for new versions (Add versions), not the same
	// ones again; one version's own panel still offers "Run X once".
	if (!only && roundOver(e)) return null;
	const label = only ? `Run ${humanId(only)} once` : untried
		? ids.length === 1 ? `Run the untried version (${humanId(ids[0])})` : `Run the ${ids.length} untried versions`
		: `Run each version once more (${ids.length} runs)`;

	const go = async () => {
		setErr(null);
		setOver(false);
		if (e.dispatch?.ask) {
			askOrStash({
				prompt: `Run ${untried ? "the untried versions" : "each version once more"} of the "${experimentLabel(e)}" experiment (${ids.join(", ")}) `
					+ `on ${app} with dispatch_experiment_arm. ${e.dispatch.ask} Ask me for anything you don't know, then queue them.`,
				context: { page: "research", app, loop },
			});
			setSent({ chat: true });
			return;
		}
		setBusy(true);
		try {
			const arms = new Map((e.arms || []).map((a) => [String(a.id), a]));
			const intents: string[] = [];
			for (const id of ids) {
				const { id: _id, description: _d, ...overrides } = (arms.get(id) || { id }) as Record<string, unknown>;
				const r = await me.enqueueRuns(app, loop, {
					variants: [{ ...overrides, arm: id }],
					branch_label: id,
					priority: 50,
					experiment_id: e.id,
					...(choice?.until ? { args: { until_step: choice.until } } : {}),
				});
				intents.push(r.intent_id);
			}
			setSent({ n: ids.length, loop, intents, labels: ids.map(humanId), exp: e.id, ids, sentAt: Date.now() / 1000 });
			onQueued?.();
			// Report what the scheduler did, not what we asked for.
			Promise.all(intents.map((i) => waitForIntent(i, { timeoutMs: 90_000 }).catch(() => null)))
				.then((rs) => {
					const failed = rs.map((r) => (r?.result || {}) as Record<string, unknown>).find((o) => o.ok === false);
					if (failed) setErr(String(failed.error || "The scheduler could not queue every run."));
				});
		} catch (ex) {
			setErr(ex instanceof Error ? ex.message : String(ex));
		} finally {
			setBusy(false);
		}
	};

	const running = !!sent && "intents" in sent && !over;
	return (
		<div className="min-w-0 space-y-1">
			<div className="flex items-center gap-2">
				<Button size="sm" variant={untried || only ? "accent" : "secondary"} onClick={go} disabled={busy || running || (!!sent && "chat" in sent) || !!press?.blocked}>
					<Play className="w-3.5 h-3.5" /> {busy ? "Queuing…" : running ? "Running…" : over ? "Run again" : label}
				</Button>
				{/* One dot per queued run: hollow waiting, breathing running, gold done, brick failed. */}
				{prog && (
					<span className="flex items-center gap-1" aria-hidden>
						{prog.runs.map((r, i) => <span key={i} title={`${r.label}: ${r.state}`} className={cn("h-2 w-2 rounded-full", DOT[r.state])} />)}
					</span>
				)}
			</div>
			{choice && !running && (
				<label className="flex min-w-0 flex-wrap items-center gap-1.5 text-micro text-ink-700">
					<span>Through</span>
					<select
						aria-label="How far to run"
						value={choices.indexOf(choice)}
						onChange={(ev) => setPick(Number(ev.target.value))}
						className="min-w-0 max-w-full rounded-md border border-ink-200 bg-card px-1 py-0.5 text-micro text-ink-800"
					>
						{choices.map((c, i) => <option key={i} value={i}>{c.until ? `${c.through} (${c.holds})` : `all the way (${c.through})`}</option>)}
					</select>
				</label>
			)}
			{press && !running && /about|left/.test(press.text) && (
				<p className={cn("text-micro", press.blocked ? "text-brick-700" : "text-ink-700")}>{press.text}</p>
			)}
			{prog && (
				<p className={cn("text-micro", prog.finished && prog.failed ? "text-brick-700" : prog.finished ? "text-gold-700" : "text-ink-700")} role="status">{prog.text}</p>
			)}
			{sent && "chat" in sent && <p className="text-caption text-ink-700" role="status">Handed to the chat — it needs a detail only you can give.</p>}
			{err && <p className="text-caption text-brick-700" role="alert">Couldn&apos;t queue every run: {err}</p>}
		</div>
	);
}
