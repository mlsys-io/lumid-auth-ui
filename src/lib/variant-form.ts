// variant-form — the "Make a variant" / "New workflow" sheet as pure functions.
//
// A variant is a workflow made from another workflow by changing its steps,
// code, data or compute. The sheet (components/research/VariantSheet.tsx) holds
// a VariantForm; this file turns it into what lib/app-spec's addWorkflows takes
// (entries + an optional new node) plus the definition files that land with the
// spec. Every message here is a sentence a person reads — never a raw code.
//
// Nothing built here is scheduled: addWorkflows writes `run: manual`, and the
// form has no schedule field on purpose (runs are started by hand).

import { parse as parseYaml } from "yaml";
import { nodeIdFrom, type AppSpec, type FeedbackStep, type NewWorkflow, type SpecNode, type SpecWorkflow } from "./app-spec";

/** How the variant differs from its parent. "describe" never reaches buildVariants. */
export type ChangeKind = "describe" | "steps" | "code" | "same";

export type Placement =
	| { mode: "new"; title: string }   // a new node under the parent (default with a parent)
	| { mode: "under" }                // directly under the parent (or the app, with no parent)
	| { mode: "into"; node: string };  // an existing node

export interface InputRow { key: string; value: string }
export interface VariantRow { id: string; title: string; inputs: InputRow[] }

export interface VariantForm {
	change: Exclude<ChangeKind, "describe">;
	/** The edited DAG (change = steps). */
	dagText?: string;
	/** The edited Python (change = code). */
	codeText?: string;
	/** One or more variants; they share the change, data, compute, feedback and node. */
	rows: VariantRow[];
	data: string[];
	compute: { site?: string; gpu?: string };
	feedback: FeedbackStep[];
	placement: Placement;
}

export interface BuiltVariants {
	entries: NewWorkflow[];
	files: Array<{ path: string; content: string }>;
	node?: SpecNode;
	ids: string[];
}

const ID_RE = /^[a-z][a-z0-9_]{0,47}$/;

/** Why `id` can't name a new workflow, or null when it can. Same rule as addWorkflows. */
export function idProblem(id: string, taken: Iterable<string>, alsoInForm: string[] = []): string | null {
	if (!id) return "Give it an id";
	if (!ID_RE.test(id)) return "Use lower-case letters, digits and _ (starting with a letter, at most 48)";
	if (new Set(taken).has(id)) return `There is already a workflow called "${id}"`;
	if (alsoInForm.includes(id)) return "Two variants here have the same id";
	return null;
}

/** A free id for the next variant of `base` (e.g. simulate_variant, simulate_variant_2). */
export function suggestId(base: string, taken: Iterable<string>): string {
	return nodeIdFrom(base ? `${base} variant` : "new workflow", taken).slice(0, 48);
}

// ── inputs ───────────────────────────────────────────────────────────────

/** Inputs as editable rows: strings as typed, everything else as JSON. */
export function inputRowsFrom(inputs: Record<string, unknown>): InputRow[] {
	return Object.entries(inputs).map(([key, v]) => ({ key, value: typeof v === "string" ? v : JSON.stringify(v) }));
}

/**
 * The value a row's text stands for. An input the parent already has keeps the
 * parent's type (a string "9.2" stays a string; a number stays a number); a new
 * input reads as YAML (`3` → 3, `true` → true, `[a, b]` → a list).
 */
export function inputValue(text: string, like?: unknown): unknown {
	const t = text.trim();
	if (typeof like === "string") return text;
	if (typeof like === "number") {
		const n = Number(t);
		if (t === "" || !Number.isFinite(n)) throw new Error(`"${text}" is not a number`);
		return n;
	}
	if (typeof like === "boolean") {
		if (/^(true|yes)$/i.test(t)) return true;
		if (/^(false|no)$/i.test(t)) return false;
		throw new Error(`"${text}" is not true or false`);
	}
	if (like !== undefined && like !== null && typeof like === "object") {
		try { return JSON.parse(t); } catch { throw new Error(`"${text}" is not a list or mapping (write it as JSON)`); }
	}
	if (t === "") return "";
	try { return parseYaml(t) ?? t; } catch { return text; }
}

/** Rows → the inputs mapping. Empty keys are skipped; a repeated key is an error. */
export function inputsFrom(rows: InputRow[], parentInputs: Record<string, unknown> = {}): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const r of rows) {
		const key = r.key.trim();
		if (!key) continue;
		if (key in out) throw new Error(`The input "${key}" is listed twice`);
		try {
			out[key] = inputValue(r.value, parentInputs[key]);
		} catch (e) {
			throw new Error(`Input "${key}": ${(e as Error).message}`);
		}
	}
	return out;
}

// ── definition files ─────────────────────────────────────────────────────

/** Where a DAG named in `steps.dag` lives in the app bundle. */
export function dagPath(dag: string): string {
	const d = dag.trim().replace(/^\.?\//, "");
	if (d.startsWith("workflows/")) return /\.ya?ml$/.test(d) ? d : `${d}.yaml`;
	return `workflows/${d.replace(/\.ya?ml$/, "")}.yaml`;
}

/** Where a Python step named in `steps.python` lives in the app bundle. */
export function codePath(module: string): string {
	const m = module.trim().replace(/^\.?\//, "").replace(/^commands\//, "").replace(/\.py$/, "");
	return `commands/${m}.py`;
}

/** What a new workflow starts from when it has no parent. */
export const BLANK_DAG = "# The steps of this workflow. Add one with + Add.\nops: []\n";
export const BLANK_CODE = "# One Python step. Read inputs from argv / env, print a JSON result.\nimport json\n\nprint(json.dumps({\"ok\": True}))\n";

// ── feedback ─────────────────────────────────────────────────────────────

/** Drop blank steps and metrics; a step with no metrics is kept (it still gives feedback). */
export function cleanFeedback(fb: FeedbackStep[]): FeedbackStep[] {
	return fb
		.map((f) => ({
			step: f.step.trim(),
			metrics: f.metrics
				.map((m) => ({ name: m.name.trim(), better: m.better, ...(m.target != null && Number.isFinite(m.target) ? { target: m.target } : {}) }))
				.filter((m) => m.name),
		}))
		.filter((f) => f.step);
}

// ── the whole form ───────────────────────────────────────────────────────

/** Turn the form into addWorkflows' arguments and the files to save. Throws a sentence. */
export function buildVariants(form: VariantForm, spec: AppSpec, parent?: SpecWorkflow): BuiltVariants {
	const taken = spec.workflows.map((w) => w.id);
	if (!form.rows.length) throw new Error("Add at least one variant");
	const ids = form.rows.map((r) => r.id.trim());
	ids.forEach((id, i) => {
		const why = idProblem(id, taken, ids.slice(0, i));
		if (why) throw new Error(`${id || `Variant ${i + 1}`}: ${why}`);
	});

	// One definition file per sheet, named after the first variant; every
	// variant made here runs the same steps with its own inputs.
	const files: BuiltVariants["files"] = [];
	let steps: NewWorkflow["steps"];
	if (form.change === "steps") {
		if (!form.dagText?.trim()) throw new Error("The steps are empty");
		files.push({ path: dagPath(ids[0]), content: form.dagText.endsWith("\n") ? form.dagText : form.dagText + "\n" });
		steps = { dag: ids[0] };
	} else if (form.change === "code") {
		if (!form.codeText?.trim()) throw new Error("The code is empty");
		files.push({ path: codePath(ids[0]), content: form.codeText.endsWith("\n") ? form.codeText : form.codeText + "\n" });
		steps = { python: ids[0] };
	} else {
		if (!parent) throw new Error("A new workflow needs steps or code");
		steps = { ...parent.steps };
	}

	let node: SpecNode | undefined;
	let nodeId: string | undefined;
	const p = form.placement;
	if (p.mode === "new") {
		if (!parent) throw new Error("A new node goes under a workflow — pick one, or put it at the top");
		if (!p.title.trim()) throw new Error("Give the new node a name");
		nodeId = nodeIdFrom(p.title, [...spec.nodes.map((n) => n.id), ...taken, ...ids]);
		node = { id: nodeId, title: p.title.trim(), parent: parent.id };
	} else if (p.mode === "into") {
		if (!spec.nodes.some((n) => n.id === p.node)) throw new Error(`There is no node "${p.node}"`);
		nodeId = p.node;
	}

	const feedback = cleanFeedback(form.feedback);
	const compute = Object.fromEntries(Object.entries(form.compute).filter(([, v]) => v)) as { site?: string; gpu?: string };
	const entries: NewWorkflow[] = form.rows.map((r, i) => ({
		id: ids[i],
		...(r.title.trim() ? { title: r.title.trim() } : {}),
		...(parent ? { parent: parent.id } : {}),
		...(nodeId ? { node: nodeId } : {}),
		steps,
		inputs: inputsFrom(r.inputs, parent?.inputs),
		data: form.data.map((d) => d.trim()).filter(Boolean),
		compute,
		feedback,
	}));
	return { entries, files, node, ids };
}

// ── words ────────────────────────────────────────────────────────────────

/** The parent's definition, as lines a chat can read. */
export function definitionLines(w: SpecWorkflow): string[] {
	const steps = w.steps.dag ? `the step graph ${dagPath(w.steps.dag)}` : w.steps.python ? `the Python step ${codePath(w.steps.python)}` : w.steps.skills?.length ? `the skills ${w.steps.skills.join(", ")}` : "no steps declared";
	const lines = [`Steps: ${steps}`];
	lines.push(`Inputs: ${Object.keys(w.inputs).length ? JSON.stringify(w.inputs) : "none"}`);
	lines.push(`Data: ${w.data.length ? w.data.join(", ") : "none"}`);
	const c = [w.compute.site && `site ${w.compute.site}`, w.compute.gpu && `GPU memory ${w.compute.gpu}`].filter(Boolean);
	lines.push(`Compute: ${c.length ? c.join(", ") : "the app's default"}`);
	lines.push(`Feedback: ${w.feedback.length ? w.feedback.map((f) => `${f.step} (${f.metrics.map((m) => `${m.name}, better ${m.better}${m.target != null ? `, aiming for ${m.target}` : ""}`).join("; ") || "no metrics"})`).join(" · ") : "none"}`);
	return lines;
}

/** The message "Describe it" puts in the chat composer. */
export function describePrompt(app: string, description: string, parent?: SpecWorkflow): string {
	const want = description.trim() || "(describe the change here)";
	if (!parent) {
		return [
			`Draft a new workflow for the app "${app}".`,
			`What it should do: ${want}`,
			"",
			"Write its steps (or code), inputs, data, compute and feedback metrics, and stage it as a proposal for me to approve. It runs only when started by hand (run: manual). Start nothing.",
		].join("\n");
	}
	return [
		`Draft a variant of the workflow "${parent.id}" in the app "${app}".`,
		"Its definition now:",
		...definitionLines(parent).map((l) => `- ${l}`),
		"",
		`The change I want: ${want}`,
		"",
		`Keep everything else the same. Give it its own id, set parent: ${parent.id}, and stage it as a proposal for me to approve. It runs only when started by hand (run: manual). Start nothing.`,
	].join("\n");
}

/** A failed save in words. 409 survives useAppGraph's one retry only when the spec keeps moving. */
export function saveErrorWords(e: unknown): string {
	const status = (e as { status?: number })?.status;
	const msg = e instanceof Error ? e.message : String(e ?? "");
	if (status === 409 || /\b409\b/.test(msg)) return "The spec changed — try again.";
	if (status === 401) return "You're signed out — sign in and try again.";
	if (status === 403) return "Only the app's owner can change it (and only admins can save code).";
	if (status === 413) return "The files are too big to save.";
	if (status && status >= 500) return `The server couldn't save it (HTTP ${status}) — try again.`;
	// The browser's own words for a request that got no answer at all.
	if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return "Couldn't reach lum.id, so nothing was saved — try again in a moment.";
	return msg || "Couldn't save the spec.";
}
