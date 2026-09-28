// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts (the repo
// has no standalone test runner; see that script's header).
//
// Sample payloads are the shapes the quant-research backtest verb actually
// emits (commands/backtest.py: _do_submit, _do_matched, _do_poll, _lookup_claim)
// wrapped the way identity returns a completed run_loop intent.
import {
	bumpVersion, interpolateTemplate, extractClaims, cycleResultOf, engineBlockOf,
	evalDoneWhen, normalizePollBlock, terminalClaimError, verdictOf, formatWindowSecs,
	pollTiming, mergeSelection, parseAxes, DEFAULT_AXES, MIN_POLL_S,
} from "./await-run";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

// ── fixtures ──────────────────────────────────────────────────────────────
const intentOf = (commandEngine: Record<string, unknown>, ok = true) => ({
	intent_id: "job-1",
	status: "completed",
	result: { ok, action: "run_loop", data: { ok, engine: "command", command_engine: commandEngine } },
});
const submitCE = { ok: true, outcome: "claimed", claim_id: "c-42", symbol: "KXTEST-1" };
const matchedCE = {
	ok: true, outcome: "2/2 claimed on KXTEST-1",
	matched: { symbol: "KXTEST-1", symbol_source: "explicit", window_secs: "604800", until: "2026-09-27T00:00:00Z" },
	claims: [
		{ strategy_id: "a1", ok: true, claim_id: "c-1", outcome: "claimed" },
		{ strategy_id: "b2", ok: true, claim_id: "c-2", outcome: "claimed" },
	],
};
const realRow = {
	strategy_id: "a1", claim_id: "c-1", symbol: "KXTEST-1",
	replay: "pg_tape", signals: "recorded", settlement: "resolved",
	tape_window_secs: 604800, tape_until: "2026-09-27T00:00:00Z",
	replay_verdict: "real", replay_note: "replay=pg_tape, signals=recorded, settlement=resolved: …",
	presentable_as_performance: true, claim_status: "done", error: null,
	performance: { total_actions: 12, filled_lots: 7, realized_pnl_ticks: -3, fees_ticks: 1, steps_evaluated: 400 },
};
const synthRow = {
	strategy_id: "b2", claim_id: "c-2", symbol: "KXTEST-1",
	replay: "pg_tape", signals: "static", settlement: "resolved",
	replay_verdict: "synthetic",
	replay_note: "replay=pg_tape (real prices) BUT signals=static: the decisions were not driven by recorded signal values.",
	presentable_as_performance: false, claim_status: "done",
	synthetic: { total_actions: 99, filled_lots: 50, realized_pnl_ticks: 1000 },
};
const pollCE = { ok: true, outcome: "1 result(s)", results: [realRow] };

// ── version bump ──────────────────────────────────────────────────────────
check("bump: semver patch", () => eq(bumpVersion("1.2.3"), "1.2.4"));
check("bump: v-prefixed semver keeps the prefix", () => eq(bumpVersion("v0.9.9"), "v0.9.10"));
check("bump: pre-release suffix dropped", () => eq(bumpVersion("1.2.3-rc.1"), "1.2.4"));
check("bump: non-semver appends .1", () => { eq(bumpVersion("1.0"), "1.0.1"); eq(bumpVersion("draft"), "draft.1"); eq(bumpVersion("2"), "2.1"); });
check("bump: blank / missing", () => { eq(bumpVersion(""), "0.0.1"); eq(bumpVersion(undefined), "0.0.1"); });
check("bump: numbers are stringified", () => eq(bumpVersion(3), "3.1"));

// ── interpolation ─────────────────────────────────────────────────────────
const row = { name: "ofi_momentum", version: "1.0.3", source: "when ofi_z > 1.5 buy 1", strategy_id: "s-9", meta: { owner: "yao" } };
check("interp: plain field", () => eq(interpolateTemplate("{name}", row), "ofi_momentum"));
check("interp: multi-line source survives", () => eq(interpolateTemplate("{source}", { source: "a\nb" }), "a\nb"));
check("interp: bump filter", () => eq(interpolateTemplate("{version|bump}", row), "1.0.4"));
check("interp: bump on a missing field", () => eq(interpolateTemplate("{nope|bump}", row), "0.0.1"));
check("interp: missing field renders empty, never the token", () => eq(interpolateTemplate("x={missing}.", row), "x=."));
check("interp: dotted path", () => eq(interpolateTemplate("{meta.owner}", row), "yao"));
check("interp: flat key with a dot wins over path", () => eq(interpolateTemplate("{metrics.claim_id}", { "metrics.claim_id": "c-7" }), "c-7"));
check("interp: unknown filter leaves value", () => eq(interpolateTemplate("{name|nosuch}", row), "ofi_momentum"));
check("interp: mixed template", () => eq(interpolateTemplate("{name} v{version|bump} ({strategy_id})", row), "ofi_momentum v1.0.4 (s-9)"));
check("interp: no row", () => eq(interpolateTemplate("{name}", undefined), ""));

// ── claim extraction ──────────────────────────────────────────────────────
check("cycle result is result.data", () => eq(engineBlockOf(cycleResultOf(intentOf(submitCE))).claim_id, "c-42"));
check("claims: single path", () => {
	const got = extractClaims(cycleResultOf(intentOf(submitCE)), "command_engine.claim_id");
	eq(got.map((c) => c.claim_id), ["c-42"]);
	eq(got[0].context.symbol, "KXTEST-1", "context is the holder");
});
check("claims: absent single path → none", () => eq(extractClaims(cycleResultOf(intentOf({ ok: false, outcome: "refused_inflight_cap" })), "command_engine.claim_id"), []));
check("claims: [] maps over matched claims", () => {
	const got = extractClaims(cycleResultOf(intentOf(matchedCE)), "command_engine.claims[].claim_id");
	eq(got.map((c) => [c.claim_id, c.context.strategy_id]), [["c-1", "a1"], ["c-2", "b2"]]);
});
check("claims: element without an id is kept, blank", () => {
	const ce = { ...matchedCE, claims: [matchedCE.claims[0], { strategy_id: "zz", ok: false, outcome: "resolve_failed", error: "no body" }] };
	const got = extractClaims(cycleResultOf(intentOf(ce)), "command_engine.claims[].claim_id");
	eq(got.map((c) => c.claim_id), ["c-1", ""]);
	eq(got[1].context.error, "no body");
});

// ── done_when ─────────────────────────────────────────────────────────────
const DW = "results[claim_id={claim_id}].claim_status in (done,failed)";
check("done_when: resolved claim matches and returns its row", () => {
	const ev = evalDoneWhen(DW, pollCE, { claim_id: "c-1" });
	eq(ev.done, true); eq(ev.match?.symbol, "KXTEST-1");
});
check("done_when: other claim not done", () => eq(evalDoneWhen(DW, pollCE, { claim_id: "c-2" }).done, false));
check("done_when: still pending poll", () => eq(evalDoneWhen(DW, { ok: true, outcome: "1 claim(s) still pending", results: [] }, { claim_id: "c-1" }).done, false));
check("done_when: status outside the set", () => eq(evalDoneWhen(DW, { results: [{ ...realRow, claim_status: "running" }] }, { claim_id: "c-1" }).done, false));
check("done_when: quoted values and ==", () => {
	eq(evalDoneWhen("results[claim_id='{claim_id}'].claim_status in ('done', 'failed')", pollCE, { claim_id: "c-1" }).done, true);
	eq(evalDoneWhen("outcome == nothing_open", { outcome: "nothing_open" }, {}).done, true);
	eq(evalDoneWhen("outcome != nothing_open", { outcome: "nothing_open" }, {}).done, false);
});
check("done_when: bare truthy path", () => { eq(evalDoneWhen("ok", { ok: true }, {}).done, true); eq(evalDoneWhen("ok", { ok: false }, {}).done, false); });
check("done_when: claim_record lookup folded into results", () => {
	const rec = { ok: true, outcome: "claim_record", claim_id: "c-1", claim_status: "done", result: { ...realRow, claim_status: undefined } };
	const ev = evalDoneWhen(DW, normalizePollBlock(rec), { claim_id: "c-1" });
	eq(ev.done, true); eq(ev.match?.replay, "pg_tape");
});
check("normalize: a real results[] is untouched", () => eq(normalizePollBlock(pollCE), pollCE));
check("terminal: claim_not_found for this claim", () => {
	const nf = { ok: false, outcome: "claim_not_found", claim_id: "c-1", error: "no claim with this id is visible to you" };
	eq(terminalClaimError(nf, "c-1"), "no claim with this id is visible to you");
	eq(terminalClaimError(nf, "c-2"), null);
	eq(terminalClaimError(pollCE, "c-1"), null);
});

// ── verdict ───────────────────────────────────────────────────────────────
check("verdict: real result shows numbers", () => {
	const v = verdictOf(realRow);
	eq(v.axes.map((a) => [a.label, a.real]), [["prices", true], ["signals", true], ["settlement", true]]);
	eq([v.presentable, v.total_actions, v.filled_lots, v.realized_pnl_ticks], [true, 12, 7, -3]);
	eq(v.window, "7d ending 2026-09-27T00:00Z");
	eq(v.symbol, "KXTEST-1");
});
check("verdict: not presentable hides synthetic numbers and keeps the note", () => {
	const v = verdictOf(synthRow);
	eq(v.axes.map((a) => a.real), [true, false, true]);
	eq([v.presentable, v.total_actions, v.realized_pnl_ticks], [false, undefined, undefined]);
	eq(v.note.startsWith("replay=pg_tape (real prices) BUT signals=static"), true);
});
check("verdict: missing axis is unknown, not false", () => eq(verdictOf({ replay: "synthetic_lcg" }).axes.map((a) => a.real), [false, null, null]));
check("verdict: error surfaces", () => eq(verdictOf({ claim_status: "failed", error: "compile error at line 3" }).error, "compile error at line 3"));
check("verdict: window falls back to the matched block", () => eq(verdictOf({ claim_id: "c-2" }, DEFAULT_AXES, matchedCE.matched).window, "7d ending 2026-09-27T00:00Z"));
check("axes: override parses, malformed falls back", () => {
	eq(parseAxes([{ key: "px", label: "px", real: ["live"] }]).map((a) => a.key), ["px"]);
	eq(parseAxes("nope"), DEFAULT_AXES);
});
check("window seconds", () => { eq(formatWindowSecs(86400), "1d"); eq(formatWindowSecs("7200"), "2h"); eq(formatWindowSecs(90), "90s"); eq(formatWindowSecs(""), ""); });

// ── timing + selection ────────────────────────────────────────────────────
check("poll timing: floor at 20s, default max 600", () => {
	eq(pollTiming(5, undefined), { everyS: MIN_POLL_S, maxS: 600 });
	eq(pollTiming(30, 120), { everyS: 30, maxS: 120 });
	eq(pollTiming(undefined, 99999).maxS, 3600);
});
check("selection: fields comma-joined in selection order", () => {
	const m = mergeSelection([{ strategy_id: "b2", name: "B" }, { strategy_id: "a1", name: "A" }]);
	eq(interpolateTemplate("{strategy_id}", m), "b2,a1");
	eq(m.name, "B,A");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;
