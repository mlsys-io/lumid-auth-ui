// app-spec — read and edit an app's spec (.xpcloud.yaml) for the workflow graph.
//
// Research apps are written in ONE simple scheme (LumidOS sdk/apps/spec_v2.py,
// 2026-11-25): workflows with steps / inputs / feedback, a variant names its
// `parent`, user-made child `nodes`, experiments as versions of one workflow.
// Older apps still say loops / schedule / engine; `readAppSpec` reads both into
// one shape so the graph never cares which an app uses.
//
// Edits go through the `yaml` Document API, so the author's comments and key
// order survive — the same file is what the scheduler runs. Every edit is a
// pure text → text function; the caller saves it with base_sha (409 = reload).

import { parse, parseDocument, isMap, isSeq, stringify, type Document, YAMLMap, YAMLSeq } from "yaml";

export interface FeedbackMetric { name: string; better: "higher" | "lower"; target?: number }
/**
 * `service`: the instrument that measures this step (identity's /me/measure registry).
 * `gate`: the step's pass rule, an expression over its metrics ("score >= 0.5 and n >= 30",
 * the evaluator `done_when` uses). A version that fails it stops at this step; no gate =
 * the step only measures. The runtime reads it as `engine.gates` (spec_v2).
 */
export interface FeedbackStep { step: string; metrics: FeedbackMetric[]; service?: string; gate?: string }

export interface SpecWorkflow {
	id: string;
	title?: string;
	about?: string;
	/** The workflow this one is a variant of. */
	parent?: string;
	/** The child node it sits in on the graph. */
	node?: string;
	/** Housekeeping: folds into its parent on the graph. */
	helper: boolean;
	/** "manual" or a cron. */
	run: string;
	/** `workflows`: a chain of other workflows, run in order (see ChainStage). */
	steps: { python?: string; dag?: string; skills?: string[]; workflows?: ChainStage[] };
	inputs: Record<string, unknown>;
	data: string[];
	compute: { site?: string; gpu?: string };
	feedback: FeedbackStep[];
	/** The primary metric when no feedback steps are declared (older apps). */
	primary?: string;
	notes?: string;
	/** True when the entry is in the older `loops:` form. */
	legacy: boolean;
}

export interface SpecNode { id: string; title: string; parent: string }

/**
 * One stage of a chain (`steps.workflows`): another workflow of the same app,
 * by id, or `{use, inputs}` to run it with some inputs changed. The stages run
 * in order, each passing its results on; the chain stops at the first that fails.
 */
export type ChainStage = string | { use: string; inputs?: Record<string, unknown> };

/** A chain's stages in one shape: `{use, inputs}` (inputs = only the changed ones). */
export function chainStages(steps: { workflows?: ChainStage[] }): Array<{ use: string; inputs: Record<string, unknown> }> {
	return (steps.workflows ?? []).map((st) => (typeof st === "string" ? { use: st, inputs: {} } : { use: st.use, inputs: st.inputs ?? {} }));
}

export interface AppSpec {
	title?: string;
	workflows: SpecWorkflow[];
	nodes: SpecNode[];
	compute: { site?: string; gpu?: string };
	data: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (v == null ? "" : String(v));

function feedbackOf(v: unknown): FeedbackStep[] {
	return list(v).map((st) => {
		const o = obj(st);
		return {
			step: s(o.step),
			metrics: list(o.metrics).map((m) => {
				const mo = obj(m);
				const t = Number(mo.target);
				return { name: s(mo.name), better: s(mo.better).toLowerCase() === "lower" ? "lower" : "higher", ...(mo.target != null && Number.isFinite(t) ? { target: t } : {}) } as FeedbackMetric;
			}).filter((m) => m.name),
			...(s(o.service).trim() ? { service: s(o.service).trim() } : {}),
			...(typeof o.gate === "string" && o.gate.trim() ? { gate: o.gate.trim() } : {}),
		};
	}).filter((st) => st.step);
}

const metricsOut = (f: FeedbackStep) => f.metrics.map((m) => ({ name: m.name, better: m.better, ...(m.target != null ? { target: m.target } : {}) }));
/** One feedback step as written to the spec. */
const feedbackOut = (f: FeedbackStep): Obj => ({
	step: f.step,
	...(f.service ? { service: f.service } : {}),
	metrics: metricsOut(f),
	...(f.gate?.trim() ? { gate: f.gate.trim() } : {}),
});

/** `steps.workflows` as written: ids, or `{use, inputs}`. Entries without a workflow are dropped. */
function chainOf(v: unknown): ChainStage[] {
	return list(v).flatMap((st): ChainStage[] => {
		if (typeof st === "string") return st.trim() ? [st.trim()] : [];
		const o = obj(st);
		const use = s(o.use || o.workflow).trim();
		if (!use) return [];
		const inputs = obj(o.inputs);
		return [Object.keys(inputs).length ? { use, inputs } : { use }];
	});
}

function workflowOf(w: Obj, legacy: boolean): SpecWorkflow {
	const eng = obj(w.engine);
	const steps = obj(w.steps);
	const run = legacy ? s(w.schedule) : s(w.run);
	const compute = { ...obj(w.compute) } as { site?: string; gpu?: string };
	if (legacy) {
		if (eng.site) compute.site = s(eng.site);
		const hw = obj(eng.hardware);
		if (hw.gpu_memory) compute.gpu = s(hw.gpu_memory);
	}
	return {
		id: s(legacy ? w.name : w.id || w.name),
		title: s(w.title || w.display_name) || undefined,
		about: s(w.about) || (legacy ? s(w.description).split("\n")[0] : "") || undefined,
		parent: s(w.parent) || undefined,
		node: s(w.node) || undefined,
		helper: w.helper === true || s(w.role) === "helper" || s(w.scope) === "operator",
		run: !run || run === "@trigger" || run === "manual" ? "manual" : run,
		steps: legacy
			? eng.type === "command" ? { python: s(eng.module) } : eng.type === "lumilake" || eng.type === "flowmesh" ? { dag: s(eng.workflow) } : list(w.skills).length ? { skills: list(w.skills).map(s) } : {}
			: { ...(steps.python ? { python: s(steps.python) } : {}), ...(steps.dag ? { dag: s(steps.dag) } : {}), ...(list(steps.skills).length ? { skills: list(steps.skills).map(s) } : {}), ...(chainOf(steps.workflows).length ? { workflows: chainOf(steps.workflows) } : {}) },
		inputs: obj(w.inputs),
		data: list(w.data ?? w.datasets).map(s).filter(Boolean),
		compute,
		feedback: feedbackOf(w.feedback),
		primary: s(obj(w.metrics).primary) || undefined,
		notes: s(w.notes) || undefined,
		legacy,
	};
}

/** The spec in one shape, whichever scheme it is written in. Never throws. */
export function readAppSpec(text: string): AppSpec {
	let d: Obj = {};
	try {
		d = obj(parseDocument(text || "").toJS());
	} catch {
		d = {};
	}
	const wfs: SpecWorkflow[] = [];
	const seen = new Set<string>();
	const add = (w: SpecWorkflow) => { if (w.id && !seen.has(w.id)) { seen.add(w.id); wfs.push(w); } };
	// An entry is the older form when it names itself `name` and not `id`.
	for (const w of [...list(d.loops), ...list(d.workflows)]) {
		const o = obj(w);
		add(workflowOf(o, "name" in o && !("id" in o)));
	}
	return {
		title: s(d.title || d.display_name) || undefined,
		workflows: wfs,
		nodes: list(d.nodes).map((n) => ({ id: s(obj(n).id), title: s(obj(n).title || obj(n).id), parent: s(obj(n).parent) })).filter((n) => n.id),
		compute: { ...obj(d.compute) } as { site?: string; gpu?: string },
		data: list(d.data ?? d.datasets).map((x) => (typeof x === "string" ? x : s(obj(x).id))).filter(Boolean),
	};
}

/** A node id from a title: lower snake case, unique among `taken`. */
export function nodeIdFrom(title: string, taken: Iterable<string>): string {
	const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "node";
	const used = new Set(taken);
	let id = base, i = 2;
	while (used.has(id)) id = `${base}_${i++}`;
	return id;
}

// ── edits (text → text, comments kept) ───────────────────────────────────

function doc(text: string): Document.Parsed {
	const d = parseDocument(text || "");
	if (d.errors.length) throw new Error(`The app's spec doesn't parse: ${d.errors[0].message}`);
	if (!isMap(d.contents)) throw new Error("The app's spec is not a mapping");
	return d;
}

function seqAt(d: Document.Parsed, key: string): YAMLSeq {
	const cur = d.get(key, true);
	if (isSeq(cur)) return cur as YAMLSeq;
	const seq = new YAMLSeq();
	d.set(key, seq);
	return seq;
}

/** The workflow entry (in `workflows:` by id, or `loops:` by name). */
function findWorkflow(d: Document.Parsed, id: string): YAMLMap | null {
	for (const [key, field] of [["workflows", "id"], ["workflows", "name"], ["loops", "name"]] as const) {
		const seq = d.get(key, true);
		if (!isSeq(seq)) continue;
		for (const it of (seq as YAMLSeq).items) if (isMap(it) && s((it as YAMLMap).get(field)) === id) return it as YAMLMap;
	}
	return null;
}

function findNode(d: Document.Parsed, id: string): YAMLMap | null {
	const seq = d.get("nodes", true);
	if (!isSeq(seq)) return null;
	for (const it of (seq as YAMLSeq).items) if (isMap(it) && s((it as YAMLMap).get("id")) === id) return it as YAMLMap;
	return null;
}

export interface NewWorkflow {
	id: string; title?: string; about?: string; parent?: string; node?: string;
	steps: { python?: string; dag?: string; skills?: string[]; workflows?: ChainStage[] };
	inputs?: Record<string, unknown>; data?: string[]; compute?: { site?: string; gpu?: string };
	feedback?: FeedbackStep[]; notes?: string;
}

/** Append workflows (always `run: manual` — nothing new runs on its own). */
export function addWorkflows(text: string, entries: NewWorkflow[], node?: SpecNode): string {
	const d = doc(text);
	const ids = new Set(readAppSpec(text).workflows.map((w) => w.id));
	for (const e of entries) {
		if (!/^[a-z][a-z0-9_]{0,47}$/.test(e.id)) throw new Error(`"${e.id}" can't be a workflow id: use lower-case letters, digits and _`);
		if (ids.has(e.id)) throw new Error(`There is already a workflow called "${e.id}"`);
		if (e.parent && !ids.has(e.parent)) throw new Error(`There is no workflow "${e.parent}" to make a variant of`);
		if (e.steps.workflows) {
			const stages = chainStages(e.steps);
			if (!stages.length) throw new Error("A chain needs at least one workflow");
			for (const st of stages) {
				if (st.use === e.id) throw new Error(`"${e.id}" can't be a stage of itself`);
				if (!ids.has(st.use)) throw new Error(`There is no workflow "${st.use}" to chain`);
			}
		}
		ids.add(e.id);
	}
	if (node) {
		if (findNode(d, node.id)) throw new Error(`There is already a node "${node.id}"`);
		seqAt(d, "nodes").add(d.createNode({ id: node.id, title: node.title, parent: node.parent }));
	}
	const seq = seqAt(d, "workflows");
	for (const e of entries) {
		const entry: Obj = { id: e.id };
		if (e.title) entry.title = e.title;
		if (e.about) entry.about = e.about;
		if (e.notes) entry.notes = e.notes;
		if (e.parent) entry.parent = e.parent;
		if (e.node) entry.node = e.node;
		entry.run = "manual";
		entry.steps = e.steps.workflows
			? { workflows: e.steps.workflows.map((st) => (typeof st === "string" || !st.inputs || !Object.keys(st.inputs).length ? (typeof st === "string" ? st : st.use) : { use: st.use, inputs: st.inputs })) }
			: e.steps;
		if (e.inputs && Object.keys(e.inputs).length) entry.inputs = e.inputs;
		if (e.data?.length) entry.data = e.data;
		if (e.compute && Object.values(e.compute).some(Boolean)) entry.compute = Object.fromEntries(Object.entries(e.compute).filter(([, v]) => v));
		if (e.feedback?.length) entry.feedback = e.feedback.map(feedbackOut);
		seq.add(d.createNode(entry));
	}
	return String(d);
}

/** Place a workflow in a node, or (null) directly under its parent / the app. */
export function setWorkflowNode(text: string, workflowId: string, node: string | null): string {
	const d = doc(text);
	const w = findWorkflow(d, workflowId);
	if (!w) throw new Error(`No workflow "${workflowId}"`);
	if (node && !findNode(d, node)) throw new Error(`No node "${node}"`);
	if (node) w.set("node", node); else w.delete("node");
	return String(d);
}

/** Ids of everything a node contains, transitively (for cycle checks). */
function nodeDescendants(text: string, id: string): Set<string> {
	const sp = readAppSpec(text);
	const out = new Set<string>();
	const walk = (p: string) => { for (const n of sp.nodes) if (n.parent === p && !out.has(n.id)) { out.add(n.id); walk(n.id); } };
	walk(id);
	return out;
}

export function addNode(text: string, title: string, parent: string): { text: string; id: string } {
	const sp = readAppSpec(text);
	if (!title.trim()) throw new Error("Give the node a name");
	if (!sp.workflows.some((w) => w.id === parent) && !sp.nodes.some((n) => n.id === parent)) throw new Error(`No workflow or node "${parent}" to put it under`);
	const id = nodeIdFrom(title, [...sp.nodes.map((n) => n.id), ...sp.workflows.map((w) => w.id)]);
	const d = doc(text);
	seqAt(d, "nodes").add(d.createNode({ id, title: title.trim(), parent }));
	return { text: String(d), id };
}

export function renameNode(text: string, id: string, title: string): string {
	if (!title.trim()) throw new Error("Give the node a name");
	const d = doc(text);
	const n = findNode(d, id);
	if (!n) throw new Error(`No node "${id}"`);
	n.set("title", title.trim());
	return String(d);
}

/** Put a node under another workflow or node (never inside itself). */
export function moveNode(text: string, id: string, parent: string): string {
	if (id === parent || nodeDescendants(text, id).has(parent)) throw new Error("A node can't go inside itself");
	const sp = readAppSpec(text);
	if (!sp.workflows.some((w) => w.id === parent) && !sp.nodes.some((n) => n.id === parent)) throw new Error(`No workflow or node "${parent}"`);
	const d = doc(text);
	const n = findNode(d, id);
	if (!n) throw new Error(`No node "${id}"`);
	n.set("parent", parent);
	return String(d);
}

/** Remove a node; everything in it moves up to the node's own parent. Nothing is deleted. */
export function removeNode(text: string, id: string): string {
	const sp = readAppSpec(text);
	const gone = sp.nodes.find((n) => n.id === id);
	if (!gone) throw new Error(`No node "${id}"`);
	const upIsNode = sp.nodes.some((n) => n.id === gone.parent);
	const d = doc(text);
	for (const w of sp.workflows.filter((w) => w.node === id)) {
		const m = findWorkflow(d, w.id);
		if (!m) continue;
		if (upIsNode) m.set("node", gone.parent); else m.delete("node");
	}
	for (const n of sp.nodes.filter((n) => n.parent === id)) findNode(d, n.id)?.set("parent", gone.parent);
	const seq = d.get("nodes", true) as YAMLSeq;
	seq.items = seq.items.filter((it) => !(isMap(it) && s((it as YAMLMap).get("id")) === id));
	return String(d);
}

/**
 * Replace a workflow's feedback steps (metrics, service, gate). A step that was
 * already there is edited in place, so its comments and style survive; new
 * steps are appended in the order given; steps left out are removed.
 */
export function setFeedback(text: string, workflowId: string, feedback: FeedbackStep[]): string {
	const d = doc(text);
	const w = findWorkflow(d, workflowId);
	if (!w) throw new Error(`No workflow "${workflowId}"`);
	if (!feedback.length) {
		w.delete("feedback");
		return String(d);
	}
	const old = w.get("feedback", true);
	if (!isSeq(old)) {
		w.set("feedback", d.createNode(feedback.map(feedbackOut)));
		return String(d);
	}
	const byStep = new Map<string, YAMLMap>();
	for (const it of old.items) if (isMap(it)) byStep.set(s(it.get("step")), it as YAMLMap);
	old.items = feedback.map((f) => {
		const m = byStep.get(f.step);
		if (!m) return d.createNode(feedbackOut(f));
		byStep.delete(f.step); // a step listed twice gets a fresh entry the second time
		if (f.service) m.set("service", f.service); else m.delete("service");
		const was = feedbackOf([m.toJSON()])[0]?.metrics ?? [];
		if (JSON.stringify(was) !== JSON.stringify(f.metrics)) m.set("metrics", d.createNode(metricsOut(f)));
		if (f.gate?.trim()) m.set("gate", f.gate.trim()); else m.delete("gate");
		return m;
	});
	return String(d);
}

// ── versions of an experiment ─────────────────────────────────────────────
//
// A researcher adds versions to an existing experiment from its panel (round
// 10, 2026-11-28: the only ways were the chat — which could not read the app's
// notes — or hand-editing YAML). Text in, text out, comments kept.

export interface NewVersion { id: string; about?: string; inputs: Record<string, unknown> }

function findExperiment(d: Document.Parsed, id: string): YAMLMap | null {
	const seq = d.get("experiments", true);
	if (!isSeq(seq)) return null;
	for (const it of (seq as YAMLSeq).items) if (isMap(it) && s((it as YAMLMap).get("id")) === id) return it as YAMLMap;
	return null;
}

/** The inputs a version of workflow `wfId` can set: its own, or for a chain
 *  every stage's (a version's inputs reach every stage). */
export function versionInputs(spec: AppSpec, wfId: string): string[] {
	const wf = spec.workflows.find((w) => w.id === wfId);
	if (!wf) return [];
	const names = new Set(Object.keys(wf.inputs));
	for (const st of chainStages(wf.steps)) {
		for (const k of Object.keys(spec.workflows.find((w) => w.id === st.use)?.inputs ?? {})) names.add(k);
	}
	return [...names];
}

/** The ids an experiment already declares (versions, or older `arms`). */
export function versionIds(text: string, experimentId: string): string[] {
	const d = parseDocument(text || "");
	const e = d.errors.length ? null : findExperiment(d as Document.Parsed, experimentId);
	if (!e) return [];
	const out: string[] = [];
	for (const key of ["versions", "arms"]) {
		const seq = e.get(key, true);
		if (isSeq(seq)) for (const it of (seq as YAMLSeq).items) if (isMap(it)) out.push(s((it as YAMLMap).get("id")));
	}
	return out.filter(Boolean);
}

/** A starting point for new versions: the experiment's first version as YAML,
 *  renamed, so the reader edits a real example instead of a blank box. */
export function versionTemplate(text: string, experimentId: string): string {
	const d = parseDocument(text || "");
	const e = d.errors.length ? null : findExperiment(d as Document.Parsed, experimentId);
	const seq = e?.get("versions", true);
	const first = isSeq(seq) ? (seq as YAMLSeq).items.find(isMap) : null;
	const base = first ? obj((first as YAMLMap).toJSON()) : {};
	const inputs = obj(base.inputs);
	const entry: Obj = { id: `${s(base.id) || "version"}_2`, about: "What this version changes, and why it might win" };
	if (Object.keys(inputs).length) entry.inputs = inputs;
	return stringify([entry], { lineWidth: 0 });
}

/**
 * New versions as the reader typed or pasted them: a YAML/JSON list of
 * `{id, about?, inputs?}` (one mapping counts as a list of one). Every problem
 * comes back in words; `versions` holds only the ones that can be added.
 */
export function parseNewVersions(text: string, taken: Iterable<string>, inputNames?: string[]): { versions: NewVersion[]; problems: string[] } {
	const problems: string[] = [];
	let raw: unknown;
	try { raw = parse(text || ""); } catch (e) { return { versions: [], problems: [`That isn't valid YAML or JSON: ${String((e as Error).message).split("\n")[0]}`] }; }
	const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
	if (!items.length) return { versions: [], problems: ["Write at least one version: a list of entries with an id and inputs."] };
	const seen = new Set(taken);
	const allowed = inputNames && inputNames.length ? new Set(inputNames) : null;
	const versions: NewVersion[] = [];
	items.forEach((it, i) => {
		const o = obj(it);
		const id = s(o.id).trim();
		const where = id ? `"${id}"` : `Entry ${i + 1}`;
		if (!/^[a-z][a-z0-9_]{0,47}$/.test(id)) { problems.push(`${where}: an id is lower-case letters, digits and _ (it starts with a letter).`); return; }
		if (seen.has(id)) { problems.push(`${where}: there is already a version with that id.`); return; }
		const inputs = obj(o.inputs);
		const unknown = allowed ? Object.keys(inputs).filter((k) => !allowed.has(k)) : [];
		if (unknown.length) { problems.push(`${where}: ${unknown.join(", ")} ${unknown.length > 1 ? "aren't inputs" : "isn't an input"} of this experiment's workflow, so ${unknown.length > 1 ? "they" : "it"} would be ignored. Its inputs: ${[...allowed!].join(", ")}.`); return; }
		const extra = Object.keys(o).filter((k) => !["id", "about", "inputs"].includes(k));
		if (extra.length) { problems.push(`${where}: put ${extra.join(", ")} under inputs (a version has only id, about and inputs).`); return; }
		seen.add(id);
		versions.push({ id, ...(s(o.about).trim() ? { about: s(o.about).trim() } : {}), inputs });
	});
	return { versions, problems };
}

/** Append versions to an experiment's `versions:` (the simple scheme). */
export function addVersions(text: string, experimentId: string, versions: NewVersion[]): string {
	const d = doc(text);
	const e = findExperiment(d, experimentId);
	if (!e) throw new Error(`There is no experiment "${experimentId}" in this app's spec`);
	if (isSeq(e.get("arms", true)) && !isSeq(e.get("versions", true))) {
		throw new Error(`"${experimentId}" lists arms (the older form), not versions — add them in Settings (YAML)`);
	}
	const taken = new Set(versionIds(text, experimentId));
	const cur = e.get("versions", true);
	let seq: YAMLSeq;
	if (isSeq(cur)) seq = cur as YAMLSeq;
	else { seq = new YAMLSeq(); e.set("versions", seq); }
	for (const v of versions) {
		if (taken.has(v.id)) throw new Error(`There is already a version "${v.id}"`);
		taken.add(v.id);
		const entry: Obj = { id: v.id };
		if (v.about) entry.about = v.about;
		if (Object.keys(v.inputs).length) entry.inputs = v.inputs;
		seq.add(d.createNode(entry));
	}
	return String(d);
}
