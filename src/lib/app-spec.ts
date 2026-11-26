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

import { parseDocument, isMap, isSeq, type Document, YAMLMap, YAMLSeq } from "yaml";

export interface FeedbackMetric { name: string; better: "higher" | "lower"; target?: number }
/** `service`: the instrument that measures this step (identity's /me/measure registry). */
export interface FeedbackStep { step: string; metrics: FeedbackMetric[]; service?: string }

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
	steps: { python?: string; dag?: string; skills?: string[] };
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
		};
	}).filter((st) => st.step);
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
			: { ...(steps.python ? { python: s(steps.python) } : {}), ...(steps.dag ? { dag: s(steps.dag) } : {}), ...(list(steps.skills).length ? { skills: list(steps.skills).map(s) } : {}) },
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
	steps: { python?: string; dag?: string; skills?: string[] };
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
		entry.steps = e.steps;
		if (e.inputs && Object.keys(e.inputs).length) entry.inputs = e.inputs;
		if (e.data?.length) entry.data = e.data;
		if (e.compute && Object.values(e.compute).some(Boolean)) entry.compute = Object.fromEntries(Object.entries(e.compute).filter(([, v]) => v));
		if (e.feedback?.length) entry.feedback = e.feedback.map((f) => ({ step: f.step, ...(f.service ? { service: f.service } : {}), metrics: f.metrics.map((m) => ({ name: m.name, better: m.better, ...(m.target != null ? { target: m.target } : {}) })) }));
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

/** Replace a workflow's feedback steps and metrics. */
export function setFeedback(text: string, workflowId: string, feedback: FeedbackStep[]): string {
	const d = doc(text);
	const w = findWorkflow(d, workflowId);
	if (!w) throw new Error(`No workflow "${workflowId}"`);
	if (feedback.length) {
		w.set("feedback", d.createNode(feedback.map((f) => ({ step: f.step, ...(f.service ? { service: f.service } : {}), metrics: f.metrics.map((m) => ({ name: m.name, better: m.better, ...(m.target != null ? { target: m.target } : {}) })) }))));
	} else {
		w.delete("feedback");
	}
	return String(d);
}
