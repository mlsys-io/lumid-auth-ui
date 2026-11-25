// VariantSheet — "Make a variant" (and, with no parent, "New workflow").
//
// A variant is a workflow made from another workflow by changing its steps,
// code, data or compute. Everything about it settles in this one sheet, in
// five sections: how it changes · data · compute · feedback & metrics · name
// and node. Create saves ONE spec edit (lib/app-spec addWorkflows, built by
// lib/variant-form buildVariants) together with its definition file, through
// the `save` that useAppGraph provides (409 → it re-reads and retries once).
//
// Nothing made here runs on its own: every new workflow is `run: manual`, and
// there is deliberately no schedule field — runs are started by hand.
//
// "Describe it" doesn't save anything: it pre-fills the chat with the parent's
// definition and the description, asking for a proposal to approve.

import { lazy, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Code2, GitBranch, Loader2, MessagesSquare, Plus, Shuffle, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { me } from "@/api/me";
import { AuthContext } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DatasetPicker, type DatasetRef } from "@/components/data/DatasetPicker";
import { ComputePicker } from "@/components/compute/ComputePicker";
import { addWorkflows, type AppSpec, type FeedbackStep, type SpecWorkflow } from "@/lib/app-spec";
import { plainCause } from "@/lib/activity";
import {
	BLANK_CODE, BLANK_DAG, buildVariants, codePath, dagPath, describePrompt, idProblem, inputRowsFrom,
	saveErrorWords, suggestId, type ChangeKind, type InputRow, type Placement, type VariantRow,
} from "@/lib/variant-form";

// The DAG editor (canvas + inspector) is heavy; load it only when "Edit the steps" opens.
const WorkflowEditor = lazy(() => import("@/workflow/WorkflowEditor"));

export interface VariantSheetProps {
	app: string;
	/** The workflow to make a variant of; absent = a new workflow. */
	parent?: SpecWorkflow;
	spec: AppSpec;
	/** useAppGraph's save: applies `edit` to the newest spec and writes it with `files`. */
	save: (edit: (text: string) => string, files?: Array<{ path: string; content: string }>) => Promise<unknown>;
	onClose: () => void;
	onCreated?: (ids: string[]) => void;
}

type Loaded = { state: "idle" } | { state: "loading" } | { state: "ok"; text: string } | { state: "error"; why: string };

const field = "w-full px-3 py-2 text-meta rounded-lg border border-ink-200 bg-card text-ink-900 placeholder:text-ink-500 focus:outline-none focus:ring-4 focus:ring-gold-400/15 focus:border-gold-400";

const wfName = (w: SpecWorkflow) => w.title || w.id;

export function VariantSheet({ app, parent, spec, save, onClose, onCreated }: VariantSheetProps) {
	const role = useContext(AuthContext)?.user?.role;
	const isAdmin = role === "admin" || role === "super_admin";
	const taken = useMemo(() => spec.workflows.map((w) => w.id), [spec.workflows]);
	const label = parent ? "Make a variant" : "New workflow";

	// 1 · how it changes
	const [change, setChange] = useState<ChangeKind>(parent ? "same" : "steps");
	const [description, setDescription] = useState("");
	const [dag, setDag] = useState<Loaded>({ state: "idle" });
	const [code, setCode] = useState<Loaded>({ state: "idle" });
	const [dagText, setDagText] = useState("");
	const [codeText, setCodeText] = useState("");
	// 2–4 · data, compute, feedback (from the parent)
	const [data, setData] = useState<string[]>(parent?.data ?? []);
	const [compute, setCompute] = useState<{ site?: string; gpu?: string }>(parent?.compute ?? {});
	const [feedback, setFeedback] = useState<FeedbackStep[]>(parent?.feedback.map((f) => ({ step: f.step, metrics: f.metrics.map((m) => ({ ...m })) })) ?? []);
	// 5 · name and node
	const [rows, setRows] = useState<VariantRow[]>(() => [{ id: suggestId(parent?.id ?? "", taken), title: "", inputs: inputRowsFrom(parent?.inputs ?? {}) }]);
	const [placementMode, setPlacementMode] = useState<Placement["mode"]>(parent ? "new" : "under");
	const [nodeTitle, setNodeTitle] = useState(parent ? `Variants of ${wfName(parent)}` : "");
	const [intoNode, setIntoNode] = useState(spec.nodes[0]?.id ?? "");

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Load the parent's definition the first time its card opens.
	useEffect(() => {
		if (change === "steps" && dag.state === "idle") {
			if (!parent) { setDag({ state: "ok", text: BLANK_DAG }); setDagText(BLANK_DAG); return; }
			const path = parent.steps.dag ? dagPath(parent.steps.dag) : parent.steps.python ? codePath(parent.steps.python) : null;
			if (!path) return;
			setDag({ state: "loading" });
			me.appFile(app, path)
				.then((r) => { setDag({ state: "ok", text: r.content }); if (parent.steps.dag) setDagText(r.content); })
				.catch((e) => setDag({ state: "error", why: `Couldn't read ${path}: ${plainCause((e as Error)?.message)}` }));
		}
		if (change === "code" && code.state === "idle") {
			if (!parent?.steps.python) { setCode({ state: "ok", text: BLANK_CODE }); setCodeText(BLANK_CODE); return; }
			const path = codePath(parent.steps.python);
			setCode({ state: "loading" });
			me.appFile(app, path)
				.then((r) => { setCode({ state: "ok", text: r.content }); setCodeText(r.content); })
				.catch((e) => setCode({ state: "error", why: `Couldn't read ${path}: ${plainCause((e as Error)?.message)}` }));
		}
	}, [change, dag.state, code.state, parent, app]);

	// Why Create is off right now, in words (null = it can go).
	const blocked: string | null = (() => {
		if (change === "describe") return null;
		if (change === "steps") {
			if (parent && !parent.steps.dag) return parent.steps.python
				? "This workflow's steps are Python code — change them with “Edit the code”."
				: "This workflow has no step graph to edit — pick another way to change it.";
			if (dag.state !== "ok") return dag.state === "error" ? dag.why : "Loading the steps…";
		}
		if (change === "code") {
			if (!isAdmin) return "Only admins can save code, because a Python step runs on the machines as written. Describe the change instead, and an admin can approve it.";
			if (code.state !== "ok") return code.state === "error" ? code.why : "Loading the code…";
		}
		for (const [i, r] of rows.entries()) {
			const why = idProblem(r.id.trim(), taken, rows.slice(0, i).map((x) => x.id.trim()));
			if (why) return `${r.id || `Variant ${i + 1}`}: ${why}`;
		}
		if (placementMode === "new" && !nodeTitle.trim()) return "Give the new node a name.";
		if (placementMode === "into" && !intoNode) return "Pick a node to put it in.";
		return null;
	})();

	const placement: Placement = placementMode === "new" ? { mode: "new", title: nodeTitle } : placementMode === "into" ? { mode: "into", node: intoNode } : { mode: "under" };

	const askChat = () => {
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: { prompt: describePrompt(app, description, parent), context: { app, ...(parent ? { workflow: parent.id } : {}) } },
		}));
		toast.success("It's in the chat — press send, then approve the proposal.");
		onClose();
	};

	const create = async () => {
		if (change === "describe") return askChat();
		setError(null);
		let built;
		try {
			built = buildVariants({
				change, dagText, codeText, rows, data, compute, feedback, placement,
			}, spec, parent);
		} catch (e) {
			setError((e as Error).message);
			return;
		}
		setBusy(true);
		try {
			await save((t) => addWorkflows(t, built.entries, built.node), built.files.length ? built.files : undefined);
			const n = built.ids.length;
			toast.success(parent
				? `Made ${n === 1 ? `the variant ${built.ids[0]}` : `${n} variants`} of ${wfName(parent)}. Run ${n === 1 ? "it" : "them"} when you're ready.`
				: `Made the workflow ${built.ids[0]}. Run it when you're ready.`);
			onCreated?.(built.ids);
			onClose();
		} catch (e) {
			setError(saveErrorWords(e));
		} finally {
			setBusy(false);
		}
	};

	const cards: Array<{ key: ChangeKind; title: string; hint: string; icon: typeof GitBranch; off?: string }> = [
		{ key: "describe", title: "Describe it", hint: parent ? "Say what should change; the chat drafts it for you to approve." : "Say what it should do; the chat drafts it for you to approve.", icon: MessagesSquare },
		{ key: "steps", title: "Edit the steps", hint: parent?.steps.dag ? "Change the step graph. The variant gets its own copy." : parent ? "This one is Python code — see its steps here." : "Draw the steps on a graph.", icon: WorkflowIcon },
		{ key: "code", title: "Edit the code", hint: parent?.steps.python ? "Change the Python step. The variant gets its own copy." : "Write a Python step.", icon: Code2, off: isAdmin ? undefined : "Admins only" },
		...(parent ? [{ key: "same" as const, title: "Same steps, other inputs", hint: "Keep the steps; change inputs, data or compute below.", icon: Shuffle }] : []),
	];

	return (
		<Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
			<DialogContent
				aria-label={label}
				onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
				className="top-0 right-0 left-auto h-full max-h-screen w-full max-w-full sm:max-w-2xl translate-x-0 translate-y-0 rounded-none sm:rounded-l-2xl flex flex-col gap-0 p-0 overflow-hidden"
			>
				<header className="px-5 pt-5 pb-3 border-b border-ink-200 pr-12">
					<DialogTitle className="font-display text-h3 text-ink-900 font-normal">{label}</DialogTitle>
					<DialogDescription className="text-caption text-ink-600 mt-1">
						{parent
							? <>A new workflow made from <span className="font-medium text-ink-800">{wfName(parent)}</span>. It runs only when you start it.</>
							: <>A new workflow in this app. It runs only when you start it.</>}
					</DialogDescription>
				</header>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
					{/* 1 · How it changes */}
					<section aria-label="How it changes" className="space-y-3">
						<SectionTitle n={1} title={parent ? "How it changes" : "How it works"} />
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
							{cards.map((c) => {
								const on = change === c.key;
								const Icon = c.icon;
								return (
									<button
										key={c.key}
										type="button"
										aria-pressed={on}
										onClick={() => { setChange(c.key); setError(null); }}
										className={cn(
											"text-left rounded-xl border p-3 transition-colors",
											on ? "border-gold-300 bg-gold-50/60 ring-2 ring-gold-200" : "border-ink-200 bg-card hover:border-gold-200",
										)}
									>
										<div className="flex items-center gap-2">
											<Icon className={cn("w-4 h-4", on ? "text-gold-700" : "text-ink-600")} />
											<span className="text-meta font-medium text-ink-900">{c.title}</span>
											{c.off && <span className="ml-auto text-nano text-ink-600">{c.off}</span>}
										</div>
										<p className="text-caption text-ink-600 mt-1">{c.hint}</p>
									</button>
								);
							})}
						</div>

						{change === "describe" && (
							<div className="space-y-2">
								<label htmlFor="variant-describe" className="text-caption font-medium text-ink-700">{parent ? "What should be different?" : "What should it do?"}</label>
								<textarea
									id="variant-describe"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									rows={4}
									placeholder={parent ? "e.g. Same simulation, but score on the 2025 tasks and stop after 50 rounds" : "e.g. Every run, read the newest arXiv papers on KV caching and score them for novelty"}
									className={cn(field, "resize-y")}
								/>
								<p className="text-caption text-ink-600">
									The chat gets {parent ? "this workflow's definition and " : ""}your words, drafts the steps, data, compute and feedback, and stages it as a proposal. Nothing is made or started until you approve.
								</p>
							</div>
						)}

						{change === "steps" && (
							<StepsPane parent={parent} loaded={dag} value={dagText} onChange={setDagText} onUseCode={() => setChange("code")} />
						)}

						{change === "code" && (
							<CodePane parent={parent} loaded={code} value={codeText} onChange={setCodeText} canSave={isAdmin} newPath={codePath(rows[0]?.id || "new")} />
						)}
					</section>

					{change !== "describe" && (
						<>
							{/* 2 · Data */}
							<section aria-label="Data" className="space-y-3">
								<SectionTitle n={2} title="Data" hint={parent ? `Starts from what ${wfName(parent)} reads.` : undefined} />
								<DatasetPicker
									multiple
									apps={[app]}
									declared={spec.data}
									allowTyped
									heading="This app's casebooks"
									emptyTitle="No dataset"
									emptyHint="The steps gather or fetch their own data each run."
									value={data.map((id): DatasetRef => ({ group: id, label: id }))}
									onChange={(next) => setData([...new Set(next.map((r) => r.group))])}
								/>
							</section>

							{/* 3 · Compute */}
							<section aria-label="Compute" className="space-y-3">
								<SectionTitle n={3} title="Compute" hint={parent ? `Starts from where ${wfName(parent)} runs.` : undefined} />
								<ComputePicker value={compute} onChange={setCompute} inheritedLabel={spec.compute.site ? `App default (${spec.compute.site})` : "App default"} />
							</section>

							{/* 4 · Feedback & metrics */}
							<section aria-label="Feedback and metrics" className="space-y-3">
								<SectionTitle n={4} title="Feedback & metrics" hint={parent ? `Inherited from ${wfName(parent)}; change what this one is judged on.` : "What judges each run, and which way is better."} />
								<FeedbackEditor value={feedback} onChange={setFeedback} />
							</section>

							{/* 5 · Name and node */}
							<section aria-label="Name and node" className="space-y-3">
								<SectionTitle n={5} title="Name and node" />
								<div className="space-y-3">
									{rows.map((r, i) => (
										<VariantRowEditor
											key={i}
											index={i}
											row={r}
											count={rows.length}
											problem={idProblem(r.id.trim(), taken, rows.slice(0, i).map((x) => x.id.trim()))}
											parentInputs={parent?.inputs ?? {}}
											onChange={(next) => setRows(rows.map((x, j) => (j === i ? next : x)))}
											onRemove={() => setRows(rows.filter((_, j) => j !== i))}
										/>
									))}
									{parent && (
										<button
											type="button"
											onClick={() => setRows([...rows, { id: suggestId(parent.id, [...taken, ...rows.map((x) => x.id)]), title: "", inputs: inputRowsFrom(parent.inputs) }])}
											className="inline-flex items-center gap-1 text-caption text-gold-700 hover:text-gold-800 font-medium"
										>
											<Plus className="w-3.5 h-3.5" />Another variant
										</button>
									)}
									{rows.length > 1 && (
										<p className="text-caption text-ink-600">All {rows.length} share the change, data, compute, feedback and node above; each keeps its own id and inputs.</p>
									)}
								</div>

								<fieldset className="space-y-2">
									<legend className="text-caption font-medium text-ink-700 mb-1">Where it goes on the map</legend>
									{parent && (
										<Choice name="placement" checked={placementMode === "new"} onPick={() => setPlacementMode("new")}>
											<span className="flex-1 flex flex-wrap items-center gap-2">
												A new node named
												<input
													value={nodeTitle}
													onChange={(e) => setNodeTitle(e.target.value)}
													onFocus={() => setPlacementMode("new")}
													aria-label="New node name"
													className={cn(field, "w-auto flex-1 min-w-40 py-1")}
												/>
												<span className="text-ink-600">under {wfName(parent)}</span>
											</span>
										</Choice>
									)}
									<Choice name="placement" checked={placementMode === "under"} onPick={() => setPlacementMode("under")}>
										{parent ? <>Directly under {wfName(parent)}</> : <>At the top, beside the app's other workflows</>}
									</Choice>
									{spec.nodes.length > 0 && (
										<Choice name="placement" checked={placementMode === "into"} onPick={() => setPlacementMode("into")}>
											<span className="flex-1 flex flex-wrap items-center gap-2">
												Into the node
												<select
													value={intoNode}
													onChange={(e) => { setIntoNode(e.target.value); setPlacementMode("into"); }}
													aria-label="Existing node"
													className={cn(field, "w-auto py-1")}
												>
													{spec.nodes.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
												</select>
											</span>
										</Choice>
									)}
								</fieldset>
							</section>
						</>
					)}
				</div>

				<footer className="border-t border-ink-200 px-5 py-3 space-y-2 bg-ink-50/60">
					{error && <p role="alert" className="text-caption text-brick-700">{error}</p>}
					{!error && blocked && change !== "describe" && <p className="text-caption text-ink-600">{blocked}</p>}
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
						{change === "describe" ? (
							<Button variant="accent" size="sm" onClick={askChat}>
								<MessagesSquare className="w-3.5 h-3.5" />Send to the chat
							</Button>
						) : (
							<Button variant="accent" size="sm" onClick={create} disabled={busy || !!blocked}>
								{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
								{parent ? (rows.length > 1 ? `Create ${rows.length} variants` : "Create variant") : "Create workflow"}
							</Button>
						)}
					</div>
				</footer>
			</DialogContent>
		</Dialog>
	);
}

// ── pieces ───────────────────────────────────────────────────────────────

function SectionTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
	return (
		<div>
			<h3 className="flex items-center gap-2 text-body font-semibold text-ink-900">
				<span className="w-5 h-5 rounded-full bg-ink-100 text-ink-700 text-micro flex items-center justify-center tabular-nums">{n}</span>
				{title}
			</h3>
			{hint && <p className="text-caption text-ink-600 mt-0.5 ml-7">{hint}</p>}
		</div>
	);
}

function Choice({ name, checked, onPick, children }: { name: string; checked: boolean; onPick: () => void; children: ReactNode }) {
	return (
		<label className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-meta text-ink-800 cursor-pointer", checked ? "border-gold-300 bg-gold-50/60" : "border-ink-200 bg-card hover:border-gold-200")}>
			<input type="radio" name={name} checked={checked} onChange={onPick} className="accent-gold-700" />
			{children}
		</label>
	);
}

function Waiting({ loaded, what }: { loaded: Loaded; what: string }) {
	if (loaded.state === "loading") return <p className="text-caption text-ink-600 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Reading {what}…</p>;
	if (loaded.state === "error") return <p role="alert" className="text-caption text-brick-700">{loaded.why}</p>;
	return null;
}

function StepsPane({ parent, loaded, value, onChange, onUseCode }: {
	parent?: SpecWorkflow; loaded: Loaded; value: string; onChange: (t: string) => void; onUseCode: () => void;
}) {
	// A Python workflow: its steps are its code — show them, don't pretend they're a graph.
	if (parent && !parent.steps.dag) {
		if (!parent.steps.python) {
			return <p className="text-caption text-ink-600">{parent.steps.skills?.length ? `This workflow's steps are the skills ${parent.steps.skills.join(", ")}; they aren't a graph you can edit here. Describe the change instead.` : "This workflow doesn't declare its steps, so there is nothing to edit here."}</p>;
		}
		return (
			<div className="space-y-2">
				<p className="text-caption text-ink-600">
					{wfName(parent)}'s steps are Python code (<code>{codePath(parent.steps.python)}</code>), not a step graph. Here they are, read-only.{" "}
					<button type="button" onClick={onUseCode} className="text-gold-700 hover:text-gold-800 font-medium underline-offset-2 hover:underline">Edit the code instead</button>
				</p>
				<Waiting loaded={loaded} what="the code" />
				{loaded.state === "ok" && (
					<pre aria-label="The steps (read-only)" className="max-h-80 overflow-auto rounded-lg border border-ink-200 bg-ink-50 p-3 font-mono text-caption text-ink-800 whitespace-pre">{loaded.text}</pre>
				)}
			</div>
		);
	}
	return (
		<div className="space-y-2">
			<p className="text-caption text-ink-600">
				{parent?.steps.dag
					? <>Starts as a copy of <code>{dagPath(parent.steps.dag)}</code>. Saved as the variant's own file; the original is untouched.</>
					: <>Add steps with + Add, connect them, and set each one in the panel.</>}
			</p>
			<Waiting loaded={loaded} what="the steps" />
			{loaded.state === "ok" && (
				<div className="h-96 rounded-xl border border-ink-200 overflow-hidden bg-card">
					<Suspense fallback={<p className="p-3 text-caption text-ink-600 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Opening the editor…</p>}>
						<WorkflowEditor value={value || loaded.text} onChange={onChange} height="100%" />
					</Suspense>
				</div>
			)}
			{loaded.state === "ok" && value !== loaded.text && <p className="text-caption text-ink-600">Changed from the original.</p>}
		</div>
	);
}

function CodePane({ parent, loaded, value, onChange, canSave, newPath }: {
	parent?: SpecWorkflow; loaded: Loaded; value: string; onChange: (t: string) => void; canSave: boolean; newPath: string;
}) {
	return (
		<div className="space-y-2">
			<p className="text-caption text-ink-600">
				{parent?.steps.python
					? <>Starts as a copy of <code>{codePath(parent.steps.python)}</code>; saved as <code>{newPath}</code>. The original is untouched.</>
					: parent
						? <>{wfName(parent)}'s steps are a step graph, not Python, so this starts from a blank Python step, saved as <code>{newPath}</code>.</>
						: <>One Python step, saved as <code>{newPath}</code>.</>}
			</p>
			{!canSave && (
				<p className="text-caption text-ember-700">Only admins can save code, because a Python step runs on the machines as written. You can read it here; to change it, describe the change and an admin can approve it.</p>
			)}
			<Waiting loaded={loaded} what="the code" />
			{loaded.state === "ok" && (
				<textarea
					value={value}
					onChange={(e) => onChange(e.target.value)}
					readOnly={!canSave}
					spellCheck={false}
					aria-label="Python code"
					rows={18}
					className="w-full rounded-lg border border-ink-200 bg-ink-50 p-3 font-mono text-caption text-ink-900 leading-relaxed resize-y focus:outline-none focus:ring-4 focus:ring-gold-400/15 focus:border-gold-400 whitespace-pre"
					onKeyDown={(e) => {
						// Tab indents instead of leaving the editor.
						if (e.key !== "Tab" || !canSave) return;
						e.preventDefault();
						const t = e.currentTarget, s = t.selectionStart, end = t.selectionEnd;
						const next = value.slice(0, s) + "    " + value.slice(end);
						onChange(next);
						requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; });
					}}
				/>
			)}
		</div>
	);
}

function FeedbackEditor({ value, onChange }: { value: FeedbackStep[]; onChange: (v: FeedbackStep[]) => void }) {
	const setStep = (i: number, patch: Partial<FeedbackStep>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
	return (
		<div className="space-y-2">
			{value.length === 0 && <p className="text-caption text-ink-600">No feedback yet — runs finish without a score.</p>}
			{value.map((f, i) => (
				<div key={i} className="rounded-xl border border-ink-200 bg-card p-3 space-y-2">
					<div className="flex items-center gap-2">
						<label className="text-caption text-ink-600 shrink-0" htmlFor={`fb-step-${i}`}>Feedback from</label>
						<input id={`fb-step-${i}`} value={f.step} onChange={(e) => setStep(i, { step: e.target.value })} placeholder="e.g. sandbox" className={cn(field, "py-1")} />
						<button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove the feedback from ${f.step || "this step"}`} className="p-1.5 text-ink-600 hover:text-brick-700 rounded">
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					</div>
					{f.metrics.map((m, k) => {
						const setMetric = (patch: Partial<typeof m>) => setStep(i, { metrics: f.metrics.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
						return (
							<div key={k} className="flex flex-wrap items-center gap-2 pl-3">
								<input value={m.name} onChange={(e) => setMetric({ name: e.target.value })} placeholder="metric, e.g. ttft_p99_ms" aria-label="Metric name" className={cn(field, "py-1 flex-1 min-w-36")} />
								<select value={m.better} onChange={(e) => setMetric({ better: e.target.value as "higher" | "lower" })} aria-label="Which way is better" className={cn(field, "py-1 w-auto")}>
									<option value="higher">higher is better</option>
									<option value="lower">lower is better</option>
								</select>
								<input
									type="number"
									value={m.target ?? ""}
									onChange={(e) => setMetric({ target: e.target.value === "" ? undefined : Number(e.target.value) })}
									placeholder="aim for (optional)"
									aria-label="Target"
									className={cn(field, "py-1 w-36")}
								/>
								<button type="button" onClick={() => setStep(i, { metrics: f.metrics.filter((_, j) => j !== k) })} aria-label={`Remove ${m.name || "this metric"}`} className="p-1.5 text-ink-600 hover:text-brick-700 rounded">
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						);
					})}
					<button type="button" onClick={() => setStep(i, { metrics: [...f.metrics, { name: "", better: "higher" }] })} className="ml-3 inline-flex items-center gap-1 text-caption text-gold-700 hover:text-gold-800 font-medium">
						<Plus className="w-3.5 h-3.5" />Add a metric
					</button>
				</div>
			))}
			<button type="button" onClick={() => onChange([...value, { step: "", metrics: [{ name: "", better: "higher" }] }])} className="inline-flex items-center gap-1 text-caption text-gold-700 hover:text-gold-800 font-medium">
				<Plus className="w-3.5 h-3.5" />Add a feedback step
			</button>
		</div>
	);
}

function VariantRowEditor({ index, row, count, problem, parentInputs, onChange, onRemove }: {
	index: number; row: VariantRow; count: number; problem: string | null; parentInputs: Record<string, unknown>;
	onChange: (r: VariantRow) => void; onRemove: () => void;
}) {
	const setInput = (k: number, patch: Partial<InputRow>) => onChange({ ...row, inputs: row.inputs.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
	const idId = `variant-id-${index}`;
	return (
		<div className="rounded-xl border border-ink-200 bg-card p-3 space-y-2.5">
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<div>
					<label htmlFor={idId} className="text-caption font-medium text-ink-700">Id</label>
					<input
						id={idId}
						value={row.id}
						onChange={(e) => onChange({ ...row, id: e.target.value.toLowerCase().replace(/[\s-]+/g, "_") })}
						aria-invalid={!!problem}
						className={cn(field, "mt-1 font-mono", problem && "border-brick-500")}
					/>
					{problem && <p className="text-caption text-brick-700 mt-1">{problem}</p>}
				</div>
				<div>
					<label htmlFor={`${idId}-title`} className="text-caption font-medium text-ink-700">Title <span className="font-normal text-ink-600">· optional</span></label>
					<input id={`${idId}-title`} value={row.title} onChange={(e) => onChange({ ...row, title: e.target.value })} placeholder="What people see on the map" className={cn(field, "mt-1")} />
				</div>
			</div>
			<div>
				<div className="text-caption font-medium text-ink-700 mb-1">Inputs</div>
				{row.inputs.length === 0 && <p className="text-caption text-ink-600">No inputs.</p>}
				<div className="space-y-1.5">
					{row.inputs.map((inp, k) => {
						const inherited = inp.key.trim() in parentInputs;
						return (
							<div key={k} className="flex items-center gap-2">
								<input value={inp.key} onChange={(e) => setInput(k, { key: e.target.value })} placeholder="name" aria-label="Input name" className={cn(field, "py-1 w-40 font-mono")} />
								<input value={inp.value} onChange={(e) => setInput(k, { value: e.target.value })} placeholder="value" aria-label={`Value of ${inp.key || "this input"}`} className={cn(field, "py-1 flex-1 font-mono")} />
								<button type="button" onClick={() => onChange({ ...row, inputs: row.inputs.filter((_, j) => j !== k) })} aria-label={`Remove ${inp.key || "this input"}`} title={inherited ? "Leave it out: the steps use their own default" : undefined} className="p-1.5 text-ink-600 hover:text-brick-700 rounded">
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						);
					})}
				</div>
				<div className="flex items-center gap-3 mt-1.5">
					<button type="button" onClick={() => onChange({ ...row, inputs: [...row.inputs, { key: "", value: "" }] })} className="inline-flex items-center gap-1 text-caption text-gold-700 hover:text-gold-800 font-medium">
						<Plus className="w-3.5 h-3.5" />Add an input
					</button>
					{count > 1 && (
						<button type="button" onClick={onRemove} className="ml-auto inline-flex items-center gap-1 text-caption text-ink-600 hover:text-brick-700">
							<Trash2 className="w-3.5 h-3.5" />Remove this variant
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

export default VariantSheet;
