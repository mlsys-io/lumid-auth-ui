// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { parse } from "yaml";
import {
	addModule, blankModuleForm, checkModule, clampNoteWords, clampLimits, digestCommand, entryFromForm, estimateWords, formFromEntry, formProblems,
	imageParts, inputGuess, inputLabel, inputTemplate, limitsPreview, limitsWords, moduleIdFrom, moduleRows, moduleUses,
	parseMemoryMi, parseTryInputs, plainModuleWords, publicModuleRows, publicStatusWords, removeBlocker, removeModule,
	runModuleOnce, saveErrorText, shareWords, specModulesProblem, stepModuleRef, tryPhase, updateModule, addModuleWorkflow, workflowIdFrom,
	type MeasureReply, type ModuleListItem, type TryPhase,
} from "./modules";

type Check = { name: string; run: () => void | Promise<void> };
const checks: Check[] = [];
const check = (name: string, run: () => void | Promise<void>) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }
function throws(fn: () => unknown, re: RegExp) {
	try { fn(); } catch (e) { if (re.test(String((e as Error).message))) return; throw new Error(`wrong error: ${(e as Error).message}`); }
	throw new Error("expected an error");
}

const IMG = "ghcr.io/acme/prompt-mod@sha256:" + "4".repeat(64);
const y = (s: string) => parse(s) as Record<string, unknown>;

// The spec identity's own tests use (me_measure_module_test.go), plus a comment.
const SPEC = `name: trace-lab
# Small compute this app registers centrally.
modules:
- id: prompt_stats   # the histogram
  title: Prompt length statistics
  about: Token-length histogram of a request trace.
  image: ${IMG}
  run: python -m mymod.job
  inputs: {trace: "rows of {prompt_tokens}", bins: "number of bins (default 10)"}
  limits: {cpu: 8, memory: 16Gi, timeout_s: 3600}
  share: everyone
- id: private_one
  image: ${IMG}
  run: python -m mymod.other
- id: tagged
  image: ghcr.io/acme/prompt-mod:latest
  run: python -m mymod.job
workflows:
- id: stats
  title: Prompt stats
  steps: {module: prompt_stats, inputs: {bins: 10}}
  inputs: {trace: "[]"}
`;

// ── identity's rules, in its words ────────────────────────────────────────

check("limits clamp to the platform's ceilings and say so (identity parity)", () => {
	const c = clampLimits({ cpu: 8, memory: "16Gi", timeout_s: 3600 });
	eq(c.limits, { cpu: 2, memoryMi: 4096, timeoutS: 600 });
	eq(c.notes, ["asked for 8 CPUs; a module gets at most 2", "asked for 16Gi memory; a module gets at most 4Gi", "asked for 3600 s; a module runs at most 600 s"]);
	eq(clampLimits({ cpu: 0.5, memory: "512Mi" }).limits, { cpu: 1, memoryMi: 512, timeoutS: 120 }, "defaults + round up");
	eq(clampLimits({ memory: "10Mi" }).limits.memoryMi, 64, "raised to the floor");
	eq(clampLimits({}).limits, { cpu: 1, memoryMi: 1024, timeoutS: 120 });
});

check("memory reads binary units or bytes, like identity", () => {
	eq(parseMemoryMi("2Gi").mi, 2048); eq(parseMemoryMi("1G").mi, 1024); eq(parseMemoryMi(" 512 MiB ").mi, 512);
	eq(parseMemoryMi(2048).mi, 1, "a bare number is bytes, rounded up");
	eq(parseMemoryMi("lots").problem, 'limits.memory "lots" is not a size (write e.g. 512Mi or 2Gi)');
	eq(parseMemoryMi(true).problem, "limits.memory must be a size like 2Gi");
	eq(parseMemoryMi("0Mi").problem, "limits.memory must be more than zero");
});

check("every refusal identity's tests pin is refused here, in its words", () => {
	const base = `id: a\nimage: ${IMG}\nrun: x\n`;
	const cases: Array<[string, string]> = [
		["id: a\nimage: ghcr.io/acme/x:v1\nrun: x", 'module a: image "ghcr.io/acme/x:v1" is not pinned by digest; write it as <repo>@sha256:<64 hex> (a tag can change under everyone who reuses its results)'],
		["id: a\nimage: ghcr.io/acme/x@sha256:abcd\nrun: x", "is not pinned by digest"],
		["id: a\nrun: x", "module a: image is required, pinned by digest (…@sha256:<64 hex>)"],
		[`id: a\nimage: ${IMG}`, "module a: run is required (the command that reads ONE JSON object on stdin and writes ONE on stdout)"],
		[`id: A B\nimage: ${IMG}\nrun: x`, 'module "A B": id must be a short slug (lowercase letters, digits, _ or -)'],
		[base + "limits: {gpu: 1}", "module a: limits.gpu is not a module limit (cpu, memory, timeout_s; modules never get a GPU)"],
		[base + "limits: {memory: lots}", 'module a: limits.memory "lots" is not a size (write e.g. 512Mi or 2Gi)'],
		[base + "limits: {cpu: -1}", "module a: limits.cpu must be a positive number of cores"],
		[base + "limits: {timeout_s: '60'}", "module a: limits.timeout_s must be a positive number of seconds"],
		[base + "share: world", 'module a: share is everyone or you, not "world"'],
		[base + 'public: "yes"', "module a: public is true or false"],
		[base + "inputs: [a, b]", "module a: inputs is a mapping of input name to words"],
		[base + "limits: 2", "module a: limits is a mapping {cpu, memory, timeout_s}"],
		[`id: a\nimage: ${IMG}\nrun: "${"x".repeat(513)}"`, "module a: run must be one command line of at most 512 characters"],
	];
	for (const [src, want] of cases) {
		const p = checkModule(y(src)).problem ?? "";
		ok(p.includes(want), `${src.split("\n").pop()}: got ${p || "(accepted)"}`);
	}
	const good = checkModule(y(base + "share: everyone\npublic: true\ninputs: {trace: rows}"));
	eq([good.module?.share, good.module?.public, good.module?.inputs], ["everyone", true, { trace: "rows" }]);
	eq(checkModule(y(base)).module?.share, "you", "share defaults to you");
});

check("the save-time check covers ids, duplicates and workflow steps", () => {
	eq(specModulesProblem(SPEC), 'module tagged: image "ghcr.io/acme/prompt-mod:latest" is not pinned by digest; write it as <repo>@sha256:<64 hex> (a tag can change under everyone who reuses its results)');
	const fixed = SPEC.replace("image: ghcr.io/acme/prompt-mod:latest", `image: ${IMG}`);
	eq(specModulesProblem(fixed), null);
	eq(specModulesProblem(fixed + "- id: x\n  steps: {module: nope}\n"), 'workflow "x": steps.module "nope" is not a module of this app');
	eq(specModulesProblem(fixed + "- id: x\n  steps: {module: someone/app.id}\n"), null, "owner-qualified resolves at run time");
	eq(specModulesProblem(fixed + "- id: x\n  steps: {module: private_one, python: run}\n"), 'workflow "x": steps.module cannot be combined with steps.python');
	eq(specModulesProblem(fixed.replace("- id: tagged", "- id: private_one")), "module private_one is declared twice");
	eq(specModulesProblem("modules: {a: 1}"), "modules must be a list");
	eq(specModulesProblem("modules: [3]"), "modules[0] must be a mapping");
});

check("identity's key names never reach the screen", () => {
	eq(plainModuleWords("module a: limits.cpu must be a positive number of cores"), "The CPU limit must be a positive number of cores");
	eq(plainModuleWords("module a: limits.gpu is not a module limit (cpu, memory, timeout_s; modules never get a GPU)"), '"gpu" is not a module limit (CPU, memory and time limit; modules never get a GPU)');
	eq(plainModuleWords('workflow "x": steps.module "nope" is not a module of this app'), 'Workflow "x": its module step "nope" is not a module of this app');
	ok(!/_s\b|steps\.|limits\./.test(plainModuleWords("module a: limits.timeout_s must be a positive number of seconds")), "no raw key");
});

// ── words ────────────────────────────────────────────────────────────────

check("limits, share and public read as plain words", () => {
	eq(limitsWords({ cpu: 1, memoryMi: 2048, timeoutS: 120 }), "1 CPU · 2 GiB · stops after 2 min");
	eq(limitsWords({ cpu: 2, memoryMi: 512, timeoutS: 45 }), "2 CPUs · 512 MiB · stops after 45 s");
	eq(limitsWords({ cpu: 1, memoryMi: 1536, timeoutS: 90 }), "1 CPU · 1.5 GiB · stops after 1.5 min");
	ok(/everyone/.test(shareWords("global")) && /everyone/.test(shareWords("everyone")), "everyone");
	ok(/only by whoever/.test(shareWords("tenant")) && /only by whoever/.test(shareWords("you")), "you");
	eq(inputLabel("short_max_tokens"), "Short max tokens");
	eq(clampNoteWords("asked for 8 CPUs; a module gets at most 2"), "It asks for 8 CPUs; a module gets at most 2.");
	eq(clampNoteWords("a module gets at least 64 MiB"), "A module gets at least 64 MiB.");
	eq(imageParts(IMG), { repo: "ghcr.io/acme/prompt-mod", digest: "444444444444" });
	eq(digestCommand("ghcr.io/acme/x:v1"), "docker buildx imagetools inspect ghcr.io/acme/x:v1");
	eq(digestCommand("ghcr.io/acme/x"), "docker buildx imagetools inspect ghcr.io/acme/x:latest");
	eq(digestCommand(IMG), "docker buildx imagetools inspect <image>:<tag>");
	eq(estimateWords({ from_runs: 4, cpu_s: 5.771 }), "Usually about 6 CPU-s a run (from 4 runs)");
	eq(estimateWords({ from_runs: 0 }), null);
	eq(moduleIdFrom("Trace statistics", []), "trace_statistics");
	eq(moduleIdFrom("2x speed", []), "m_2x_speed");
	eq(moduleIdFrom("Trace statistics", ["trace_statistics"]), "trace_statistics_2");
	eq(workflowIdFrom("Prompt stats", ["stats"]), "prompt_stats");
	eq(workflowIdFrom("9.2 stats", []), "w_9_2_stats");
});

// ── rows from the spec + listing ───────────────────────────────────────────

const LISTING: ModuleListItem[] = [
	{ name: "trace-lab.prompt_stats", kind: "module", title: "Prompt length statistics", share: "global", public: false, image: IMG, limits: { cpu: 2, memory: "4096Mi", timeout_s: 600 }, estimate: { from_runs: 2, cpu_s: 30 } },
	{ name: "trace-lab.tagged", kind: "module", refused: 'module tagged: image "ghcr.io/acme/prompt-mod:latest" is not pinned by digest; write it as <repo>@sha256:<64 hex> (a tag can change under everyone who reuses its results)' },
	{ name: "mlsys-simulator", kind: "instrument" },
	{ name: "u-9/other-app.clean", kind: "module", public: true, owner: "u-9", app: "other-app", app_title: "Other app", title: "Clean rows", limits: { cpu: 1, memory: "512Mi", timeout_s: 60 }, share: "tenant", inputs: { rows: "rows" } },
];

check("rows: every spec entry, checked, with the listing's words", () => {
	const rows = moduleRows("trace-lab", SPEC, LISTING);
	eq(rows.map((r) => r.id), ["prompt_stats", "private_one", "tagged"]);
	const a = rows[0];
	eq([a.limitsText, a.share, a.public, a.digest], ["2 CPUs · 4 GiB · stops after 10 min", "everyone", false, "444444444444"]);
	eq(a.notes.length, 3);
	eq(a.usedBy.map((u) => u.title), ["Prompt stats"]);
	eq(a.estimate, "Usually about 30 CPU-s a run (from 2 runs)");
	eq(a.inputs.map((i) => i.label), ["Trace", "Bins"]);
	ok(!rows[1].refused && rows[1].title === "private_one", "a module without a title shows its id");
	ok(/^Image "ghcr.io\/acme\/prompt-mod:latest" is not pinned/.test(rows[2].refused ?? ""), `refused: ${rows[2].refused}`);
	eq(moduleRows("trace-lab", SPEC, null)[2].refused, rows[2].refused, "the client check says what identity says");
	eq(moduleRows("trace-lab", "", LISTING).map((r) => r.id), ["prompt_stats", "tagged"], "listing-only when the spec can't be read");
	eq(moduleRows("trace-lab", removeModule(SPEC, { id: "tagged", index: 2 }), LISTING).map((r) => r.id), ["prompt_stats", "private_one"], "a removed module doesn't linger from the listing");
});

check("public rows: other owners only, owner-qualified", () => {
	const p = publicModuleRows(LISTING);
	eq(p.map((r) => [r.name, r.by, r.owner, r.limitsText]), [["u-9/other-app.clean", "Other app", "u-9", "1 CPU · 512 MiB · stops after 1 min"]]);
	eq(stepModuleRef("trace-lab", "trace-lab.prompt_stats"), "prompt_stats");
	eq(stepModuleRef("trace-lab", "u-9/other-app.clean"), "u-9/other-app.clean");
	eq(stepModuleRef("trace-lab", "u-9/trace-lab.x"), "u-9/trace-lab.x", "someone else's app of the same name stays qualified");
});

check("the public list's staleness is said, only when it matters", () => {
	eq(publicStatusWords({ count: 3, built_at: "x", age_s: 20 }), null);
	eq(publicStatusWords({ stale: true, built_at: "x", age_s: 7200, refresh_error: "xp.io 502" }), "Couldn't refresh the list of public modules just now, so this is the list from 2 h ago.");
	ok(/Couldn't load/.test(publicStatusWords({ stale: true, refresh_error: "x" }) ?? ""), "never built");
	ok(/still being gathered/.test(publicStatusWords({ note: "being built" }) ?? ""), "building");
});

// ── the form ─────────────────────────────────────────────────────────────

check("form ⇄ entry round-trips, and problems land on their field", () => {
	const f = formFromEntry(y(`id: a\ntitle: A\nimage: ${IMG}\nrun: python -m a\ninputs: {x: words}\nlimits: {cpu: 1, memory: 2Gi, timeout_s: 120}\nshare: everyone\npublic: true`));
	eq([f.memory, f.memoryUnit, f.cpu, f.timeout, f.share, f.public], ["2", "Gi", "1", "120", "everyone", true]);
	eq(entryFromForm(f), { id: "a", title: "A", image: IMG, run: "python -m a", inputs: { x: "words" }, limits: { cpu: 1, memory: "2Gi", timeout_s: 120 }, share: "everyone", public: true });
	eq(formFromEntry(y("id: a\nlimits: {memory: 1536Mi}")).memoryUnit, "Mi");
	eq(formProblems(f, []), []);
	eq(formProblems(f, ["a"])[0].field, "id");
	const bad = { ...f, image: "ghcr.io/acme/x:v1" };
	eq(formProblems(bad, [])[0].field, "image");
	ok(/not pinned by digest/.test(formProblems(bad, [])[0].words), "identity's words");
	eq(formProblems({ ...f, cpu: "-1" }, [])[0], { field: "limits", words: "The CPU limit must be a positive number of cores" });
	eq(formProblems({ ...f, inputs: [{ name: "x", words: "" }, { name: "x", words: "" }] }, [])[0].field, "inputs");
});

check("the clamp shows while typing", () => {
	eq(limitsPreview({ cpu: "1", memory: "2", memoryUnit: "Gi", timeout: "120" }), { words: "1 CPU · 2 GiB · stops after 2 min", notes: [] });
	const big = limitsPreview({ cpu: "4", memory: "8", memoryUnit: "Gi", timeout: "900" });
	eq(big.words, "2 CPUs · 4 GiB · stops after 10 min");
	eq(big.notes, ["Asked for 4 CPUs; a module gets at most 2", "Asked for 8Gi memory; a module gets at most 4Gi", "Asked for 900 s; a module runs at most 600 s"]);
	eq(big.notes.map(clampNoteWords)[0], "It asks for 4 CPUs; a module gets at most 2.");
	eq(limitsPreview({ cpu: "0.5", memory: "32", memoryUnit: "Mi", timeout: "" }).notes, ["a part of a CPU counts as a whole one: 1", "a module gets at least 64 MiB"]);
	eq(limitsPreview({ cpu: "lots", memory: "1", memoryUnit: "Gi", timeout: "60" }).problem, "The CPU limit must be a positive number of cores");
	eq(limitsPreview({ ...blankModuleForm() }).words, "1 CPU · 1 GiB · stops after 2 min", "the blank form is identity's defaults");
});

// ── spec edits ───────────────────────────────────────────────────────────

const FIXED = SPEC.replace("image: ghcr.io/acme/prompt-mod:latest", `image: ${IMG}`);

check("add keeps comments and refuses what identity would", () => {
	const next = addModule(FIXED, entryFromForm({ ...blankModuleForm(), id: "new_one", title: "New one", image: IMG, run: "python -m n" }));
	ok(next.includes("# Small compute this app registers centrally.") && next.includes("# the histogram"), "comments kept");
	eq(parse(next).modules.at(-1), { id: "new_one", title: "New one", image: IMG, run: "python -m n", limits: { cpu: 1, memory: "1Gi", timeout_s: 120 }, share: "you", public: false });
	throws(() => addModule(FIXED, { id: "private_one", image: IMG, run: "x" }), /already a module called "private_one"/);
	throws(() => addModule(FIXED, { id: "z", image: "ghcr.io/a/b:v1", run: "x" }), /not pinned by digest/);
	const first = addModule("name: x\n", { id: "m", image: IMG, run: "x" });
	eq(parse(first).modules, [{ id: "m", image: IMG, run: "x" }], "the first module creates the list");
});

check("update edits in place: comments, order and untouched keys survive", () => {
	const f = formFromEntry(parse(FIXED).modules[0]);
	const next = updateModule(FIXED, { id: "prompt_stats", index: 0 }, entryFromForm({ ...f, about: "Changed.", cpu: "2" }));
	ok(/- id: prompt_stats\s+# the histogram/.test(next), "the id's comment survives");
	const m = parse(next).modules[0];
	eq([m.about, m.limits, Object.keys(m)], ["Changed.", { cpu: 2, memory: "16Gi", timeout_s: 3600 }, ["id", "title", "about", "image", "run", "inputs", "limits", "share", "public"]]);
	ok(next.includes("limits: { cpu: 2, memory: 16Gi, timeout_s: 3600 }") || next.includes("limits: {cpu: 2, memory: 16Gi, timeout_s: 3600}"), "limits stay a flow map, edited in place");
	const cleared = updateModule(FIXED, { id: "prompt_stats", index: 0 }, entryFromForm({ ...f, about: "", inputs: [] }));
	ok(!("about" in parse(cleared).modules[0]) && !("inputs" in parse(cleared).modules[0]), "emptied keys are removed");
	throws(() => updateModule(FIXED, { id: "prompt_stats", index: 0 }, entryFromForm({ ...f, id: "renamed" })), /Can't change the id from "prompt_stats": the workflow "Prompt stats" still uses it/);
	const renamed = updateModule(FIXED, { id: "private_one", index: 1 }, { ...entryFromForm(formFromEntry(parse(FIXED).modules[1])), id: "priv" });
	eq(parse(renamed).modules[1].id, "priv", "an unused module can be renamed");
	throws(() => updateModule(FIXED, { id: "gone", index: 9 }, { id: "gone", image: IMG, run: "x" }), /no module "gone"/);
	throws(() => updateModule(FIXED, { id: "private_one", index: 1 }, { id: "private_one", image: IMG, run: "x", limits: { cpu: "two" } }), /The CPU limit must be a positive number/);
});

check("remove is refused while a workflow uses it, naming the workflow", () => {
	throws(() => removeModule(FIXED, { id: "prompt_stats", index: 0 }), /^Can't remove "Prompt length statistics": the workflow "Prompt stats" still uses it/);
	ok(/the workflow "Prompt stats"/.test(removeBlocker(FIXED, "prompt_stats") ?? ""), "blocker named");
	eq(removeBlocker(FIXED, "private_one"), null);
	const next = removeModule(FIXED, { id: "private_one", index: 1 });
	eq(parse(next).modules.map((m: { id: string }) => m.id), ["prompt_stats", "tagged"]);
	const none = removeModule("name: x\nmodules:\n- id: m\n  image: " + IMG + "\n  run: x\n", { id: "m", index: 0 });
	ok(!("modules" in (parse(none) ?? {})), "the last one removes the list");
	const two = "name: x\nmodules:\n- id: m\n  image: " + IMG + "\n  run: x\nworkflows:\n- id: a\n  title: A\n  steps: {module: m}\n- id: b\n  steps: {module: m}\n";
	throws(() => removeModule(two, { id: "m", index: 0 }), /the workflows "A", "b" still use it\. Remove those workflows or change their step first/);
});

check("use in a workflow: run manual, steps {module, inputs}, checked", () => {
	const next = addModuleWorkflow(FIXED, { id: "hist", title: "Histogram", module: "prompt_stats", inputs: { bins: 20 } });
	const w = parse(next).workflows.at(-1);
	eq(w, { id: "hist", title: "Histogram", run: "manual", steps: { module: "prompt_stats", inputs: { bins: 20 } } });
	eq(moduleUses(next).filter((u) => u.module === "prompt_stats").map((u) => u.workflow), ["stats", "hist"]);
	eq(parse(addModuleWorkflow(FIXED, { id: "h2", title: "", module: "u-9/other-app.clean", inputs: {} })).workflows.at(-1), { id: "h2", run: "manual", steps: { module: "u-9/other-app.clean" } });
	throws(() => addModuleWorkflow(FIXED, { id: "stats", title: "x", module: "prompt_stats" }), /already a workflow called "stats"/);
	throws(() => addModuleWorkflow(FIXED, { id: "h3", title: "x", module: "nope" }), /its module step "nope" is not a module of this app/);
});

check("a save is refused while another module can't run, and that module is named", () => {
	throws(() => addModuleWorkflow(SPEC, { id: "h4", title: "x", module: "prompt_stats" }), /^Module tagged can't run: image "ghcr.io\/acme\/prompt-mod:latest" is not pinned by digest.*lum\.id won't save this app's spec until that module is fixed or removed\.$/);
	const fixedTagged = updateModule(SPEC, { id: "tagged", index: 2 }, { id: "tagged", image: IMG, run: "python -m mymod.job" });
	eq(specModulesProblem(fixedTagged), null, "fixing the refused one is allowed");
	throws(() => updateModule(SPEC, { id: "tagged", index: 2 }, { id: "tagged", image: "x:y", run: "r" }), /^Image "x:y" is not pinned/);
	eq(parse(removeModule(SPEC, { id: "tagged", index: 2 })).modules.length, 2, "removing the refused one is allowed");
});

// ── Try it once ──────────────────────────────────────────────────────────

check("the input template guesses from the words", () => {
	eq(inputGuess("rows of {input_tokens, output_tokens_target} (a trace's requests)"), []);
	eq(inputGuess("prompts at or under this many tokens count as short (default 1024)"), 1024);
	eq(inputGuess("number of histogram bins"), 0);
	eq(inputGuess("whether to drop empty rows"), false);
	eq(inputGuess("a label"), "");
	eq(inputTemplate({ trace: "rows of {x}", bins: "number of bins (default 10)" }), '{\n  "trace": [],\n  "bins": 10\n}');
	eq(inputTemplate(undefined), "{}");
});

check("Try-it inputs: one JSON object, at most 256 KiB, gaps noted", () => {
	ok(/isn't JSON yet/.test(parseTryInputs("{trace:", {}).problem ?? ""), "not JSON");
	eq(parseTryInputs("[1]").problem, "The inputs must be ONE JSON object ({ … }), not a list.");
	eq(parseTryInputs("").problem, "Write the inputs as one JSON object — {} when it takes none.");
	ok(/256 KiB/.test(parseTryInputs(JSON.stringify({ x: "y".repeat(300_000) })).problem ?? ""), "size");
	const r = parseTryInputs('{"trace": [], "extra": 1}', { trace: "rows", short_max_tokens: "n" });
	eq(r.value, { trace: [], extra: 1 });
	eq(r.notes, ["Not given: Short max tokens — the module may use its own default.", "Not an input it declares: extra (sent anyway)."]);
});

check("a measure reply in words: waiting, running, reused, failed, not run", () => {
	eq(tryPhase({ status: "waiting", reason: "4 of your measurements are already running (limit 4)", retry_after: 30 }, 1).phase, "waiting");
	ok(/Waiting for a free slot: 4 of your/.test((tryPhase({ status: "waiting", reason: "4 of your measurements are already running (limit 4)", retry_after: 30 }, 1) as { words: string }).words), "reason said");
	eq((tryPhase({ status: "running", key: "k", retry_after: 5 }, 14, 120) as { words: string }).words, "Running… 14 s so far (it stops after 2 min).");
	const done = tryPhase({ status: "succeeded", key: "k", result: { value: { p50: 3 }, reused: false, usage: { cpu_s: 6, cost_usd: 0.00003, metered: "measured" } } }, 20) as Extract<TryPhase, { phase: "done" }>;
	eq([done.reused, done.usage, done.tookWords], [false, "6 CPU-s · <$0.01 notional", "Took 20 s."]);
	const reused = tryPhase({ status: "succeeded", result: { value: {}, reused: true, usage: { cpu_s: 0, saved_cpu_s: 6, metered: "reused" } } }, 0.3) as Extract<TryPhase, { phase: "done" }>;
	eq([reused.usage, reused.tookWords], ["Free — reused (saved 6 CPU-s)", "Answered in 1 s from an identical earlier run."]);
	eq(tryPhase({ status: "failed", error: "the module did not finish within its limit of 60 s" }, 70), { phase: "failed", words: "the module did not finish within its limit of 60 s" });
	eq(tryPhase({ status: "not_measured", reason: "this app's compute budget is used up.", budget: true }, 1), { phase: "not_run", words: "It didn't run: this app's compute budget is used up." });
});

/** A fake lum.id: answers in order; records what was asked. */
function fake(replies: Array<MeasureReply | Error>) {
	const asked: string[] = [];
	let t = 0;
	return {
		asked,
		client: {
			measure: async () => { asked.push("POST"); const r = replies.shift()!; if (r instanceof Error) throw r; return r; },
			get: async (key: string) => { asked.push(`GET ${key}`); const r = replies.shift()!; if (r instanceof Error) throw r; return r; },
			sleep: async (ms: number) => { t += ms; },
			now: () => t,
		},
	};
}

check("the poll: POST, follow the key, re-ask after waiting", async () => {
	const f = fake([
		{ status: "waiting", retry_after: 30 },
		{ status: "running", key: "abc", retry_after: 5 },
		{ status: "running", key: "abc", retry_after: 5 },
		{ status: "succeeded", key: "abc", result: { value: { n: 3 }, usage: { cpu_s: 2, metered: "measured" } } },
	]);
	const seen: string[] = [];
	const end = await runModuleOnce(f.client, { instrument: "a.m", app: "a", inputs: {} }, (p) => seen.push(p.phase), { timeoutS: 60 });
	eq(f.asked, ["POST", "POST", "GET abc", "GET abc"]);
	eq(seen, ["waiting", "running", "running", "done"]);
	eq(end.phase, "done");
});

check("the poll stops following after the module's limit, and says the result is kept", async () => {
	const f = fake(Array.from({ length: 80 }, () => ({ status: "running", key: "k", retry_after: 5 })));
	const end = await runModuleOnce(f.client, { instrument: "a.m", app: "a", inputs: {} }, () => {}, { timeoutS: 60 });
	eq(end.phase, "slow");
	ok(/press Run again with the same inputs/.test((end as { words: string }).words), "kept");
	ok(f.asked.length < 60, `asked ${f.asked.length} times`);
});

check("a refusal comes back in identity's words", async () => {
	const err = Object.assign(new Error("module a.m is not visible to the b app: only a may call it (its author can set public: true)"), { status: 403 });
	const end = await runModuleOnce(fake([err]).client, { instrument: "a.m", app: "b", inputs: {} }, () => {});
	eq(end, { phase: "failed", words: "Module a.m is not visible to the b app: only a may call it (its author can set public: true)" });
	const limited = await runModuleOnce(fake([Object.assign(new Error("too many requests"), { status: 429 })]).client, { instrument: "a.m", app: "a", inputs: {} }, () => {});
	eq((limited as { words: string }).words, "Too many requests to lum.id just now — try again in a minute.");
});

check("a save refusal from lum.id is kept verbatim; a local one is already words", () => {
	const server = Object.assign(new Error('module a: limits.cpu must be a positive number of cores'), { status: 400, ret_code: 1400 });
	eq(saveErrorText(server), { words: "module a: limits.cpu must be a positive number of cores", verbatim: true });
	eq(saveErrorText(new Error("Can't remove \"A\": the workflow \"B\" still uses it.")).verbatim, false);
	eq(saveErrorText(Object.assign(new Error("conflict"), { status: 409 })), { words: "The spec changed — try again.", verbatim: false });
});

export async function runAsync(): Promise<number> {
	let failed = 0;
	for (const c of checks) {
		try { await c.run(); } catch (e) { failed++; console.error(`  ✗ modules: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
