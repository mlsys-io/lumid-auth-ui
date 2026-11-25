// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts (the repo
// has no standalone test runner; see that script's header).
import {
	normalizeSources, normalizePlan, normalizeJobs, normalizeJob, normalizeEvents, groupByHub, jobRunStatus,
	jobStatusLabel, isTerminal, routeChip, specFromYaml, specToYaml, addSourceToYaml, validateSpec, parseApiError,
	jobsErrorWords, jobsSourceNotice, jobHref, STARTER_SPEC,
} from "./data-jobs";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

// ── null-safety: every list may arrive as null / missing / wrong type ──
check("sources: null lists normalise to []", () => {
	eq(normalizeSources({ sources: null, hubs: null }), { sources: [], hubs: [] });
	eq(normalizeSources(null), { sources: [], hubs: [] });
	eq(normalizeSources("<html>"), { sources: [], hubs: [] });
});
check("jobs: null + junk rows dropped", () => {
	eq(normalizeJobs({ jobs: null }).jobs, []);
	eq(normalizeJobs({ jobs: [null, 3, { job_id: "" }, { job_id: "j1", status: "running" }] }).jobs.length, 1);
});
check("events: null payloads survive", () => {
	const ev = normalizeEvents({ events: [{ id: 1, at: "2026-11-25T00:00:00Z", kind: "status", status: "running", payload: null }] });
	eq(ev.length, 1);
	eq(ev[0].message, "");
	eq(normalizeEvents({ events: null }), []);
});
check("job: sources null → []; spec name and error message pulled out", () => {
	const j = normalizeJob({ job_id: "j", app: "qr", spec: { name: "join", app: "qr" }, sources: null, error: { code: "x", message: "worker died" } })!;
	eq(j.sources, []);
	eq(j.name, "join");
	eq(j.error, "worker died");
});

// ── sources: the real service shape (definition.ref, hub) ──
check("source from the service row", () => {
	const r = normalizeSources({
		sources: [
			{ source_id: "src_1", hub: "home", owner: "u1", name: "prices", kind: "table", definition: { ref: "findata://px.daily", description: "d" }, visibility: "shared", size_bytes_est: 1024 },
			{ source_id: "src_2", hub: "nus", owner: "system", name: "big", kind: "table", definition: { ref: "nus://lumilake.x" }, visibility: "public", size_bytes_est: null },
			{ source_id: "src_3", hub: "home", owner: "u2", name: "other", kind: "blob_set", definition: {}, visibility: "public" },
		],
		hubs: [{ id: "home", ok: true }, { id: "nus", ok: false, error: "timeout" }],
	});
	eq(r.sources[0].ref, "findata://px.daily");
	eq(r.sources[0].description, "d");
	eq(r.hubs[1], { id: "nus", ok: false, error: "timeout" });
	eq(groupByHub(r.sources).map((g) => [g.hub, g.sources.length]), [["home", 2], ["nus", 1]]);
});

// ── plan: the real `{plan_id, plan: {outcome, …}}` shape ──
check("placed plan", () => {
	const p = normalizePlan({
		plan_id: "p1",
		plan: {
			outcome: "placed", site: "home", runtime: "lumilake", local_bytes: 10, remote_bytes: 5,
			sources: [
				{ ref: "findata://a.b", access: "read", source_site: "home", via: "local", route_id: null, url: null, size: { kind: "exact", bytes: 10 } },
				{ ref: "lumid-data://c.d", access: "read", source_site: "office", via: "tailnet", route_id: "r", url: "http://x", size: { kind: "upper_bound", bytes: 5 } },
				{ ref: "hf://org/m", access: "read", source_site: null, via: "model", size: { kind: "unknown" } },
			],
			reasons: [{ code: "most_bytes_local", msg: "most data is here" }],
			alternatives: [{ site: "office", blocking: [{ code: "no_runtime", msg: "no lumilake there" }] }],
		},
		sources: [],
	}, "home");
	eq(p.planId, "p1");
	eq(p.placed, true);
	eq(p.site, "home");
	eq(p.owningHub, "home", "owning hub falls back to the hub the list came from");
	eq(p.sources.map((s) => [s.via, s.local, s.bytes, s.sizeKind]), [["local", true, 10, "exact"], ["tailnet", false, 5, "upper_bound"], ["model", false, null, "unknown"]]);
	eq(p.reasons[0].msg, "most data is here");
	eq(p.alternatives[0], { site: "office", blocking: [{ code: "no_runtime", msg: "no lumilake there" }] });
});
check("refused plan has no site and says why", () => {
	const p = normalizePlan({ plan_id: "p2", plan: { outcome: "refused", reasons: [{ code: "too_big", msg: "50 GB over the cap" }], alternatives: null } });
	eq(p.placed, false);
	eq(p.reasons.length, 1);
	eq(p.alternatives, []);
	eq(p.sources, []);
});
check("flat plan shape (route_kind / est_bytes / owning_hub / local) also reads", () => {
	const p = normalizePlan({ plan_id: "p3", site: "nus", owning_hub: "home", runtime: "flowmesh", sources: [{ ref: "x", hub: "nus", route_kind: "public", est_bytes: 99, local: false }, { ref: "y", local: true }], reasons: ["one"] });
	eq(p.placed, true);
	eq(p.owningHub, "home");
	eq(p.sources.map((s) => [s.via, s.bytes, s.site]), [["public", 99, "nus"], ["local", null, ""]]);
	eq(p.reasons[0].msg, "one");
});

// ── status + routes in words ──
check("job status on the run vocabulary", () => {
	eq(["planned", "submitted", "running", "succeeded", "failed", "refused", "cancelled", "weird"].map(jobRunStatus),
		["queued", "queued", "running", "succeeded", "failed", "failed", "cancelled", "skipped"]);
	eq(jobStatusLabel("planned"), "Waiting to start");
	eq(jobStatusLabel("refused"), "Couldn't be placed");
	eq(isTerminal("refused"), true);
	eq(isTerminal("planned"), false);
});
check("every route kind has plain words, never the raw code", () => {
	for (const k of ["local", "lan", "tailnet", "proxy", "egress", "public", "model", "internet"]) {
		const c = routeChip(k);
		if (!c.label || c.label === k) throw new Error(`route ${k} has no words`);
	}
	eq(routeChip("lan").label, "Local network");
	eq(routeChip("").label, "Unknown route");
});

// ── spec ↔ YAML ──
check("starter spec round-trips through YAML", () => {
	const r = specFromYaml(specToYaml(STARTER_SPEC));
	eq(r.errors, []);
	eq(r.spec?.app, STARTER_SPEC.app);
	eq(r.spec?.sources, STARTER_SPEC.sources);
});
check("bare-string sources are shorthand for {ref}", () => {
	const r = specFromYaml("app: qr\nruntime: lumilake\nsources:\n  - findata://a.b\n  - ref: src://u/x\n    max_bytes: 100\n");
	eq(r.errors, []);
	eq(r.spec?.sources, [{ ref: "findata://a.b" }, { ref: "src://u/x", max_bytes: 100 }]);
});
check("bad specs are caught before the round-trip", () => {
	eq(specFromYaml("app: [").errors[0].startsWith("Not valid YAML"), true);
	eq(specFromYaml("- a\n- b").spec, null);
	const r = validateSpec({ app: "has space", runtime: "gpu", sources: [], surprise: 1 });
	eq(r.spec, null);
	eq(r.errors.length, 4, "unknown field + app + runtime + no sources");
	eq(validateSpec({ app: "a", runtime: "auto", sources: [{ ref: "x", max_bytes: -1 }] }).errors.length, 1);
	eq(validateSpec({ app: "a", sources: "findata://x" }).errors.includes("source should be a list"), true);
});
check("runtime defaults to auto", () => eq(validateSpec({ app: "a", sources: ["x"] }).spec?.runtime, "auto"));
check("add a source to the YAML; no duplicates; broken YAML untouched", () => {
	const y = addSourceToYaml("app: qr\nruntime: auto\nsources: []\n", "src://s1");
	eq(specFromYaml(y).spec?.sources, [{ ref: "src://s1" }]);
	eq(addSourceToYaml(y, "src://s1"), y);
	eq(addSourceToYaml("app: [", "src://s1"), "app: [");
});

// ── errors in words ──
check("API error envelope parsed; HTML pages not pasted", () => {
	eq(parseApiError('{"error":{"code":"plan_not_found","message":"no such plan"}}'), { code: "plan_not_found", message: "no such plan" });
	eq(parseApiError("<html><body>502</body></html>").message, "");
	eq(jobsErrorWords(404, "plan_not_found", "x").includes("expired"), true);
	eq(jobsErrorWords(404, "", ""), "Jobs aren't switched on for lum.id/data yet.");
	eq(jobsErrorWords(400, "invalid_spec", "app must be [A-Za-z0-9._-], 1..=64"), "app must be [A-Za-z0-9._-], 1..=64");
	eq(jobsErrorWords(400, "weird_code", "weird_code"), "The request failed (HTTP 400).", "a bare code never reaches the screen");
	eq(jobsErrorWords(503, "", ""), "lum.id/data is having trouble (HTTP 503). Try again in a moment.");
});
check("Activity notice only when the jobs source actually failed", () => {
	eq(jobsSourceNotice("ok"), null);
	eq(jobsSourceNotice("off"), null);
	eq(jobsSourceNotice("unconfigured"), null);
	eq(jobsSourceNotice(undefined), null);
	eq(typeof jobsSourceNotice("timeout"), "string");
	eq(typeof jobsSourceNotice("unauthenticated"), "string");
});
check("job link", () => eq(jobHref("a b"), "/studio/data-warehouse?tab=jobs&job=a%20b"));

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
