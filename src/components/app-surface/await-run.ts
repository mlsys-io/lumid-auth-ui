// Pure helpers behind the app-surface renderer's row-action extensions:
// template interpolation with filters, the semver-patch `bump` filter, claim-id
// extraction from a cycle result, the small `done_when` expression, and the
// backtest-style verdict projection.
//
// NO imports on purpose — this file is bundled into the node test run
// (scripts/test-workflow.mjs) and must not drag in React, axios or the browser.
// The stateful side (dispatch, polling, the page-level store) lives in
// await-driver.ts.

export type Obj = Record<string, unknown>;

/** Dot-path getter. "" / "." returns the root. A segment that is a key of the
 *  current object wins over splitting, so `{a.b}` still reads a flat row that
 *  literally has an "a.b" column. */
export function getPath(obj: unknown, path?: string): unknown {
	if (!path || path === ".") return obj;
	if (obj && typeof obj === "object" && path in (obj as Obj)) return (obj as Obj)[path];
	return path.split(".").reduce<unknown>(
		(o, k) => (o == null || typeof o !== "object" ? undefined : (o as Obj)[k]),
		obj,
	);
}

// ── version bump ──────────────────────────────────────────────────────────

/** Semver PATCH bump. `1.2.3` → `1.2.4`, `v1.2.3` → `v1.2.4`; a pre-release or
 *  build suffix is dropped (`1.2.3-rc.1` → `1.2.4`). Anything that is not
 *  X.Y.Z gets `.1` appended (`1.0` → `1.0.1`, `draft` → `draft.1`) so the
 *  result always differs from the input. Blank → `0.0.1`. */
export function bumpVersion(v: unknown): string {
	const s = v == null ? "" : String(v).trim();
	if (!s) return "0.0.1";
	const m = s.match(/^(v?)(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/);
	if (!m) return `${s}.1`;
	return `${m[1]}${m[2]}.${m[3]}.${Number(m[4]) + 1}`;
}

const FILTERS: Record<string, (v: unknown) => string> = {
	bump: bumpVersion,
	trim: (v) => (v == null ? "" : String(v).trim()),
	upper: (v) => (v == null ? "" : String(v).toUpperCase()),
	lower: (v) => (v == null ? "" : String(v).toLowerCase()),
};

/** Replace `{path}` / `{path|filter}` tokens from `vars`. A missing value
 *  renders "" (never the literal token); an unknown filter leaves the value
 *  unfiltered. Non-strings pass through untouched. */
export function interpolateTemplate(tpl: unknown, vars: Obj | undefined): string {
	if (tpl == null) return "";
	const s = String(tpl);
	return s.replace(/\{([^{}|]+)(?:\|([\w-]+))?\}/g, (_m, key: string, filter?: string) => {
		const raw = getPath(vars ?? {}, key.trim());
		if (filter && FILTERS[filter]) return FILTERS[filter](raw);
		if (raw == null) return "";
		return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
	});
}

// ── claim extraction ──────────────────────────────────────────────────────

export type ExtractedClaim = { claim_id: string; context: Obj };

/** Where a completed run_loop intent keeps the cycle result: identity's
 *  envelope is `{status, result: {ok, error?, data: <cycle summary>}}` and the
 *  command engine's own JSON sits at `data.command_engine`. Accepts either the
 *  whole intent response or just its `result`. */
export function cycleResultOf(intent: unknown): Obj {
	const i = (intent ?? {}) as Obj;
	const res = (i.result && typeof i.result === "object" ? i.result : i) as Obj;
	const data = res.data;
	return (data && typeof data === "object" ? data : res) as Obj;
}

/** The block a verb's own output lives in — `command_engine` when the cycle
 *  ran a command engine, else the cycle result itself. */
export function engineBlockOf(cycle: Obj): Obj {
	const ce = cycle.command_engine;
	return (ce && typeof ce === "object" ? ce : cycle) as Obj;
}

/** Pull claim ids out of a cycle result by a path. One `[]` segment maps over
 *  an array: `command_engine.claims[].claim_id` → one entry per element (the
 *  element is the entry's context — so a compare can label each claim by the
 *  strategy it was filed for). Without `[]` the path yields at most one id and
 *  the context is the object holding it. Elements lacking an id are KEPT with
 *  claim_id "" so a partial failure (one strategy failed to resolve) is shown,
 *  not silently dropped. */
export function extractClaims(root: unknown, path: string): ExtractedClaim[] {
	const i = path.indexOf("[]");
	if (i < 0) {
		const dot = path.lastIndexOf(".");
		const parent = dot < 0 ? root : getPath(root, path.slice(0, dot));
		const leaf = dot < 0 ? path : path.slice(dot + 1);
		const v = getPath(parent, leaf);
		if (v == null || v === "") return [];
		return [{ claim_id: String(v), context: (parent && typeof parent === "object" ? parent : {}) as Obj }];
	}
	const arr = getPath(root, path.slice(0, i));
	const rest = path.slice(i + 2).replace(/^\./, "");
	if (!Array.isArray(arr)) return [];
	return arr
		.filter((el) => el != null)
		.map((el) => {
			const v = rest ? getPath(el, rest) : el;
			return {
				claim_id: v == null ? "" : String(v),
				context: (typeof el === "object" ? el : { value: el }) as Obj,
			};
		});
}

// ── done_when ─────────────────────────────────────────────────────────────
//
// Grammar (deliberately tiny):
//     <path> in (<v1>, <v2>, …)
//     <path> == <v>          (also =, !=)
//     <path>                 (truthy)
// where a path segment may carry ONE filter: `results[claim_id={claim_id}]`
// picks the first element of `results` whose claim_id equals the value.
// `{var}` tokens are interpolated before parsing. Values may be quoted.

export type DoneEval = { done: boolean; match?: Obj; value?: unknown };

function unquote(s: string): string {
	const t = s.trim();
	return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

/** Resolve a filtered path; returns the value AND the innermost object the
 *  final field was read from (the "row" a verdict is built from). */
export function resolveFiltered(root: unknown, path: string): { value: unknown; holder?: Obj } {
	const segs = path.split(".").filter(Boolean);
	let cur: unknown = root;
	let holder: Obj | undefined = root && typeof root === "object" ? (root as Obj) : undefined;
	// Re-join segments split inside a [..=..] filter whose value has a dot.
	const joined: string[] = [];
	for (const s of segs) {
		const last = joined[joined.length - 1];
		if (last && last.includes("[") && !last.includes("]")) joined[joined.length - 1] = `${last}.${s}`;
		else joined.push(s);
	}
	for (const seg of joined) {
		if (cur == null || typeof cur !== "object") return { value: undefined };
		const m = seg.match(/^([^[\]]+)\[([^=\]]+)=([^\]]*)\]$/);
		if (m) {
			const arr = (cur as Obj)[m[1]];
			if (!Array.isArray(arr)) return { value: undefined };
			const want = unquote(m[3]);
			const hit = arr.find((el) => el && typeof el === "object" && String((el as Obj)[m[2].trim()] ?? "") === want);
			if (!hit) return { value: undefined };
			cur = hit;
			holder = hit as Obj;
		} else {
			holder = cur as Obj;
			cur = (cur as Obj)[seg];
		}
	}
	// A path that ends ON a filtered element: the element is its own holder.
	if (cur && typeof cur === "object" && !Array.isArray(cur) && joined.length && /\]$/.test(joined[joined.length - 1])) {
		holder = cur as Obj;
	}
	return { value: cur, holder };
}

export function evalDoneWhen(expr: string, data: unknown, vars: Obj): DoneEval {
	const e = interpolateTemplate(expr, vars).trim();
	if (!e) return { done: false };
	let m = e.match(/^(.+?)\s+in\s+\((.*)\)$/);
	if (m) {
		const { value, holder } = resolveFiltered(data, m[1].trim());
		const set = m[2].split(",").map(unquote).filter((x) => x !== "");
		return { done: value != null && set.includes(String(value)), match: holder, value };
	}
	m = e.match(/^(.+?)\s*(==|!=|=)\s*(.+)$/);
	if (m) {
		const { value, holder } = resolveFiltered(data, m[1].trim());
		const eq = value != null && String(value) === unquote(m[3]);
		return { done: m[2] === "!=" ? value != null && !eq : eq, match: holder, value };
	}
	const { value, holder } = resolveFiltered(data, e);
	return { done: !!value && value !== "false" && value !== "0", match: holder, value };
}

/** Fold a named-claim LOOKUP answer into the list shape a poll uses.
 *
 *  A poll naming a claim that is no longer open answers with the claim's
 *  durable record — `{claim_id, claim_status, result: {...}}` — instead of
 *  `results[]`. That is the normal second answer once a first poll resolved
 *  it, so without this fold a `results[claim_id=…]` condition never matches
 *  and the page polls a finished claim until max_s. */
export function normalizePollBlock(block: Obj): Obj {
	if (Array.isArray(block.results) && block.results.length) return block;
	const cid = block.claim_id;
	const st = block.claim_status;
	if (cid != null && st != null && String(cid) !== "") {
		const inner = block.result && typeof block.result === "object" ? (block.result as Obj) : {};
		return {
			...block,
			results: [{ ...inner, claim_id: cid, claim_status: st, ...(block.error ? { error: block.error } : {}) }],
		};
	}
	return block;
}

/** A poll answer that says THIS claim can never resolve (e.g. the gateway has
 *  no record of it). Terminal — polling it again changes nothing. */
export function terminalClaimError(block: Obj, claimId: string): string | null {
	if (block.ok !== false) return null;
	if (String(block.claim_id ?? "") !== claimId) return null;
	return String(block.error ?? block.outcome ?? "claim failed");
}

// ── verdict ───────────────────────────────────────────────────────────────

export type AxisSpec = { key: string; label: string; real: string[] };
export type AxisVerdict = { label: string; value: string; real: boolean | null };

/** Default axes for `show: verdict` — the backtest result's three honesty
 *  axes and the values the verb itself counts as real (backtest.py
 *  _REAL_REPLAY / _REAL_SIGNALS / _REAL_SETTLEMENT). Overridable per action
 *  via `await.axes` so another app can map its own. */
export const DEFAULT_AXES: AxisSpec[] = [
	{ key: "replay", label: "prices", real: ["pg_tape", "iceberg"] },
	{ key: "signals", label: "signals", real: ["recorded"] },
	{ key: "settlement", label: "settlement", real: ["resolved"] },
];

export type Verdict = {
	claim_id: string;
	claim_status: string;
	symbol: string;
	window: string;
	axes: AxisVerdict[];
	presentable: boolean;
	total_actions: unknown;
	filled_lots: unknown;
	realized_pnl_ticks: unknown;
	note: string;
	error: string;
};

/** Seconds → a short human window (`604800` → `7d`). */
export function formatWindowSecs(v: unknown): string {
	const n = Number(v);
	if (v == null || v === "" || !isFinite(n) || n <= 0) return "";
	if (n % 86400 === 0) return `${n / 86400}d`;
	if (n % 3600 === 0) return `${n / 3600}h`;
	if (n % 60 === 0) return `${n / 60}m`;
	return `${n}s`;
}

function windowText(secs: unknown, until: unknown): string {
	const w = formatWindowSecs(secs);
	const u = until == null || until === "" ? "" : String(until).replace(/:00Z$|\.\d+Z$/, "Z");
	if (w && u) return `${w} ending ${u}`;
	return w || (u ? `ending ${u}` : "");
}

/** Project one result row into what the verdict panel shows. Numbers are
 *  surfaced ONLY when the verb itself marked the result presentable; any other
 *  result carries its reason (`replay_note`) instead — a synthetic PnL must
 *  never sit in a column that reads as performance. `fallback` supplies the
 *  submit-time symbol/window when the result row lacks them (a compare's
 *  frozen `matched` block). */
export function verdictOf(row: Obj | undefined, axes: AxisSpec[] = DEFAULT_AXES, fallback: Obj = {}): Verdict {
	const r = row ?? {};
	const perf = (r.performance && typeof r.performance === "object" ? r.performance : {}) as Obj;
	const presentable = r.presentable_as_performance === true;
	const axisOut = axes.map((a) => {
		const raw = r[a.key];
		const value = raw == null ? "" : String(raw);
		return { label: a.label, value, real: value ? a.real.includes(value) : null };
	});
	return {
		claim_id: String(r.claim_id ?? fallback.claim_id ?? ""),
		claim_status: String(r.claim_status ?? ""),
		symbol: String(r.symbol || fallback.symbol || ""),
		window: windowText(r.tape_window_secs ?? fallback.window_secs, r.tape_until ?? fallback.until),
		axes: axisOut,
		presentable,
		total_actions: presentable ? perf.total_actions : undefined,
		filled_lots: presentable ? perf.filled_lots : undefined,
		realized_pnl_ticks: presentable ? perf.realized_pnl_ticks : undefined,
		note: String(r.replay_note ?? r.reason ?? ""),
		error: r.error == null || r.error === "" ? "" : String(r.error),
	};
}

/** Parse `await.axes` from YAML — `[{key, label?, real: [..]}]` — falling back
 *  to DEFAULT_AXES on anything malformed. */
export function parseAxes(v: unknown): AxisSpec[] {
	if (!Array.isArray(v) || !v.length) return DEFAULT_AXES;
	const out: AxisSpec[] = [];
	for (const a of v) {
		if (!a || typeof a !== "object") continue;
		const o = a as Obj;
		if (typeof o.key !== "string") continue;
		out.push({
			key: o.key,
			label: String(o.label ?? o.key),
			real: Array.isArray(o.real) ? o.real.map(String) : [],
		});
	}
	return out.length ? out : DEFAULT_AXES;
}

/** Enforced floor between two poll cycles. Each poll is a real cycle job
 *  against the tenant's daily cycle quota, so no surface may go faster. */
export const MIN_POLL_S = 20;
export const DEFAULT_POLL_MAX_S = 600;
export const HARD_POLL_MAX_S = 3600;

export function pollTiming(every?: unknown, max?: unknown): { everyS: number; maxS: number } {
	const e = Number(every);
	const m = Number(max);
	return {
		everyS: Math.max(MIN_POLL_S, isFinite(e) && e > 0 ? e : MIN_POLL_S),
		maxS: Math.min(HARD_POLL_MAX_S, isFinite(m) && m > 0 ? m : DEFAULT_POLL_MAX_S),
	};
}

/** Selection → one interpolation row: every key becomes the comma-joined
 *  values across the selected rows, in selection order (`{strategy_id}` over
 *  two picked rows → "a,b"). Blank values are skipped. */
export function mergeSelection(rows: Obj[]): Obj {
	const out: Obj = {};
	const keys = new Set<string>();
	for (const r of rows) for (const k of Object.keys(r ?? {})) keys.add(k);
	for (const k of keys) {
		out[k] = rows
			.map((r) => r?.[k])
			.filter((v) => v != null && v !== "" && typeof v !== "object")
			.map(String)
			.join(",");
	}
	return out;
}
