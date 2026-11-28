// Edit a workflow's whole shape from its own page (2026-11-28, operator: "i saw
// workflow dag module, but cant edit"). The page drew Data → Steps → Measured by
// (or a chain's stages) read-only; these are the edits behind its Edit button.
//
// Text in, text out, comments kept: each edit touches only the keys it owns on
// the one workflow entry, so a hand-written spec keeps its comments, its
// flow-style maps and every key this editor does not know about (compute.budget,
// skills_invoked, knowledge_agent, ...).

import { isMap, isScalar, isSeq, type Document, type YAMLMap, type YAMLSeq } from "yaml";
import { specDocument, type AppSpec, type ChainStage, type SpecWorkflow } from "./app-spec";

/** What the editor shows and changes. Strings throughout: the form's own values. */
export interface WorkflowShape {
	/** Exactly one kind, as the workflow declares it. */
	kind: "python" | "dag" | "chain" | "skills" | "none";
	/** python: the module name (commands/<python>.py); dag: the file path. */
	python: string;
	dag: string;
	/** chain stages in order; an entry keeps the inputs it was written with. */
	stages: Array<{ use: string; inputs: Record<string, unknown> }>;
	skills: string[];
	data: string[];
	/** Input names and their defaults, in order ("" = no default). */
	inputs: Array<{ name: string; value: string }>;
	/** compute.site / compute.gpu / compute.memory ("" = the app's default). */
	site: string;
	gpu: string;
	memory: string;
	/** "manual" or a cron line. */
	run: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function findWorkflow(d: Document.Parsed, id: string): YAMLMap | null {
	for (const [key, field] of [["workflows", "id"], ["workflows", "name"], ["loops", "name"]] as const) {
		const seq = d.get(key, true);
		if (!isSeq(seq)) continue;
		for (const it of (seq as YAMLSeq).items) if (isMap(it) && str((it as YAMLMap).get(field)) === id) return it as YAMLMap;
	}
	return null;
}

/** The form's starting values. */
export function readShape(wf: SpecWorkflow): WorkflowShape {
	const compute = obj(wf.compute);
	const st = wf.steps;
	const kind: WorkflowShape["kind"] = st.workflows?.length ? "chain" : st.python ? "python" : st.dag ? "dag" : st.skills?.length ? "skills" : "none";
	return {
		kind,
		python: st.python ?? "",
		dag: st.dag ?? "",
		stages: (st.workflows ?? []).map((s: ChainStage) => (typeof s === "string" ? { use: s, inputs: {} } : { use: s.use, inputs: s.inputs ?? {} })),
		skills: [...(st.skills ?? [])],
		data: [...wf.data],
		inputs: Object.entries(wf.inputs).map(([name, v]) => ({ name, value: str(v) })),
		site: str(compute.site),
		gpu: str(compute.gpu),
		memory: str(compute.memory),
		run: wf.run || "manual",
	};
}

/** The file a workflow's steps live in, or null (a chain or skills list lives in the spec). */
export function stepsFile(shape: Pick<WorkflowShape, "kind" | "python" | "dag">): string | null {
	if (shape.kind === "python" && shape.python.trim()) return `commands/${shape.python.trim()}.py`;
	if (shape.kind === "dag" && shape.dag.trim()) return shape.dag.trim();
	return null;
}

const CRON_FIELD = /^[\d*/,\-A-Za-z?LW#]+$/;
const MEMORY = /^\d+(\.\d+)?\s*(Ki|Mi|Gi|K|M|G)?$/;

/** Why the form can't be saved yet, in words (empty = it can). */
export function shapeProblems(shape: WorkflowShape, spec: AppSpec, wfId: string): string[] {
	const out: string[] = [];
	const ids = new Set(spec.workflows.map((w) => w.id));
	const chains = new Set(spec.workflows.filter((w) => w.steps.workflows?.length).map((w) => w.id));
	if (shape.kind === "chain") {
		if (!shape.stages.length) out.push("A chain needs at least one stage.");
		for (const s of shape.stages) {
			if (!s.use) out.push("Pick a workflow for every stage.");
			else if (s.use === wfId) out.push("A chain can't run itself as a stage.");
			else if (!ids.has(s.use)) out.push(`There is no workflow "${s.use}" in this app.`);
			else if (chains.has(s.use)) out.push(`"${s.use}" is itself a chain; a stage has to be a plain workflow.`);
		}
	}
	if (shape.kind === "python" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(shape.python.trim())) out.push("The Python step needs a module name (letters, digits and _), the file commands/<name>.py.");
	if (shape.kind === "skills" && !shape.skills.some((k) => k.trim())) out.push("Add at least one skill.");
	const names = shape.inputs.map((i) => i.name.trim()).filter(Boolean);
	if (shape.inputs.some((i) => !i.name.trim() && i.value.trim())) out.push("Every input with a default needs a name.");
	const dup = names.find((n, i) => names.indexOf(n) !== i);
	if (dup) out.push(`The input "${dup}" is listed twice.`);
	if (names.some((n) => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(n))) out.push("Input names are letters, digits, _ . and - (no spaces).");
	if (shape.memory.trim() && !MEMORY.test(shape.memory.trim())) out.push(`Memory reads like 512Mi or 2Gi, not "${shape.memory.trim()}".`);
	const run = shape.run.trim();
	if (run && run !== "manual" && !run.startsWith("@")) {
		const f = run.split(/\s+/);
		if (f.length !== 5 || !f.every((x) => CRON_FIELD.test(x))) out.push(`"${run}" isn't a schedule: use five cron fields, e.g. "0 6 * * *" (every day at 06:00).`);
	}
	return [...new Set(out)];
}

/** True when the form differs from what the workflow declares now. */
export function shapeChanged(a: WorkflowShape, b: WorkflowShape): boolean {
	const norm = (s: WorkflowShape) => ({
		...s,
		python: s.python.trim(), dag: s.dag.trim(), site: s.site.trim(), gpu: s.gpu.trim(), memory: s.memory.trim(), run: s.run.trim() || "manual",
		skills: s.skills.map((k) => k.trim()).filter(Boolean),
		inputs: s.inputs.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), value: i.value })),
	});
	return JSON.stringify(norm(a)) !== JSON.stringify(norm(b));
}

function setOrDelete(m: YAMLMap, key: string, value: unknown, d: Document.Parsed) {
	const empty = value == null || value === "" || (Array.isArray(value) && !value.length) || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value as object).length);
	if (empty) { m.delete(key); return; }
	const cur = m.get(key, true);
	// An unchanged value keeps its node (and so its style and comments).
	if (cur !== undefined && JSON.stringify(isScalar(cur) ? cur.value : (cur as { toJSON?: () => unknown })?.toJSON?.()) === JSON.stringify(value)) return;
	if (isScalar(cur) && (typeof value === "string" || typeof value === "number")) { cur.value = value; return; }
	m.set(key, d.createNode(value));
}

/**
 * Write the form back onto the one workflow entry. Only the keys the form owns
 * change: steps (its one kind), data, inputs, compute.site, compute.memory, run.
 * Legacy `loops:` entries keep their own engine block, so this refuses them
 * rather than half-write a mixed shape.
 */
export function setWorkflowShape(text: string, wfId: string, shape: WorkflowShape): string {
	const d = specDocument(text);
	const w = findWorkflow(d, wfId);
	if (!w) throw new Error(`No workflow "${wfId}" in this app's spec`);
	if (w.has("engine") || (!w.has("id") && w.has("name"))) throw new Error(`"${wfId}" is written in the older format; change it in Manage → Spec.`);
	const before = JSON.stringify(d.toJS());

	// steps: only the declared kind's key changes; others it may carry are kept.
	let steps: unknown = w.get("steps", true);
	if (!isMap(steps)) { w.set("steps", d.createNode({})); steps = w.get("steps", true); }
	const sm = steps as YAMLMap;
	if (shape.kind === "python") setOrDelete(sm, "python", shape.python.trim(), d);
	if (shape.kind === "dag") setOrDelete(sm, "dag", shape.dag.trim(), d);
	if (shape.kind === "skills") setOrDelete(sm, "skills", shape.skills.map((k) => k.trim()).filter(Boolean), d);
	if (shape.kind === "chain") setOrDelete(sm, "workflows", shape.stages.map((s) => (Object.keys(s.inputs).length ? { use: s.use, inputs: s.inputs } : s.use)), d);

	setOrDelete(w, "data", shape.data.map((x) => x.trim()).filter(Boolean), d);

	const inputs: Record<string, string> = {};
	for (const i of shape.inputs) if (i.name.trim()) inputs[i.name.trim()] = i.value;
	setOrDelete(w, "inputs", inputs, d);

	let compute: unknown = w.get("compute", true);
	if (!isMap(compute) && (shape.site.trim() || shape.gpu.trim() || shape.memory.trim())) { w.set("compute", d.createNode({})); compute = w.get("compute", true); }
	if (isMap(compute)) {
		setOrDelete(compute as YAMLMap, "site", shape.site.trim(), d);
		setOrDelete(compute as YAMLMap, "gpu", shape.gpu.trim(), d);
		setOrDelete(compute as YAMLMap, "memory", shape.memory.trim(), d);
		if (!(compute as YAMLMap).items.length) w.delete("compute");
	}

	const run = shape.run.trim() || "manual";
	// "@trigger" and "manual" both read as manual; keep whichever is written.
	const wasRun = str(w.get("run"));
	if (!(run === "manual" && (wasRun === "@trigger" || wasRun === "manual" || wasRun === ""))) setOrDelete(w, "run", run, d);
	// Nothing changed: hand back the text untouched (re-emitting would restyle it).
	return JSON.stringify(d.toJS()) === before ? text : String(d);
}

/** One line per edit, for the toast after a save. */
export function shapeSavedWords(before: WorkflowShape, after: WorkflowShape, fileChanged: boolean): string {
	const parts: string[] = [];
	if (fileChanged) parts.push("its steps file");
	if (JSON.stringify(before.stages) !== JSON.stringify(after.stages)) parts.push("its stages");
	if (JSON.stringify(before.skills) !== JSON.stringify(after.skills.filter((k) => k.trim()))) parts.push("its skills");
	if (before.python !== after.python.trim() || before.dag !== after.dag.trim()) parts.push("which file it runs");
	if (JSON.stringify(before.data) !== JSON.stringify(after.data)) parts.push("its data");
	if (JSON.stringify(before.inputs) !== JSON.stringify(after.inputs.filter((i) => i.name.trim()))) parts.push("its inputs");
	if (before.site !== after.site.trim() || before.gpu !== after.gpu.trim() || before.memory !== after.memory.trim()) parts.push("where it runs");
	if (before.run !== (after.run.trim() || "manual")) parts.push("when it starts");
	if (!parts.length) return "Nothing changed";
	const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
	return `Saved ${list}. It applies from the next run.`;
}
