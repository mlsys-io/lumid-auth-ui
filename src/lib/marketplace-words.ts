// marketplace-words — what installing an app will do and spend, said before
// the press (2026-11-28 sweep, gaps #6 and #7).
//
// The card and the Details dialog both said "first run starts automatically".
// It doesn't: install (LumidOS me_intent_picker `_process_install`) only stages
// the app, and the scheduler registers a workflow only when its `run:` is a
// schedule — `run: manual` (the default) never fires on its own, and a
// `scope: operator` workflow never runs in a user's copy. So the words come
// from the app's own spec: its declared `compute.budget`, whether anything
// uses a GPU or a model, and which workflows run on a schedule. Nothing here
// is guessed: a spec that says nothing gets no claim.

import { describeSchedule, parseSchedule } from "@/lib/schedule";

/** The xpio index caps `summary` at this many characters. */
export const SUMMARY_CAP = 512;

/** A summary as the index served it, marked when the index cut it short
 *  ("…" at the last whole word) — it used to end mid-word: "(cryp". */
export function clippedSummary(s: string | null | undefined, cap = SUMMARY_CAP): string {
	const t = (s || "").trim();
	if (t.length < cap || /[.!?)"'’”]$/.test(t)) return t;
	const cut = t.replace(/\s+\S*$/, "").replace(/[\s,;:—–-]+$/, "");
	return `${cut || t}…`;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : 0);

export interface InstallFacts {
	/** "Uses GPU time and LLM calls" — null when the spec declares neither. */
	uses: string | null;
	/** "168 GPU-min budget in all, at most 2 runs at once" — null without one. */
	budget: string | null;
	/** "Nothing runs until you press Run." or which workflows run on a schedule. */
	runs: string;
}

function workflowsOf(doc: Obj): Obj[] {
	const wf = doc.workflows ?? doc.loops;
	if (Array.isArray(wf)) return wf.filter(isObj);
	if (isObj(wf)) return Object.entries(wf).filter(([, v]) => isObj(v)).map(([id, v]) => ({ id, ...(v as Obj) }));
	return [];
}

function amount(n: number): string {
	return Number.isInteger(n) ? n.toLocaleString("en-US") : String(Math.round(n * 10) / 10);
}

function perWords(per: unknown): string {
	const p = String(per || "").toLowerCase();
	return p === "total" ? " in all" : p === "day" || p === "daily" ? " a day" : p === "week" || p === "weekly" ? " a week" : p === "month" || p === "monthly" ? " a month" : "";
}

/** What installing this app will run and spend, from its parsed spec. null
 *  when there is no spec to read (say nothing rather than guess). */
export function installFacts(spec: unknown): InstallFacts | null {
	if (!isObj(spec)) return null;
	const compute = isObj(spec.compute) ? spec.compute : {};
	const budget = isObj(compute.budget) ? compute.budget : {};
	const workflows = workflowsOf(spec);
	const config = isObj(spec.config) ? spec.config : {};

	const gpuMin = num(budget.gpu_minutes);
	const cpuMin = num(budget.cpu_minutes);
	const usd = num(budget.usd);
	const gpu = gpuMin > 0 || workflows.some((w) => isObj(w.compute) && !!(w.compute as Obj).gpu) || !!compute.gpu;
	// A model the app calls is declared in its config ("judge_model",
	// "default_analyst_model") or as a judge panel.
	const llm = Object.entries(config).some(([k, v]) => (/(^|_)model$/.test(k) && typeof v === "string" && v.trim() !== "") || (k === "judge_panel" && !!v));
	const uses = gpu && llm ? "Uses GPU time and LLM calls" : gpu ? "Uses GPU time" : llm ? "Uses LLM calls" : null;

	const limits: string[] = [];
	if (gpuMin > 0) limits.push(`${amount(gpuMin)} GPU-min`);
	if (cpuMin > 0) limits.push(`${amount(cpuMin)} CPU-min`);
	if (usd > 0) limits.push(`$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`);
	const parallel = num(budget.parallel);
	const budgetWords = limits.length
		? `${limits.join(" + ")} budget${perWords(budget.per)}${parallel > 0 ? `, at most ${parallel} ${parallel === 1 ? "run" : "runs"} at once` : ""}`
		: null;

	// Which workflows run on their own in YOUR copy.
	const scheduled = workflows
		.filter((w) => String(w.scope || "").toLowerCase() !== "operator")
		.map((w) => String(w.run ?? w.schedule ?? "manual").trim())
		.filter((s) => s && !/^(manual|@trigger)$/i.test(s));
	let runs: string;
	if (!scheduled.length) runs = "Nothing runs until you press Run.";
	else {
		const when = (s: string) => (parseSchedule(s).kind === "custom" ? "on a schedule" : describeSchedule(s).toLowerCase());
		const kinds = [...new Set(scheduled.map(when))];
		const how = kinds.length === 1 ? kinds[0] : "each on its own schedule";
		const all = scheduled.length === workflows.filter((w) => String(w.scope || "").toLowerCase() !== "operator").length;
		runs = scheduled.length === 1
			? `1 workflow runs on its own, ${how}${all ? "." : "; the rest wait until you press Run."}`
			: `${scheduled.length} workflows run on their own, ${how}${all ? "." : "; the rest wait until you press Run."}`;
	}
	return { uses, budget: budgetWords, runs };
}

/** The facts as the lines under the Install button. */
export function installLines(f: InstallFacts | null): string[] {
	if (!f) return ["Appears in My Agents."];
	const spend = [f.uses, f.budget].filter(Boolean).join(" · ");
	return [spend ? `${spend}.` : "", `Appears in My Agents. ${f.runs}`].filter(Boolean);
}
