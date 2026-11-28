// The app's Research map, as data: what the app is exploring (experiments),
// which versions each one tries, and what it suggests trying next.
//
// Pure functions over /me/apps/:app/experiments and the app's proposals,
// checked against lum.id on 2026-11-24. Every status is a sentence a reader
// understands without knowing the engine: "Can't compare yet — the versions
// were measured 18 different ways", not "comparable: false, instruments: 18".
// No created_at / forked_from is served yet, so the tree is app → experiments
// → versions, with suggestions as dashed branches off the app.

import type { MeExperiment, MeWorkflowRow } from "@/api/me";
import { fmtAgo, plainCause } from "@/lib/activity";
import { humanMetric, fmtMetricValue } from "@/lib/run-answer";

export type Tone = "ok" | "running" | "failing" | "attention" | "idle";

/** "kol_alpha" → "KOL alpha", "musk_llm_scored" → "Musk LLM scored". */
/** A metric label inside a sentence: "Goodput" → "goodput", but an acronym
 *  keeps its capitals ("OOS sharpe", not "oos sharpe" — 2026-11-28 re-audit). */
export function inSentence(label: string): string {
	const first = label.split(" ")[0];
	return /^[A-Z0-9]{2,}$/.test(first) || /[A-Z].*[A-Z]/.test(first) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

export function humanId(id: string): string {
	// A decimal written in an id reads as one: "0_<digits>" (util_0_95 → 0.95,
	// v_0_5) or "<digit>_<digits><size>" (llm_1_7b → 1.7b) — not "LLM 1 7b"
	// (MLSys Research, 2026-11-28). Anything else stays apart: mom_6_1 is
	// 6-1 momentum and run_2026_11_28 a date.
	// humanMetric reads "." as a path separator, so the point travels as a
	// private-use placeholder and is restored after.
	const P = "\uE000";
	const decimals = id
		.replace(/(^|_)0_(\d+)(?![0-9])/g, `$10${P}$2`)
		.replace(/(^|_)(\d)_(\d+[kmbt])(?![a-z0-9])/gi, `$1$2${P}$3`);
	return humanMetric(decimals).label.split(P).join(".");
}

export interface Proposal {
	id: string;
	hypothesis?: string;
	kind?: string;
	dispatch_loop?: string;
	dispatch?: { loop?: string };
	est_runs?: number;
	success_criteria?: string;
	min_samples?: number;
	metric?: { name: string; higher_is_better?: boolean };
	metric_name?: string;
	dataset_id?: string;
	baseline?: unknown;
	arms?: Array<Record<string, unknown>>;
	compare_within?: string[];
	/** The planners' pre-flight check: would it actually record results?
	 *  will_collect | will_be_invisible | unchecked (with the reason). */
	verdict?: string;
	verdict_reason?: string;
	/** Which planner proposed it (advocate / adversary / economist). */
	seat?: string;
	/** The shared instrument that will measure it (identity /me/measure), e.g.
	 *  mlsys-simulator — normally its workflow's feedback `service`. */
	instrument?: string;
}

/** The pre-flight check, in words: would this suggestion record results if
 *  run? (quant-research's planners check the metric, criteria and instrument
 *  against the app's own commands before suggesting.) null = no check made. */
export function proposalCheck(p: Proposal): { tone: Tone; text: string; why?: string } | null {
	const v = (p.verdict || "").toLowerCase();
	if (!v) return null;
	if (v === "will_collect") return { tone: "ok", text: "Checked — nothing would stop it recording results." };
	if (v === "will_be_invisible") return { tone: "failing", text: `It would run but record nothing${p.verdict_reason ? `: ${p.verdict_reason}` : "."}`, why: p.verdict_reason };
	return { tone: "idle", text: "Not checked yet whether it would record results.", why: p.verdict_reason };
}

// ── an experiment, in words ─────────────────────────────────────────────

const baselineArm = (e: MeExperiment): string | undefined => {
	const b = e.baseline as { arm?: string } | string | undefined;
	return typeof b === "string" ? b : b?.arm;
};

/** "screen failed its last 5 run(s): HTTP 401…" (identity markStarved) →
 *  "Stuck — Screen failed its last 5 runs: Not signed in (HTTP 401)". Was the
 *  same sentence for every cause ("the workflow that runs it is failing"),
 *  which hid WHICH workflow and WHY (2026-11-28, MBB student round). */
export function stuckWords(reason: string): string {
	const m = /^\s*(\S+) failed its last (\d+) run\(s\)(?::\s*([\s\S]*))?$/.exec(reason);
	if (!m) return "Stuck — the workflow that runs it is failing";
	const n = Number(m[2]);
	const runs = n === 1 ? "its last run" : `its last ${n} runs`;
	const why = m[3] && m[3].trim() ? `: ${plainCause(m[3])}` : "";
	return `Stuck — ${humanId(m[1])} failed ${runs}${why}`;
}

/** Versions sharing the top mean (two or more = a tie), from the state's means. */
export function tiedAtTop(e: MeExperiment): string[] {
	const vs = Object.entries(e.variants || {}).filter(([, v]) => v && v.n > 0 && Number.isFinite(v.mean));
	if (vs.length < 2) return [];
	const hib = e.metric?.higher_is_better !== false;
	const best = (hib ? Math.max : Math.min)(...vs.map(([, v]) => v.mean));
	const eps = 1e-9 * Math.max(1, Math.abs(best));
	const top = vs.filter(([, v]) => Math.abs(v.mean - best) <= eps).map(([k]) => k);
	return top.length >= 2 ? top : [];
}

/** A gated round is over when every version has run and a gate stopped each
 *  one. The procedure then is new versions, not the same ones again: a re-run
 *  of a stopped version is another trial against the same data (it inflates
 *  the multiple-testing count), and "Run each version once more" sat as the
 *  main button under "This round is over… add new versions" (2026-11-28). */
export function roundOver(e: MeExperiment): boolean {
	const g = e.gate_progress || {};
	const all = [...new Set([...(e.arms || []).map((a) => String(a.id)), ...Object.keys(g)])];
	return all.length > 0 && all.every((k) => g[k] && !g[k].passed);
}

/** Where a gated experiment's versions stand: passed every step / stopped / held. */
function gateTally(e: MeExperiment) {
	const g = e.gate_progress || {};
	const ids = Object.keys(g);
	const stopped = ids.filter((k) => !g[k].passed);
	const ok = ids.filter((k) => g[k].passed);
	const furthest = stopped.reduce<{ k: string; i: number } | null>((m, k) => (!m || g[k].index > m.i ? { k, i: g[k].index } : m), null);
	return { ids, stopped, ok, furthestStop: furthest ? g[furthest.k].reached : "" };
}

export function experimentStatus(e: MeExperiment): { tone: Tone; text: string } {
	if (e.status && /concluded|done|archived|closed/i.test(e.status)) {
		return e.best_variant && e.criteria_met
			? { tone: "ok", text: `Done — ${humanId(e.best_variant)} won` }
			: { tone: "idle", text: "Done — no clear winner" };
	}
	// A gated chain where the best number comes from a step its version failed:
	// nothing "leads" (2026-11-28 audit: "Quality roe lowlev leads" with every
	// version stopped at Robustness).
	if (e.best_failed_gate) {
		const t = gateTally(e);
		const where = humanId(e.best_stopped_at || t.furthestStop);
		// Another version may have passed where the top number failed: say so
		// rather than "no version passed" (2026-11-28 self-review).
		const g = e.gate_progress || {};
		const at = e.best_stopped_at || "";
		const atIdx = at && e.best_variant && g[e.best_variant] ? g[e.best_variant].index : -1;
		const passedThere = Object.values(g).filter((p) => p.passed && atIdx >= 0 && p.index >= atIdx).length;
		return passedThere
			? { tone: "running", text: `The top result didn't pass ${where} — ${passedThere} other version${passedThere === 1 ? "" : "s"} did` }
			: { tone: "attention", text: `No version passed every step — the furthest stopped at ${where}` };
	}
	if (!e.n_results && e.gate_progress && Object.keys(e.gate_progress).length) {
		const t = gateTally(e);
		if (t.ids.length && !t.ok.length) {
			return { tone: "attention", text: `No version passed every step — all ${t.ids.length} stopped (the furthest at ${humanId(t.furthestStop)})` };
		}
	}
	// Only where it would otherwise say "X leads": the server ranked one of a
	// tie first (MLSys: C16 "leads" at 22.4 = 22.4 tok/s).
	const tie = tiedAtTop(e);
	if (tie.length >= 2 && !e.criteria_met && !!e.best_variant && tie.includes(e.best_variant)) {
		return { tone: "running", text: `Tied — ${tie.length} versions score the same so far` };
	}
	if (!e.n_results) {
		if (e.unfed) return { tone: "attention", text: "Can't start — no workflow runs it" };
		// Rows exist, none with the experiment's own metric yet: a chained
		// experiment whose versions so far stopped at, or wait for, the step
		// that scores it. Was "Not started yet — none of its versions has run"
		// over a grid of 16 results (2026-11-28, Quant Research round 5).
		const rows = e.n_rows_total ?? 0;
		if (rows > 0) {
			const m = e.metric?.name || e.metric_name;
			const what = m ? `${inSentence(humanMetric(m).label)}` : "the experiment's own number";
			return { tone: "running", text: `Under way — ${rows} result${rows === 1 ? "" : "s"} so far, none with ${what} yet` };
		}
		// `starved` covers three cases (identity markStarved/markUndispatched):
		// its workflow never ran, it waits to be dispatched, or the workflow
		// failed its recent runs. Only the last is "failing" — a brand-new
		// experiment read "Stuck" in red (2026-11-27, Quant Research 0.8.0).
		if (e.starved) {
			return /\bfailed\b/i.test(e.starved_reason || "")
				? { tone: "failing", text: stuckWords(e.starved_reason || "") }
				: { tone: "idle", text: "Not started yet — none of its versions has run" };
		}
		// The workflow ran, but never AS one of these versions (runs started by
		// hand) — so the honest next step is to run the versions, not to debug.
		if (e.unrecorded && (e.arms?.length ?? 0) > 0 && !Object.keys(e.variants || {}).length) return { tone: "idle", text: "None of its versions has run yet" };
		if (e.unrecorded) return { tone: "attention", text: "Its workflow runs but records no results" };
		return { tone: "idle", text: "Not started yet" };
	}
	if (e.comparable === false) {
		const k = e.instruments && e.instruments > 1 ? `${e.instruments} different setups` : "different setups";
		return { tone: "attention", text: `Can't compare yet — the versions ran under ${k}` };
	}
	if (e.best_variant && e.criteria_met) return { tone: "ok", text: `Winning: ${humanId(e.best_variant)}` };
	if (e.best_variant && e.not_separable_from?.length) return { tone: "running", text: `${humanId(e.best_variant)} leads, but can't be told apart yet` };
	if (e.best_variant) return { tone: "running", text: `${humanId(e.best_variant)} leads — not confirmed yet` };
	// Every version has the results it needs, yet nothing leads: the averages
	// are too close for the rule to call. (Was "Collecting results: 209 of 24".)
	const vs = Object.values(e.variants || {});
	const declared = Math.max(1, e.arms?.length || vs.length || 1);
	const min = e.min_samples || 0;
	if (min && vs.length >= declared && vs.every((v) => v.n >= min)) return { tone: "idle", text: "Enough results — too close to call so far" };
	const need = min * declared;
	return { tone: "running", text: need ? `Collecting results: ${Math.min(e.n_results, need)} of ${need}` : `Collecting results: ${e.n_results} so far` };
}

/**
 * What to do next with an experiment, as one sentence — the research procedure
 * made explicit for ANY app with a gated chain (steps in run order). The
 * buttons below it do the work; this says which one is the next move and why.
 *   passed every step → compare them, then take the best further
 *   passed a step, the next one held → run them through it
 *   untried versions → run them (the cheap steps first)
 *   all stopped → the round is over: add new versions (each is another try)
 */
export function nextStepWords(e: MeExperiment, steps: string[],
	/** Versions with a ledger row at any step (triedVersions). Without it a
	 *  version that ran but scored nothing read as "untried" while the Run
	 *  button beside it said "once more" (2026-11-28 re-audit). */
	tried: string[] = []): string {
	const g = e.gate_progress || {};
	const declared = (e.arms || []).map((a) => a.id);
	const all = [...new Set([...declared, ...Object.keys(g), ...Object.keys(e.variants || {})])];
	if (!steps.length || !all.length) return "";
	const last = steps[steps.length - 1];
	const plural = (n: number, w = "version") => `${n} ${w}${n === 1 ? "" : "s"}`;
	const done = all.filter((k) => g[k]?.passed && g[k].reached === last);
	const held = all.filter((k) => g[k]?.passed && g[k].reached !== last);
	const unscored = all.filter((k) => !g[k] && !(e.variants?.[k]?.n));
	const untried = unscored.filter((k) => !tried.includes(k));
	const noScore = unscored.filter((k) => tried.includes(k));
	const stopped = all.filter((k) => g[k] && !g[k].passed);
	if (done.length) return `${plural(done.length)} passed every step. Next: compare them, then take the best one further — a forward or real-world test.`;
	if (held.length) {
		const at = g[held[0]].reached;
		const nxt = steps[steps.indexOf(at) + 1];
		return `Next: ${plural(held.length)} passed ${humanId(at)}${nxt ? ` — run ${held.length === 1 ? "it" : "them"} through ${humanId(nxt)}` : ""}.`;
	}
	if (untried.length) return `Next: run the ${plural(untried.length, "untried version")} — the cheap steps first.`;
	if (noScore.length) {
		const m = e.metric?.name || e.metric_name;
		const what = m ? inSentence(humanMetric(m).label) : "score";
		const one = noScore.length === 1;
		return `Next: ${plural(noScore.length)} ran but recorded no ${what} — open ${one ? "it" : "one"} to see why before running ${one ? "it" : "them"} again.`;
	}
	if (stopped.length) return `This round is over: none of the ${plural(stopped.length)} passed every step. Next: add new versions — each one counts as another try.`;
	return "";
}

/** What a workflow's main button should do, and the words under it. A plain
 *  run of a workflow that feeds experiments carries no version, and the engine
 *  records no result for a run that doesn't say which version it measured — so
 *  "Run" was the one press whose result could never count, and Summary then
 *  said "Its latest run recorded no results" (2026-11-28 audit). */
export function workflowPress(exps: Array<Pick<MeExperiment, "id"> & { title?: string | null }>): {
	versions: boolean; label: string; plainLabel: string; plainTitle: string; found: string;
} {
	if (!exps.length) return { versions: false, label: "Run", plainLabel: "Run", plainTitle: "Starts one run now", found: "Its latest run recorded no results." };
	const names = exps.slice(0, 3).map(experimentLabel).join(", ") + (exps.length > 3 ? ` and ${exps.length - 3} more` : "");
	return {
		versions: true,
		label: exps.length === 1 ? "Run versions" : "Run versions of…",
		plainLabel: "Run without a version",
		plainTitle: "Starts one run with no version: it isn't counted in any experiment",
		found: `Results land in ${exps.length === 1 ? "its experiment" : "its experiments"} (${names}): a run counts only as one of their versions.`,
	};
}

/** The same status in a few words, for a label on the map (the full
 *  sentence is in the card and the panel): "Can't compare yet", "musk leads". */
export function shortStatus(e: MeExperiment): { tone: Tone; text: string } {
	const st = experimentStatus(e);
	const done = /^Done — (.+) won$/.exec(st.text);
	if (done) return { ...st, text: `${done[1]} won` };
	return { ...st, text: st.text.split(" — ")[0].split(", but")[0] };
}

/** The workflow an experiment's runs come from: its declared dispatch loop
 *  when that loop is attached, else the first attached loop. */
export function experimentLoop(e: MeExperiment): string {
	const hinted = e.dispatch?.loop;
	return (hinted && e.loops?.includes(hinted) ? hinted : e.loops?.[0]) || "";
}

/** Versions with a ledger row at any step (the detail's `results`). A version a
 *  gate stopped at its first step never records the experiment's metric, so
 *  `variants` alone called it untried and the panel kept offering to run it
 *  (Quant Research, 2026-11-28). */
export function triedVersions(rows: Array<{ variant_id?: string }> | null | undefined): string[] {
	const out = new Set<string>();
	for (const r of rows || []) if (r?.variant_id) out.add(String(r.variant_id));
	return [...out];
}

/** The versions a "Run" button should start: the untried ones, or — when
 *  every version has run — all of them once more. */
export function versionsToRun(e: MeExperiment, tried?: Iterable<string>): { ids: string[]; untried: boolean } {
	// A shared experiment is measured once, centrally, for every install
	// (sharedLine: "nothing you need to run") — offering "Run each version once
	// more" beside that sentence contradicted it (2026-11-28).
	if (e.shared) return { ids: [], untried: false };
	const declared = (e.arms || []).map((a) => String(a.id));
	const ran = new Set(Object.keys(e.variants || {}).filter((k) => (e.variants?.[k]?.n ?? 0) > 0));
	for (const t of tried || []) ran.add(t);
	const untried = declared.filter((id) => !ran.has(id));
	return untried.length ? { ids: untried, untried: true } : { ids: declared, untried: false };
}

/** One batch of runs the Run button queued, read back from the app's queue:
 *  each run's state, and the batch in words. Rows are matched by the intent
 *  ids the enqueue returned (a queue row's req_id is "<intent>:<n>"). */
export type BatchRunState = "waiting" | "running" | "done" | "failed";
export interface BatchProgress {
	runs: Array<{ label: string; state: BatchRunState }>;
	waiting: number; running: number; done: number; failed: number;
	finished: boolean; lastError: string | null; text: string;
}
export function batchProgress(
	rows: Array<{ req_id: string; state: string; branch_label?: string | null; last_error?: string | null; experiment_id?: string | null; variant_id?: string | null; submitted_at?: number | string }>,
	intents: string[], labels: string[],
	/** How to find a run when the queue's own id (eq_…) isn't the intent id it
	 *  was asked under: by experiment, version and time sent (2026-11-27: the
	 *  batch never matched, so progress sat at "queued" until a reload). */
	by?: { experiment: string; versions: string[]; sentAt: number },
): BatchProgress {
	const taken = new Set<string>();
	const sec = (v: number | string | undefined) => (typeof v === "number" ? v : v ? Date.parse(v) / 1000 : NaN);
	const runs = intents.map((id, i) => {
		let row = rows.find((r) => r.req_id === id || r.req_id.startsWith(`${id}:`));
		if (!row && by) {
			const v = by.versions[i];
			row = rows.find((r) => !taken.has(r.req_id) && r.experiment_id === by.experiment && (r.branch_label === v || r.variant_id === v)
				&& !(sec(r.submitted_at) < by.sentAt - 120));
		}
		if (row) taken.add(row.req_id);
		const st = (row?.state || "").toLowerCase();
		const state: BatchRunState = /^(done|succeeded|success|completed)$/.test(st) ? "done"
			: /^(failed|error|cancelled|canceled|dead)$/.test(st) ? "failed"
			: /^(running|claimed|dispatched|started|in_progress)$/.test(st) ? "running" : "waiting";
		return { label: labels[i] ?? row?.branch_label ?? id, state, err: row?.last_error || null };
	});
	const n = (s: BatchRunState) => runs.filter((r) => r.state === s).length;
	const waiting = n("waiting"), running = n("running"), done = n("done"), failed = n("failed");
	const total = runs.length;
	const finished = total > 0 && waiting + running === 0;
	const lastError = runs.find((r) => r.state === "failed" && r.err)?.err ?? null;
	const runsWord = (k: number) => `${k} run${k === 1 ? "" : "s"}`;
	const text = finished
		? failed === 0 ? `All ${runsWord(total)} finished — results added.`
			: done === 0 ? `${failed === 1 ? "The run" : `All ${runsWord(failed)}`} failed${lastError ? `: ${lastError}` : "."}`
			: `${done} finished, ${failed} failed${lastError ? `: ${lastError}` : "."}`
		: running > 0 ? `Running ${running} of ${total}${waiting ? ` · ${waiting} waiting` : ""}${done ? ` · ${done} done` : ""}`
		: done > 0 ? `${done} of ${total} done · ${waiting} waiting for a free machine`
		: `${runsWord(total)} queued — waiting for a free machine`;
	return { runs: runs.map(({ label, state }) => ({ label, state })), waiting, running, done, failed, finished, lastError, text };
}

// ── a version (arm), in words ───────────────────────────────────────────

export interface VersionInfo {
	id: string;
	label: string;
	/** "winning" | "leading" | "current" | "not run yet" | "trying" | "can't tell apart". */
	tag: string;
	tone: Tone;
	/** "357 results · avg 121,610.6 ticks" */
	line: string;
	n: number;
	/** 0..1 toward the result target, null when there is none. */
	progress: number | null;
	description?: string;
}

/** An experiment by name: its own `title` (spec) when it declares one, else the
 *  humanised id — an id can't say whether serve_9_2 is 9.2 (round 10). */
export function experimentLabel(e: Pick<MeExperiment, "id"> & { title?: string | null }): string {
	return (typeof e.title === "string" && e.title.trim()) || humanId(e.id);
}

/** One label for a version everywhere (panel, table, dashboard, banner): its
 *  spec `title`, else "Current version" for a current/baseline arm, else the
 *  humanised id. */
export function versionLabel(e: MeExperiment, id: string): string {
	const base = baselineArm(e);
	return titleOf(e, id) || (id === base && /^(current|baseline)$/i.test(id) ? "Current version" : humanId(id));
}

function titleOf(e: MeExperiment, id: string): string {
	const a = (e.arms || []).find((x) => x.id === id) as Record<string, unknown> | undefined;
	return typeof a?.title === "string" ? a.title.trim() : "";
}

/** "What it changes", one row per setting: an object input (a strategy spec,
 *  serving overrides) becomes one "key: value" row per field instead of a JSON
 *  blob; lists join; long text stays whole (the cell truncates, the title shows
 *  it). Meta fields (id, description, about, title, arm) are not settings. */
/** A setting key in words, unit kept: "half_spread_bps" → "half spread (bps)". */
export function settingName(k: string): string {
	if (k.includes(".")) return k; // a dotted override path is the user's own address for it
	const m = humanMetric(k);
	const label = inSentence(m.label);
	return m.unit ? `${label} (${m.unit})` : label;
}

export function settingRows(arm: Record<string, unknown> | undefined): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	const show = (v: unknown): string => (Array.isArray(v) ? v.map(show).join(", ") : v && typeof v === "object" ? JSON.stringify(v) : String(v));
	for (const [k, v] of Object.entries(arm || {})) {
		if (["id", "description", "about", "title", "arm", "label"].includes(k)) continue;
		if (v && typeof v === "object" && !Array.isArray(v)) {
			for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
				if (v2 && typeof v2 === "object" && !Array.isArray(v2)) {
					// one more level (a strategy's costs: {bps, half_spread_bps})
					for (const [k3, v3] of Object.entries(v2 as Record<string, unknown>)) out.push([`${humanId(k2)} · ${settingName(k3)}`, show(v3)]);
				} else out.push([`${humanId(k)} · ${settingName(k2)}`, show(v2)]);
			}
		} else out.push([humanId(k), show(v)]);
	}
	return out;
}

export function versionsOf(e: MeExperiment, tried: string[] = []): VersionInfo[] {
	const declared = (e.arms || []).map((a) => a.id);
	const observed = [...new Set([...Object.keys(e.variants || {}), ...Object.keys(e.gate_progress || {})])];
	const ids = [...declared, ...observed.filter((o) => !declared.includes(o))];
	const base = baselineArm(e);
	const metric = e.metric?.name || e.metric_name || "";
	const { unit } = metric ? humanMetric(metric) : { unit: "" };
	const tied = new Set(e.not_separable_from || []);
	const topTie = tiedAtTop(e);
	return ids.map((id) => {
		const v = e.variants?.[id];
		const n = v?.n ?? 0;
		const gp = e.gate_progress?.[id];
		let tag = "trying", tone: Tone = "running";
		// A gated chain says where the version stands before any ranking does:
		// "stopped at Robustness" is final; "trying" invited another run.
		if (gp && !gp.passed) { tag = `stopped at ${humanId(gp.reached)}`; tone = "idle"; }
		else if (!v || n === 0) { tag = gp ? `passed ${humanId(gp.reached)}` : tried.includes(id) ? "ran, no score" : "not run yet"; tone = gp ? "running" : "idle"; }
		else if (topTie.includes(id)) { tag = "tied"; tone = "running"; }
		else if (e.best_variant === id && e.criteria_met && e.comparable !== false) { tag = "winning"; tone = "ok"; }
		else if (e.best_variant === id && e.comparable !== false) { tag = "leading"; tone = "ok"; }
		else if (tied.has(id)) { tag = "can't tell apart"; tone = "running"; }
		else if (id === base) { tag = "current"; tone = "idle"; }
		const avg = v && n ? ` · avg ${fmtMetricValue(v.mean, unit, metric)}` : "";
		const desc = (e.arms || []).find((a) => a.id === id)?.description;
		return {
			// A version's own `title` (spec) wins over the humanised id: an id
			// can't say whether serve_9_2 is 9.2 or mom_6_1 is "6-1".
			id, label: versionLabel(e, id),
			tag, tone, n,
			line: n ? `${n.toLocaleString()} result${n === 1 ? "" : "s"}${avg}` : "no results yet",
			progress: e.min_samples ? Math.min(1, n / e.min_samples) : null,
			description: typeof desc === "string" ? desc : undefined,
		};
	});
}

// ── "Done when", in words ────────────────────────────────────────────────

/** "best_n >= 20 and baseline_n >= 20 and delta_pp > 10" →
 *  "the best and the current version each have 20+ results, and the best is ahead by more than 10 points". */
export function criteriaInWords(expr?: string): string {
	const s = (expr || "").trim();
	if (!s) return "";
	const parts = s.split(/\s+and\s+/i).map((p) => p.trim());
	const out: string[] = [];
	const nBest = parts.map((p) => p.match(/^best_n\s*>=?\s*(\d+)$/)).find(Boolean)?.[1];
	const nBase = parts.map((p) => p.match(/^baseline_n\s*>=?\s*(\d+)$/)).find(Boolean)?.[1];
	const nAny = parts.map((p) => p.match(/^n\s*>=?\s*(\d+)$/)).find(Boolean)?.[1];
	if (nBest && nBase && nBest === nBase) out.push(`the best and the current version each have ${nBest}+ results`);
	else {
		if (nBest) out.push(`the best version has ${nBest}+ results`);
		if (nBase) out.push(`the current version has ${nBase}+ results`);
	}
	if (nAny) out.push(`there are ${nAny}+ results`);
	for (const p of parts) {
		const d = p.match(/^delta(_pp)?\s*(>=?|<=?)\s*(-?[\d.]+)$/);
		if (!d) continue;
		// delta_pp is in PERCENTAGE points — "10 points" left a reader asking "of what?".
		const pts = d[1] ? " percentage points" : "";
		const v = Number(d[3]);
		if (d[2].startsWith(">")) out.push(v === 0 ? (d[2] === ">=" ? "the best is at least as good as the current one" : "the best beats the current one") : `the best is ahead by more than ${v}${pts}`);
		else out.push(`the gap is under ${v}${pts}`);
	}
	const known = parts.every((p) => /^(best_n|baseline_n|n|delta(_pp)?)\s*[<>]=?\s*-?[\d.]+$/.test(p));
	if (!known || !out.length) return s; // say the rule as written rather than guess
	const txt = out.length > 1 ? `${out.slice(0, -1).join(", ")}, and ${out[out.length - 1]}` : out[0];
	return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// ── the tree ─────────────────────────────────────────────────────────────

export type MapNodeKind = "app" | "experiment" | "version" | "suggested" | "workflow" | "node";
export interface MapNode { id: string; kind: MapNodeKind; depth: number; ref: string; parent?: string }
export interface MapEdge { id: string; source: string; target: string; dashed?: boolean; label?: string }

/** The experiment a suggestion extends: the one that runs through the same
 *  workflow and dataset (and metric). Two of the three must match, or it
 *  hangs off the app — a guessed parent would draw a false derivation. */
export function suggestionParent(p: Proposal, exps: MeExperiment[]): string | null {
	const loop = p.dispatch_loop || p.dispatch?.loop;
	const metric = p.metric?.name || p.metric_name;
	let best: string | null = null, bestScore = 1;
	for (const e of exps) {
		const eLoops = [e.dispatch?.loop, ...(e.loops || [])].filter(Boolean);
		const score = (loop && eLoops.includes(loop) ? 1 : 0)
			+ (p.dataset_id && p.dataset_id === e.dataset_id ? 1 : 0)
			+ (metric && metric === (e.metric?.name || e.metric_name) ? 1 : 0);
		if (score > bestScore) { best = e.id; bestScore = score; }
	}
	return best;
}

/** The workflows the graph draws, with what it needs from each. */
export interface GraphWorkflow { id: string; parent?: string; node?: string; helper?: boolean }
export interface GraphNode { id: string; title: string; parent: string }

/** The id of the group node that holds parentless housekeeping workflows. */
export const OTHER_NODE = "__other";

/** One dot size (px) per kind, everywhere a research node is drawn: the 3D
 *  space, the list and the panel. The step between kinds says how much a node
 *  holds; depth may move a dot ~5% at most (2026-11-27: "some dots are too
 *  big, some too small"). */
export const DOT_SIZE = { app: 16, workflow: 12, variant: 11, node: 11, experiment: 9, suggested: 8, version: 7 } as const;

/**
 * The research graph (2026-11-25): the app → its WORKFLOWS (first ring) →
 * under each workflow its EXPERIMENTS (runs of that workflow with different
 * setups → versions), its VARIANTS (workflows with `parent` = it) and the child
 * NODES a user made (named groups; members are moved in with `node`). Nodes and
 * variants nest. Housekeeping workflows (`helper`) are not drawn: they fold
 * into the workflow they serve (its panel lists them); parentless ones gather
 * in one "Other workflows" node. Suggestions hang off the workflow they would
 * run. A cycle or an unknown parent falls back to the app — never a false link.
 */
export function buildResearchTree(
	app: string,
	exps: MeExperiment[],
	proposals: Proposal[],
	workflows: GraphWorkflow[] = [],
	groups: GraphNode[] = [],
): { nodes: MapNode[]; edges: MapEdge[] } {
	const root = `app:${app}`;
	const wfIds = new Set(workflows.map((w) => w.id));
	const groupIds = new Set(groups.map((g) => g.id));
	const drawn = workflows.filter((w) => !w.helper);
	const otherHelpers = workflows.filter((w) => w.helper && !(w.parent && wfIds.has(w.parent)));
	// Where each thing hangs, before depth is known.
	const parentOf = new Map<string, string>();
	const kindOf = new Map<string, MapNodeKind>();
	const refOf = new Map<string, string>();
	const order: string[] = [];
	const put = (id: string, kind: MapNodeKind, ref: string, parent: string) => { kindOf.set(id, kind); refOf.set(id, ref); parentOf.set(id, parent); order.push(id); };
	const placeOf = (node?: string, parent?: string): string => {
		if (node && groupIds.has(node)) return `node:${node}`;
		if (parent && wfIds.has(parent)) return `wf:${parent}`;
		return root;
	};
	for (const g of groups) put(`node:${g.id}`, "node", g.id, groupIds.has(g.parent) ? `node:${g.parent}` : wfIds.has(g.parent) ? `wf:${g.parent}` : root);
	if (otherHelpers.length) put(`node:${OTHER_NODE}`, "node", OTHER_NODE, root);
	for (const w of drawn) put(`wf:${w.id}`, "workflow", w.id, placeOf(w.node, w.parent));
	// A parent that is a folded helper isn't drawn: hang its children on the
	// helper's own parent instead.
	for (const [id, par] of parentOf) if (par.startsWith("wf:") && !kindOf.has(par)) {
		const h = workflows.find((w) => `wf:${w.id}` === par);
		parentOf.set(id, h?.parent && kindOf.has(`wf:${h.parent}`) ? `wf:${h.parent}` : root);
	}
	const byExp = new Map(exps.map((e) => [e.id, e]));
	for (const e of exps) {
		const loop = experimentLoop(e);
		put(`exp:${e.id}`, "experiment", e.id, loop && kindOf.get(`wf:${loop}`) === "workflow" ? `wf:${loop}` : root);
		for (const v of versionsOf(e)) put(`ver:${e.id}:${v.id}`, "version", v.id, `exp:${e.id}`);
	}
	for (const p of proposals.filter((p) => !byExp.has(p.id))) {
		const loop = p.dispatch_loop || p.dispatch?.loop;
		put(`sug:${p.id}`, "suggested", p.id, loop && kindOf.get(`wf:${loop}`) === "workflow" ? `wf:${loop}` : root);
	}
	// Depth from the root; anything caught in a cycle is re-hung on the app.
	const depth = new Map<string, number>([[root, 0]]);
	const depthOf = (id: string, seen = new Set<string>()): number => {
		const known = depth.get(id);
		if (known != null) return known;
		const par = parentOf.get(id);
		if (!par || seen.has(id) || (!depth.has(par) && !parentOf.has(par))) { parentOf.set(id, root); depth.set(id, 1); return 1; }
		seen.add(id);
		const d = depthOf(par, seen) + 1;
		depth.set(id, d);
		return d;
	};
	const nodes: MapNode[] = [{ id: root, kind: "app", depth: 0, ref: app }];
	const edges: MapEdge[] = [];
	const ids = [...order].sort((a, b) => depthOf(a) - depthOf(b));
	for (const id of ids) {
		const kind = kindOf.get(id)!;
		const par = parentOf.get(id)!;
		nodes.push({ id, kind, depth: depthOf(id), ref: refOf.get(id)!, parent: par });
		const label = kind === "workflow" && par.startsWith("wf:") ? "variant" : kind === "suggested" ? "suggested" : undefined;
		edges.push({ id: `${par}->${id}`, source: par, target: id, dashed: kind === "suggested", label });
	}
	return { nodes, edges };
}

/** Ids on the path from the root to `id` (inclusive), for the highlight. */
export function pathTo(nodes: MapNode[], id: string): Set<string> {
	const by = new Map(nodes.map((n) => [n.id, n]));
	const out = new Set<string>();
	let cur = by.get(id);
	while (cur) { out.add(cur.id); cur = cur.parent ? by.get(cur.parent) : undefined; }
	// Selecting something lights everything under it too — an experiment's
	// versions ARE its answer, and a workflow's experiments, versions and
	// variants are what you picked it to see; the camera frames the lot
	// (2026-11-27: "when picking a workflow, should rebalance to better display").
	const kids = new Map<string, string[]>();
	for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
	const stack = [...(kids.get(id) ?? [])];
	while (stack.length) { const k = stack.pop()!; if (out.has(k)) continue; out.add(k); stack.push(...(kids.get(k) ?? [])); }
	return out;
}

/** The map's status line, in words. */
export function mapSummary(exps: MeExperiment[], proposals: Proposal[], workflows: GraphWorkflow[] = []): string {
	if (workflows.length) {
		const main = workflows.filter((w) => !w.helper);
		const variants = main.filter((w) => w.parent).length;
		const sug = proposals.filter((p) => !exps.some((e) => e.id === p.id)).length;
		const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
		const parts = [n(main.length - variants, "workflow")];
		if (variants) parts.push(n(variants, "variant"));
		parts.push(n(exps.length, "experiment"));
		if (sug) parts.push(`${sug} suggested`);
		return parts.join(" · ");
	}
	const all = exps.flatMap((e) => versionsOf(e));
	const versions = all.length;
	const tried = all.filter((v) => v.tag !== "not run yet").length;
	const sug = proposals.filter((p) => !exps.some((e) => e.id === p.id)).length;
	const triedWords = tried === versions ? `${versions} version${versions === 1 ? "" : "s"} tried` : tried === 0 ? `${versions} version${versions === 1 ? "" : "s"}, none tried yet` : `${tried} of ${versions} versions tried`;
	const parts = [`${exps.length} experiment${exps.length === 1 ? "" : "s"}`, triedWords];
	if (sug) parts.push(`${sug} suggested`);
	return parts.join(" · ");
}

/** When versions can't be compared: what differed between them and what to
 *  do about it, in words — "measured 18 different ways" alone told a reader
 *  nothing they could act on (first-glance test, 2026-11-25). */
export function comparabilityNote(e: MeExperiment): string | null {
	if (e.comparable !== false) return null;
	const dims = (e.compare_within || []).map((d) => humanId(d).toLowerCase());
	const what = dims.length ? `They differ in ${dims.join(" and ")}` : "They ran under different setups";
	return `${what}, so a gap between them may come from the setup rather than the version. To compare them, run every version under the same setup.`;
}

/** A workflow's state in words, from its row (no extra request per dot). */
export function rowStatus(row?: MeWorkflowRow): { text: string; tone: "ok" | "failing" | "running" | "idle" } {
	if (!row) return { text: "Hasn't run yet", tone: "idle" };
	if (row.running) return { text: "Running now", tone: "running" };
	if (!row.last_run_ts) return { text: "Hasn't run yet", tone: "idle" };
	const ago = fmtAgo(row.last_run_ts);
	return row.last_run_ok === false ? { text: `Last run failed ${ago}`, tone: "failing" } : { text: `Last run succeeded ${ago}`, tone: "ok" };
}
