// Edit a workflow's whole shape where it is drawn (2026-11-28, operator: "i saw
// workflow dag module, but cant edit"). The workflow page's Setup tab drew
// Data → Steps → Measured by (or a chain's stages) with no way to change them;
// this is the Edit behind that drawing.
//
// What it changes: the steps (a chain's stages, a skills list, which Python
// module or step file it runs, and that file's content — Python for admins
// only, as identity enforces), its data, inputs and where it runs. Measured-by
// stays in the feedback editor below it. When it starts is left alone: new and
// edited workflows run when you press Run (round 8, manual dispatch).
//
// One save: the spec edit and the steps file go in one PUT with base_sha, so a
// half-saved workflow can't happen (useAppGraph.save retries a 409 once).

import { lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { me } from "@/api/me";
import { AuthContext } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { DatasetPicker, type DatasetRef } from "@/components/data/DatasetPicker";
import { ComputePicker } from "@/components/compute/ComputePicker";
import type { AppSpec, SpecWorkflow } from "@/lib/app-spec";
import { plainCause } from "@/lib/activity";
import { loopLabel } from "@/lib/workflow-names";
import { readShape, setWorkflowShape, shapeChanged, shapeProblems, shapeSavedWords, stepsFile, type WorkflowShape } from "@/lib/workflow-shape";
import { cn } from "@/lib/utils";

const WorkflowEditor = lazy(() => import("@/workflow/WorkflowEditor"));

type Loaded = { state: "idle" } | { state: "loading" } | { state: "ok"; text: string; sha: string; editable: boolean } | { state: "missing" } | { state: "error"; why: string };

const field = "h-7 min-w-0 rounded-md border border-ink-200 bg-card px-2 text-caption text-ink-900 disabled:bg-ink-50 disabled:text-ink-600";
const iconBtn = "rounded p-1 text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40 disabled:hover:bg-transparent";

function move<T>(xs: T[], i: number, by: number): T[] {
	const j = i + by;
	if (j < 0 || j >= xs.length) return xs;
	const out = [...xs];
	[out[i], out[j]] = [out[j], out[i]];
	return out;
}

export default function WorkflowShapeEditor({ app, wf, spec, save, onDone }: {
	app: string; wf: SpecWorkflow; spec: AppSpec;
	save: (edit: (t: string) => string, files?: Array<{ path: string; content: string }>) => Promise<unknown>;
	onDone: () => void;
}) {
	const role = useContext(AuthContext)?.user?.role;
	const isAdmin = role === "admin" || role === "super_admin";
	const start = useMemo(() => readShape(wf), [wf]);
	const [draft, setDraft] = useState<WorkflowShape>(start);
	const [saving, setSaving] = useState(false);
	const set = (patch: Partial<WorkflowShape>) => setDraft((d) => ({ ...d, ...patch }));

	// The steps file, read once; edits to its text are saved with the spec.
	const startFile = stepsFile(start);
	const [file, setFile] = useState<Loaded>({ state: "idle" });
	const [fileText, setFileText] = useState("");
	useEffect(() => {
		if (!startFile) return;
		let live = true;
		setFile({ state: "loading" });
		me.appFile(app, startFile)
			.then((r) => { if (!live) return; setFile({ state: "ok", text: r.content, sha: r.sha, editable: r.editable }); setFileText(r.content); })
			.catch((e) => {
				if (!live) return;
				const status = (e as { status?: number }).status;
				setFile(status === 404 ? { state: "missing" } : { state: "error", why: `Couldn't read ${startFile}: ${plainCause((e as Error)?.message)}` });
			});
		return () => { live = false; };
	}, [app, startFile]);

	const fileChanged = file.state === "ok" && fileText !== file.text;
	const isPython = draft.kind === "python";
	// Python runs on the machines as written: identity takes it from admins only.
	const canEditFile = file.state === "ok" && file.editable && (!isPython || isAdmin);
	const problems = shapeProblems(draft, spec, wf.id);
	const changed = shapeChanged(start, draft) || fileChanged;
	const stageChoices = spec.workflows.filter((w) => w.id !== wf.id && !w.steps.workflows?.length);

	const onSave = async () => {
		setSaving(true);
		try {
			const path = stepsFile(draft);
			const files: Array<{ path: string; content: string; base_sha?: string }> = [];
			if (fileChanged && path && file.state === "ok") files.push({ path, content: fileText, ...(path === startFile ? { base_sha: file.sha } : {}) });
			await save((t) => setWorkflowShape(t, wf.id, draft), files.length ? files : undefined);
			toast.success(shapeSavedWords(start, draft, files.length > 0));
			onDone();
		} catch (e) {
			const status = (e as { status?: number }).status;
			toast.error("Couldn't save the workflow", { description: status === 409 ? "It changed while you were editing — close and open it again to see the newest version." : plainCause(String((e as Error)?.message ?? e)) });
		} finally { setSaving(false); }
	};

	return (
		<div className="space-y-4" data-shape-editor>
			{/* Steps */}
			<section aria-label="Steps" className="space-y-2">
				<h3 className="eyebrow">Steps</h3>
				{draft.kind === "chain" && (
					<div className="space-y-1.5">
						<p className="text-micro text-ink-600">The stages run in this order. Each gets the results of the stage before it, and the chain ends at the first one that fails or misses its gate.</p>
						<ol className="space-y-1">
							{draft.stages.map((st, i) => (
								<li key={i} className="flex items-center gap-1.5">
									<span className="w-14 shrink-0 text-micro text-ink-600">Stage {i + 1}</span>
									<select aria-label={`Stage ${i + 1}`} value={st.use} onChange={(e) => set({ stages: draft.stages.map((x, j) => (j === i ? { use: e.target.value, inputs: x.use === e.target.value ? x.inputs : {} } : x)) })} className={cn(field, "flex-1")}>
										<option value="">Pick a workflow…</option>
										{stageChoices.map((w) => <option key={w.id} value={w.id}>{w.title || loopLabel("", w.id)}</option>)}
										{st.use && !stageChoices.some((w) => w.id === st.use) && <option value={st.use}>{st.use}</option>}
									</select>
									{Object.keys(st.inputs).length > 0 && <span className="max-w-[9rem] truncate font-mono text-micro text-ink-600" title={Object.entries(st.inputs).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}>{Object.keys(st.inputs).length} input{Object.keys(st.inputs).length === 1 ? "" : "s"} set</span>}
									<button type="button" aria-label={`Move stage ${i + 1} up`} disabled={i === 0} onClick={() => set({ stages: move(draft.stages, i, -1) })} className={iconBtn}><ArrowUp className="h-3.5 w-3.5" /></button>
									<button type="button" aria-label={`Move stage ${i + 1} down`} disabled={i === draft.stages.length - 1} onClick={() => set({ stages: move(draft.stages, i, 1) })} className={iconBtn}><ArrowDown className="h-3.5 w-3.5" /></button>
									<button type="button" aria-label={`Remove stage ${i + 1}`} onClick={() => set({ stages: draft.stages.filter((_, j) => j !== i) })} className={cn(iconBtn, "hover:text-brick-700")}><X className="h-3.5 w-3.5" /></button>
								</li>
							))}
						</ol>
						<button type="button" onClick={() => set({ stages: [...draft.stages, { use: "", inputs: {} }] })} className="inline-flex items-center gap-1 text-caption text-ink-700 hover:text-ink-900"><Plus className="h-3.5 w-3.5" />Add a stage</button>
					</div>
				)}
				{draft.kind === "skills" && (
					<div className="space-y-1.5">
						<p className="text-micro text-ink-600">The skills it uses, in order.</p>
						{draft.skills.map((k, i) => (
							<div key={i} className="flex items-center gap-1.5">
								<input aria-label={`Skill ${i + 1}`} value={k} onChange={(e) => set({ skills: draft.skills.map((x, j) => (j === i ? e.target.value : x)) })} className={cn(field, "flex-1 font-mono text-micro")} />
								<button type="button" aria-label={`Move skill ${i + 1} up`} disabled={i === 0} onClick={() => set({ skills: move(draft.skills, i, -1) })} className={iconBtn}><ArrowUp className="h-3.5 w-3.5" /></button>
								<button type="button" aria-label={`Move skill ${i + 1} down`} disabled={i === draft.skills.length - 1} onClick={() => set({ skills: move(draft.skills, i, 1) })} className={iconBtn}><ArrowDown className="h-3.5 w-3.5" /></button>
								<button type="button" aria-label={`Remove skill ${i + 1}`} onClick={() => set({ skills: draft.skills.filter((_, j) => j !== i) })} className={cn(iconBtn, "hover:text-brick-700")}><X className="h-3.5 w-3.5" /></button>
							</div>
						))}
						<button type="button" onClick={() => set({ skills: [...draft.skills, ""] })} className="inline-flex items-center gap-1 text-caption text-ink-700 hover:text-ink-900"><Plus className="h-3.5 w-3.5" />Add a skill</button>
					</div>
				)}
				{(draft.kind === "python" || draft.kind === "dag") && (
					<div className="space-y-2">
						<label className="flex items-center gap-1.5 text-caption">
							<span className="w-24 shrink-0 text-ink-600">{isPython ? "Python module" : "Step file"}</span>
							{isPython
								? <span className="flex min-w-0 flex-1 items-center gap-1 font-mono text-micro text-ink-700">commands/<input aria-label="Python module" value={draft.python} onChange={(e) => set({ python: e.target.value })} className={cn(field, "w-40 font-mono text-micro")} />.py</span>
								: <input aria-label="Step file" value={draft.dag} onChange={(e) => set({ dag: e.target.value })} className={cn(field, "flex-1 font-mono text-micro")} />}
						</label>
						{stepsFile(draft) !== startFile && <p className="text-micro text-ink-600">It will run <code className="font-mono">{stepsFile(draft)}</code>{fileChanged ? ", saved with your edits below" : " as that file is now"}. <code className="font-mono">{startFile}</code> is kept.</p>}
						{file.state === "loading" && <p className="flex items-center gap-1.5 text-caption text-ink-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading {startFile}…</p>}
						{file.state === "error" && <p role="alert" className="text-caption text-brick-700">{file.why}</p>}
						{file.state === "missing" && <p className="text-caption text-ink-600"><code className="font-mono">{startFile}</code> isn&apos;t in this app&apos;s files, so there is nothing to edit here.</p>}
						{file.state === "ok" && !canEditFile && (
							<p className="text-micro text-ink-600">{isPython && !isAdmin
								? "Only admins can change Python steps, because they run on the machines as written. Ask in the chat to have one changed."
								: "This file can't be changed from here."}</p>
						)}
						{file.state === "ok" && isPython && (
							<textarea aria-label={`The code of ${startFile}`} value={fileText} readOnly={!canEditFile} onChange={(e) => setFileText(e.target.value)} spellCheck={false}
								className={cn("h-80 w-full resize-y rounded-lg border border-ink-200 p-2.5 font-mono text-micro leading-relaxed text-ink-900", canEditFile ? "bg-card" : "bg-ink-50")} />
						)}
						{file.state === "ok" && !isPython && (
							<div className="h-96 overflow-hidden rounded-xl border border-ink-200 bg-card">
								<Suspense fallback={<p className="flex items-center gap-1.5 p-3 text-caption text-ink-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />Opening the editor…</p>}>
									<WorkflowEditor value={fileText} onChange={setFileText} readOnly={!canEditFile} height="100%" />
								</Suspense>
							</div>
						)}
						{fileChanged && <p className="text-micro text-ink-600">Changed from the saved file.</p>}
					</div>
				)}
				{draft.kind === "none" && <p className="text-caption text-ink-600">It declares no steps. Add some with Make a variant, or in Manage → Spec.</p>}
			</section>

			{/* Data */}
			<section aria-label="Data" className="space-y-2">
				<h3 className="eyebrow">Data</h3>
				<DatasetPicker
					multiple
					apps={[app]}
					declared={spec.data}
					allowTyped
					heading="This app's casebooks"
					emptyTitle="No dataset"
					emptyHint="The steps gather or fetch their own data each run."
					value={draft.data.map((id): DatasetRef => ({ group: id, label: id }))}
					onChange={(next) => set({ data: [...new Set(next.map((r) => r.group))] })}
				/>
			</section>

			{/* Inputs */}
			<section aria-label="Inputs" className="space-y-1.5">
				<h3 className="eyebrow">Inputs</h3>
				<p className="text-micro text-ink-600">What each run is given. A version or a chain stage can set its own value; this is the default.</p>
				{draft.inputs.map((inp, i) => (
					<div key={i} className="flex items-center gap-1.5">
						<input aria-label={`Input ${i + 1} name`} value={inp.name} placeholder="name" onChange={(e) => set({ inputs: draft.inputs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className={cn(field, "w-36 font-mono text-micro")} />
						<input aria-label={`Input ${i + 1} default`} value={inp.value} placeholder="no default" onChange={(e) => set({ inputs: draft.inputs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} className={cn(field, "flex-1 text-micro")} />
						<button type="button" aria-label={`Remove input ${inp.name || i + 1}`} onClick={() => set({ inputs: draft.inputs.filter((_, j) => j !== i) })} className={cn(iconBtn, "hover:text-brick-700")}><X className="h-3.5 w-3.5" /></button>
					</div>
				))}
				<button type="button" onClick={() => set({ inputs: [...draft.inputs, { name: "", value: "" }] })} className="inline-flex items-center gap-1 text-caption text-ink-700 hover:text-ink-900"><Plus className="h-3.5 w-3.5" />Add an input</button>
			</section>

			{/* Where it runs */}
			<section aria-label="Where it runs" className="space-y-2">
				<h3 className="eyebrow">Where it runs</h3>
				<ComputePicker value={{ site: draft.site || undefined, gpu: draft.gpu || undefined }} onChange={(c) => set({ site: c.site ?? "", gpu: c.gpu ?? "" })}
					inheritedLabel={spec.compute.site ? `App default (${spec.compute.site})` : "App default"} />
				<label className="flex items-center gap-1.5 text-caption">
					<span className="w-24 shrink-0 text-ink-600">Memory cap</span>
					<input aria-label="Memory cap" value={draft.memory} placeholder="default (3Gi)" onChange={(e) => set({ memory: e.target.value })} className={cn(field, "w-28 font-mono text-micro")} />
					<span className="text-micro text-ink-600">for each run, e.g. 512Mi or 2Gi</span>
				</label>
			</section>

			{problems.length > 0 && changed && (
				<ul role="alert" className="space-y-0.5 text-caption text-brick-700">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
			)}
			<div className="flex items-center gap-2 border-t border-ink-100 pt-3">
				<p className="text-micro text-ink-600">How each run is measured is set under Feedback, below.</p>
				<Button size="sm" variant="secondary" className="ml-auto" onClick={onDone} disabled={saving}>Cancel</Button>
				<Button size="sm" onClick={onSave} disabled={!changed || problems.length > 0 || saving}>{saving ? "Saving…" : "Save"}</Button>
			</div>
		</div>
	);
}
