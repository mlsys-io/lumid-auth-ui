// The stateful half of `run_loop.await` — dispatch → wait for the cycle →
// pull the claim id(s) → re-dispatch the poll loop until each claim resolves.
//
// State lives in a MODULE-LEVEL store, not in the component that fired it.
// The dialog that collected the fields closes on submit, a polled table hands
// every row a fresh object every 15-30s, and the user may scroll or switch tab
// — none of that may lose a backtest that is still running. A widget reads the
// store by `scope` (the table it belongs to) and renders whatever is there.
//
// The store is also PERSISTED (localStorage, per viewer) and resumed on load.
// Measured 2026-09-28 with the undergrad persona: a reader who clicked
// Backtest and then navigated away or reloaded lost the only thing polling
// their claim — user tenants have no scheduled poll — so the verdict never
// arrived anywhere, not even on the strategy page.
//
// Pure pieces (interpolation, done_when, verdict) are in await-run.ts so they
// can be unit tested without a browser.

import { useSyncExternalStore } from "react";
import { me } from "@/api/me";
import {
	type Obj, cycleResultOf, engineBlockOf, extractClaims, evalDoneWhen,
	interpolateTemplate, normalizePollBlock, terminalClaimError, pollTiming,
} from "./await-run";

export type AwaitCfg = {
	/** Wait for the dispatched cycle's intent to complete. Always on; kept in
	 *  the contract so a spec reads as what it does. */
	intent?: boolean;
	/** Where the claim id(s) sit in the completed cycle result, e.g.
	 *  `command_engine.claim_id` or `command_engine.claims[].claim_id`. */
	claim_path?: string;
	/** Re-dispatch this loop until each claim is done. */
	then_poll?: {
		app?: string;
		loop: string;
		args?: Record<string, unknown>;
		every_s?: number;
		max_s?: number;
		done_when?: string;
	};
	/** `verdict` (one panel per claim) or `compare` (one column per claim). */
	show?: "verdict" | "compare";
	/** Header of the tracked run; `{field}` from the row. */
	title?: string;
	/** Axis mapping override for the verdict (see await-run.ts DEFAULT_AXES). */
	axes?: unknown;
	/** Row field used as a compare column's header (default `name`). */
	label_key?: string;
};

export type Phase = "queued" | "running" | "polling" | "done" | "failed" | "timeout";

export type ClaimState = {
	claim_id: string;
	context: Obj;
	label: string;
	done: boolean;
	result?: Obj;
	error?: string;
};

export type TrackedRun = {
	id: string;
	scope: string;
	title: string;
	show: "verdict" | "compare";
	axes?: unknown;
	phase: Phase;
	jobId: string;
	startedAt: number;
	polls: number;
	message?: string;
	error?: string;
	claims: ClaimState[];
	/** The verb's own frozen config for a compare (symbol/window/until). */
	matched?: Obj;
};

// ── store ─────────────────────────────────────────────────────────────────

let runs: TrackedRun[] = [];
const listeners = new Set<() => void>();
// The args each run was started with, so a resumed run can keep polling.
const argsById: Record<string, StartArgs> = {};
const STORE_KEY = "lumid.await.runs.v1";
// Resume a run only this long after it started; a verdict older than that is
// on the strategy page already, or its claim has expired.
const RESUME_WINDOW_MS = 60 * 60 * 1000;
function save() {
	try {
		const keep = runs.filter((r) => argsById[r.id]).map((r) => ({ run: r, args: argsById[r.id] }));
		localStorage.setItem(STORE_KEY, JSON.stringify(keep));
	} catch { /* private mode / quota: the in-memory store still works */ }
}
const emit = () => { save(); for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const MAX_KEPT = 12;

function update(id: string, patch: Partial<TrackedRun> | ((r: TrackedRun) => Partial<TrackedRun>)) {
	runs = runs.map((r) => (r.id === id ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r));
	emit();
}

export function dismissRun(id: string) {
	runs = runs.filter((r) => r.id !== id);
	delete argsById[id];
	emit();
}

/** Tracked runs for one widget scope, newest first. */
export function useTrackedRuns(scope: string): TrackedRun[] {
	const all = useSyncExternalStore(subscribe, () => runs, () => runs);
	return all.filter((r) => r.scope === scope);
}

// ── driver ────────────────────────────────────────────────────────────────

const INTENT_POLL_MS = 3000;
const INTENT_MAX_MS = 15 * 60 * 1000; // a cycle can queue behind the tenant's others
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type IntentOutcome = { ok: boolean; error?: string; cycle: Obj } | { timeout: true };

async function awaitIntent(jobId: string, deadline: number, onPending?: () => void): Promise<IntentOutcome> {
	while (Date.now() < deadline) {
		await sleep(INTENT_POLL_MS);
		let res: Awaited<ReturnType<typeof me.getIntent>>;
		try {
			res = await me.getIntent(jobId);
		} catch {
			continue; // transient read (or a 429 cooldown) — never invent an outcome
		}
		if (res?.status !== "completed") { onPending?.(); continue; }
		const env = (res.result ?? {}) as Obj;
		const cycle = cycleResultOf(res);
		const block = engineBlockOf(cycle);
		const ok = env.ok !== false && block.ok !== false;
		const raw = String(env.error ?? block.error ?? cycle.error ?? "").trim();
		return { ok, error: ok ? undefined : (raw.split(/[\r\n]/)[0] || "the cycle failed").slice(0, 400), cycle };
	}
	return { timeout: true };
}

export type StartArgs = {
	scope: string;
	title: string;
	app: string;
	jobId: string;
	cfg: AwaitCfg;
	/** Rows the action ran on (one row, or a table selection) — used to label
	 *  each claim by the row it came from. */
	rows: Obj[];
	/** The action's own interpolation row (row + dialog values); poll args
	 *  resolve `{field}` against it, overlaid by each claim's context. */
	baseVars?: Obj;
};

let seq = 0;

/** Register a tracked run for an already-dispatched cycle and drive it to a
 *  verdict in the background. Returns the run id. */
export function startTrackedRun(a: StartArgs): string {
	const id = `run-${Date.now()}-${++seq}`;
	const run: TrackedRun = {
		id, scope: a.scope, title: a.title,
		show: a.cfg.show === "compare" ? "compare" : "verdict",
		axes: a.cfg.axes,
		phase: "queued", jobId: a.jobId, startedAt: Date.now(), polls: 0, claims: [],
		message: "Queued — waiting for the cycle to start.",
	};
	argsById[id] = a;
	runs = [run, ...runs].slice(0, MAX_KEPT);
	emit();
	void drive(id, a).catch((e) => update(id, { phase: "failed", error: String((e as Error)?.message ?? e) }));
	return id;
}

function labelFor(ctx: Obj, rows: Obj[], labelKey: string, claimId: string): string {
	if (rows.length === 1 && rows[0]?.[labelKey] != null && rows[0][labelKey] !== "") return String(rows[0][labelKey]);
	for (const [k, v] of Object.entries(ctx)) {
		if (v == null || typeof v === "object" || ["ok", "outcome", "error", "claim_id"].includes(k)) continue;
		const hit = rows.find((r) => r && r[k] != null && String(r[k]) === String(v));
		if (hit && hit[labelKey] != null && hit[labelKey] !== "") return String(hit[labelKey]);
	}
	const own = ctx[labelKey] ?? ctx.strategy_id ?? claimId;
	return own == null ? "" : String(own);
}

async function drive(id: string, a: StartArgs) {
	const { cfg } = a;
	// 1. The dispatched cycle.
	const first = await awaitIntent(a.jobId, Date.now() + INTENT_MAX_MS, () =>
		update(id, (r) => (r.phase === "queued" ? { phase: "running", message: "Cycle dispatched — waiting for its result." } : {})));
	if ("timeout" in first) {
		update(id, { phase: "timeout", message: `No result from job ${a.jobId} yet — check the app's run history.` });
		return;
	}
	const block = engineBlockOf(first.cycle);
	// 2. The claim id(s). Read even from a cycle that reported ok:false: a
	// compare where ONE of two strategies failed to resolve is ok:false yet
	// holds a live claim for the other, and that claim still deserves a verdict.
	const extracted = cfg.claim_path ? extractClaims(first.cycle, cfg.claim_path) : [];
	if (!first.ok && !extracted.some((c) => c.claim_id)) {
		update(id, { phase: "failed", error: first.error });
		return;
	}
	if (!cfg.claim_path) {
		update(id, { phase: "done", message: String(block.outcome ?? "Completed.") });
		return;
	}
	if (!extracted.length) {
		update(id, {
			phase: "failed",
			error: String(block.error ?? block.reason ?? block.outcome ?? `no claim id at ${cfg.claim_path}`),
		});
		return;
	}
	if (!first.ok) update(id, { error: first.error });
	const labelKey = cfg.label_key || "name";
	const claims: ClaimState[] = extracted.map((c) => ({
		claim_id: c.claim_id,
		context: c.context,
		label: labelFor(c.context, a.rows, labelKey, c.claim_id),
		// An element with no id never got a claim (e.g. its body did not
		// resolve) — it is finished, with its own reason.
		done: !c.claim_id,
		error: c.claim_id ? undefined : String(c.context.error ?? c.context.outcome ?? "no claim was filed"),
	}));
	const matched = block.matched && typeof block.matched === "object" ? (block.matched as Obj) : undefined;
	update(id, { claims, matched });
	await pollClaims(id, a, claims);
}

/** Step 3 on its own, so a run resumed after a reload re-enters here with the
 *  claims it already knows instead of re-reading a finished intent. */
async function pollClaims(id: string, a: StartArgs, claims: ClaimState[]) {
	const { cfg } = a;
	const poll = cfg.then_poll;
	if (!poll?.loop || claims.every((c) => c.done)) {
		update(id, { phase: "done", message: poll?.loop ? "No claim to poll." : "Claimed." });
		return;
	}
	// 3. Poll. One poll cycle at a time — never overlapping — and never more
	// often than every_s (floored at MIN_POLL_S). With several open claims the
	// rounds go round-robin, so a compare costs the same cycles as one backtest.
	const { everyS, maxS } = pollTiming(poll.every_s, poll.max_s);
	const deadline = Date.now() + maxS * 1000;
	const app = String(poll.app || a.app);
	let cur = claims;
	let rr = 0;
	update(id, { phase: "polling", message: `Claimed ${cur.filter((c) => c.claim_id).map((c) => c.claim_id).join(", ")} — first poll in ${everyS}s.` });
	while (Date.now() < deadline) {
		const wait = everyS * 1000;
		if (Date.now() + wait > deadline) break;
		await sleep(wait);
		const open = cur.filter((c) => !c.done);
		if (!open.length) break;
		const target = open[rr++ % open.length];
		const vars: Obj = { ...(a.baseVars ?? {}), ...target.context, claim_id: target.claim_id };
		const args = Object.fromEntries(
			Object.entries(poll.args ?? {}).map(([k, v]) => [k, typeof v === "string" ? interpolateTemplate(v, vars) : v]),
		);
		let jobId = "";
		try {
			const q = await me.runLoopNow(app, poll.loop, args);
			jobId = String(q?.job_id ?? "");
		} catch (e) {
			update(id, { message: `Poll dispatch failed (${String((e as Error)?.message ?? e)}) — retrying.` });
			continue;
		}
		update(id, (r) => ({ polls: r.polls + 1, message: `Poll ${r.polls + 1} for ${target.claim_id} running…` }));
		const out = jobId ? await awaitIntent(jobId, deadline) : { timeout: true as const };
		if ("timeout" in out) break;
		if (!out.ok) {
			// A failed POLL is not a failed backtest — the claim is still out
			// there. Say so and keep going, unless it names this claim as dead.
			const blk = engineBlockOf(out.cycle);
			const dead = terminalClaimError(blk, target.claim_id);
			if (dead) {
				cur = cur.map((c) => (c.claim_id === target.claim_id ? { ...c, done: true, error: dead } : c));
				update(id, { claims: cur });
			} else {
				update(id, { message: `Poll did not complete: ${out.error ?? "unknown error"} — will retry.` });
			}
			continue;
		}
		const blk = normalizePollBlock(engineBlockOf(out.cycle));
		const expr = poll.done_when ?? "";
		cur = cur.map((c) => {
			if (c.done) return c;
			const dead = terminalClaimError(blk, c.claim_id);
			if (dead) return { ...c, done: true, error: dead };
			if (!expr) return c.claim_id === target.claim_id ? { ...c, done: true, result: blk } : c;
			const ev = evalDoneWhen(expr, blk, { ...c.context, claim_id: c.claim_id });
			return ev.done ? { ...c, done: true, result: ev.match } : c;
		});
		const left = cur.filter((c) => !c.done).length;
		update(id, { claims: cur, message: left ? `${left} claim(s) still running.` : undefined });
		if (!left) break;
	}
	const unresolved = cur.filter((c) => !c.done);
	if (unresolved.length) {
		update(id, {
			phase: "timeout",
			message: `Still running after ${maxS}s — stopped polling so it does not burn cycles. ` +
				`Use Check pending results later (claim ${unresolved.map((c) => c.claim_id).join(", ")}).`,
		});
	} else {
		update(id, { phase: "done", message: undefined });
	}
}

// ── resume after a reload ─────────────────────────────────────────────────

function resume() {
	let saved: { run: TrackedRun; args: StartArgs }[] = [];
	try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return; }
	const now = Date.now();
	const fresh = saved.filter((x) => x?.run?.id && x.args && now - Number(x.run.startedAt || 0) < RESUME_WINDOW_MS);
	for (const { run, args } of fresh) argsById[run.id] = args;
	runs = fresh.map((x) => x.run).slice(0, MAX_KEPT);
	for (const r of runs) {
		const a = argsById[r.id];
		const fail = (e: unknown) => update(r.id, { phase: "failed", error: String((e as Error)?.message ?? e) });
		if (r.phase === "queued" || r.phase === "running") void drive(r.id, a).catch(fail);
		else if (r.phase === "polling") {
			update(r.id, { message: "Resumed after reload — polling again." });
			void pollClaims(r.id, a, r.claims).catch(fail);
		}
	}
	emit();
}
if (typeof window !== "undefined") resume();
