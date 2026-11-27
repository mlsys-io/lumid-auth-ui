// WorkflowSheet — "New workflow": one sheet, and nothing runs.
//
// It asks one question first — how is it made?
//   · Write its steps: VariantSheet's sections with no parent (steps or code,
//     data, compute, feedback, name and node) — VariantSheetBody, reused.
//   · Chain other workflows: workflows this app already has, run in order,
//     each passing its results to the next (`steps: {workflows: [...]}`).
//     Shown only once the engine that runs a chain is live for this browser
//     (localStorage lumid:chain-workflows = 1) or the app already has a chain;
//     otherwise the card says "Coming soon".
//   · or describe it in chat: pre-fills the chat (the person presses send).
//
// Before saving it says what will happen ("Creates ‘X’ in <app>. It runs only
// when you press Run."). Saving is ONE spec edit through lib/app-spec
// addWorkflows (always `run: manual`) and useAppGraph's save. No run request
// is ever made from here.
//
// Opened by the app's research home: see ./new-workflow (openNewWorkflow,
// useNewWorkflowRequests, useNewWorkflowParam for ?new=1).

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, GitBranch, Link2, Loader2, MessagesSquare, Plus, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { appTitle } from "@/components/workflow/AppCard";
import { useAppGraph } from "@/hooks/useAppGraph";
import { addWorkflows, nodeIdFrom, type AppSpec, type FeedbackStep, type SpecWorkflow } from "@/lib/app-spec";
import {
	buildChain, chainEnabled, chainFeedback, chainRowFor, chainable, createdToast, createsSentence, idProblem,
	newWorkflowChatPrompt, newWorkflowName, passesOn, saveErrorWords, type ChainRow,
} from "@/lib/variant-form";
import { Choice, FeedbackEditor, InputRowsEditor, SHEET_CLASS, SectionTitle, VariantSheetBody, field, type VariantSheetProps } from "./VariantSheet";

export { openNewWorkflow, newWorkflowPath, useNewWorkflowParam, useNewWorkflowRequests, NEW_WORKFLOW_EVENT } from "./new-workflow";

type Save = VariantSheetProps["save"];

export interface WorkflowSheetProps {
	app: string;
	/** The app's spec and useAppGraph's save. Leave both out and the sheet reads them itself. */
	spec?: AppSpec;
	save?: Save;
	onClose: () => void;
	/** Called with the new workflow's id once it is saved (select it on the graph). */
	onCreated?: (id: string) => void;
	/** Open straight on one path instead of the question. */
	start?: Step;
}

type Step = "choose" | "steps" | "chain";

const CHAIN_FLAG = "lumid:chain-workflows";
function chainOptedIn(): boolean {
	try { return localStorage.getItem(CHAIN_FLAG) === "1"; } catch { return false; }
}

const wfName = (w: SpecWorkflow) => newWorkflowName(w.id, w.title);

export function WorkflowSheet(props: WorkflowSheetProps) {
	if (props.spec && props.save) return <Sheet {...props} spec={props.spec} save={props.save} />;
	return <SheetReadingSpec {...props} />;
}

/** Without a spec handed in: read it (the same cache the graph uses). */
function SheetReadingSpec(props: WorkflowSheetProps) {
	const { graph, error, save } = useAppGraph(props.app);
	if (graph && !error) return <Sheet {...props} spec={graph.spec} save={save} />;
	return (
		<Shell title="New workflow" subtitle="It runs only when you press Run." busy={false} onClose={props.onClose}>
			<div className="flex-1 px-5 py-4">
				{error
					? <p role="alert" className="text-caption text-brick-700">{error} — close this and try again.</p>
					: <p className="text-caption text-ink-600 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Reading the app…</p>}
			</div>
		</Shell>
	);
}

function Shell({ title, subtitle, busy, onClose, children }: { title: string; subtitle: string; busy: boolean; onClose: () => void; children: ReactNode }) {
	return (
		<Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
			<DialogContent aria-label={title} data-workflow-sheet onInteractOutside={(e) => { if (busy) e.preventDefault(); }} className={SHEET_CLASS}>
				<header className="px-5 pt-5 pb-3 border-b border-ink-200 pr-12">
					<DialogTitle className="font-display text-h3 text-ink-900 font-normal">{title}</DialogTitle>
					<DialogDescription className="text-caption text-ink-600 mt-1">{subtitle}</DialogDescription>
				</header>
				{children}
			</DialogContent>
		</Dialog>
	);
}

function Sheet({ app, spec, save, onClose, onCreated, start = "choose" }: WorkflowSheetProps & { spec: AppSpec; save: Save }) {
	const appName = spec.title || appTitle(app);
	const canChain = chainEnabled(spec, chainOptedIn());
	const pool = chainable(spec);
	const [step, setStep] = useState<Step>(start === "chain" && !canChain ? "choose" : start);
	const [busy, setBusy] = useState(false);

	const askChat = () => {
		window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: newWorkflowChatPrompt(appName), context: { app } } }));
		toast.success("It's in the chat — press send, then approve the proposal.");
		onClose();
	};

	const subtitle = step === "steps"
		? "Its steps, the data it reads, where it runs and what judges each run. It runs only when you press Run."
		: step === "chain"
			? "Workflows this app already has, run in order; each passes its results on to the next. It runs only when you press Run."
			: `Something ${appName} will measure the same way every time. It runs only when you press Run.`;

	return (
		<Shell title="New workflow" subtitle={subtitle} busy={busy} onClose={onClose}>
			{step === "choose" && (
				<>
					<div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
						<h3 className="text-body font-semibold text-ink-900">How is it made?</h3>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<PathCard
								path="steps" icon={WorkflowIcon} title="Write its steps"
								hint="Draw its steps on a graph (or write them as code), then pick its data, compute and feedback."
								onPick={() => setStep("steps")}
							/>
							<PathCard
								path="chain" icon={Link2} title="Chain other workflows"
								hint={pool.length
									? `Run workflows ${appName} already has, in order. Each passes its results to the next.`
									: `${appName} has no workflows to chain yet. Write one first.`}
								off={!canChain ? "Coming soon" : !pool.length ? "Nothing to chain yet" : undefined}
								onPick={() => setStep("chain")}
							/>
						</div>
						<button type="button" onClick={askChat} data-path="chat"
							className="inline-flex items-center gap-1.5 text-caption text-gold-700 hover:text-gold-800 font-medium underline-offset-2 hover:underline">
							<MessagesSquare className="w-3.5 h-3.5" />or describe it in chat
						</button>
					</div>
					<footer className="border-t border-ink-200 px-5 py-3 bg-ink-50/60 flex items-center justify-end">
						<Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
					</footer>
				</>
			)}
			{step === "steps" && (
				<VariantSheetBody
					app={app} spec={spec} save={save} appName={appName}
					onClose={onClose} onBack={() => setStep("choose")} onBusy={setBusy}
					onCreated={(ids) => { if (ids[0]) onCreated?.(ids[0]); }}
				/>
			)}
			{step === "chain" && (
				<ChainBuilder
					app={app} appName={appName} spec={spec} save={save}
					onClose={onClose} onBack={() => setStep("choose")} onBusy={setBusy} onCreated={onCreated}
				/>
			)}
		</Shell>
	);
}

function PathCard({ path, icon: Icon, title, hint, off, onPick }: {
	path: Step; icon: typeof GitBranch; title: string; hint: string; off?: string; onPick: () => void;
}) {
	return (
		<button
			type="button"
			data-path={path}
			disabled={!!off}
			aria-disabled={!!off}
			onClick={onPick}
			className={cn(
				"text-left rounded-xl border p-4 transition-colors sm:min-h-28 flex flex-col",
				off ? "border-ink-200 bg-ink-50 cursor-not-allowed" : "border-ink-200 bg-card hover:border-gold-300 hover:bg-gold-50/40 lumen-press",
			)}
		>
			<span className="flex items-center gap-2">
				<Icon className={cn("w-4 h-4", off ? "text-ink-500" : "text-gold-700")} aria-hidden />
				<span className={cn("text-body font-medium", off ? "text-ink-700" : "text-ink-900")}>{title}</span>
				{off && <span className="ml-auto rounded-full border border-ink-200 bg-card px-2 py-0.5 text-nano text-ink-700 whitespace-nowrap">{off}</span>}
			</span>
			<span className="block text-caption text-ink-600 mt-1.5">{hint}</span>
		</button>
	);
}

// ── Chain other workflows ────────────────────────────────────────────────

function ChainBuilder({ app, appName, spec, save, onClose, onBack, onBusy, onCreated }: {
	app: string; appName: string; spec: AppSpec; save: Save;
	onClose: () => void; onBack: () => void; onBusy: (b: boolean) => void; onCreated?: (id: string) => void;
}) {
	const pool = useMemo(() => chainable(spec), [spec]);
	const byId = useMemo(() => new Map(spec.workflows.map((w) => [w.id, w])), [spec.workflows]);
	const taken = useMemo(() => spec.workflows.map((w) => w.id), [spec.workflows]);
	const autoId = (t: string) => (t.trim() ? nodeIdFrom(t, taken).slice(0, 48) : nodeIdFrom("new chain", taken));

	const [stages, setStages] = useState<ChainRow[]>([]);
	const [title, setTitle] = useState("");
	const [id, setId] = useState(() => autoId(""));
	// Feedback follows the last stage until it is edited here.
	const [ownFeedback, setOwnFeedback] = useState<FeedbackStep[] | null>(null);
	const feedback = ownFeedback ?? chainFeedback(spec, stages);
	const [placementMode, setPlacementMode] = useState<"under" | "into">("under");
	const [intoNode, setIntoNode] = useState(spec.nodes[0]?.id ?? "");
	const [busy, setBusyState] = useState(false);
	const setBusy = (b: boolean) => { setBusyState(b); onBusy(b); };
	const [error, setError] = useState<string | null>(null);

	const name = newWorkflowName(id, title);
	const idWhy = idProblem(id.trim(), taken);
	const blocked = !stages.length ? "Add the first workflow to the chain." : idWhy ? idWhy : placementMode === "into" && !intoNode ? "Pick a node to put it in." : null;

	const move = (i: number, by: -1 | 1) => setStages((s) => {
		const j = i + by;
		if (j < 0 || j >= s.length) return s;
		const next = [...s];
		[next[i], next[j]] = [next[j], next[i]];
		return next;
	});

	const create = async () => {
		setError(null);
		let built;
		try {
			built = buildChain({ id, title, stages, feedback, placement: placementMode === "into" ? { mode: "into", node: intoNode } : { mode: "under" } }, spec);
		} catch (e) {
			setError((e as Error).message);
			return;
		}
		setBusy(true);
		try {
			await save((t) => addWorkflows(t, built.entries));
			toast.success(createdToast(name));
			onCreated?.(built.ids[0]);
			onClose();
		} catch (e) {
			setError(saveErrorWords(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
				<section aria-label="Workflows, in order" className="space-y-3">
					<SectionTitle n={1} title="Workflows, in order" hint="Each starts with its own inputs; change any for this stage." />
					{stages.length === 0 && (
						<p className="rounded-xl border border-dashed border-ink-300 px-3 py-4 text-caption text-ink-600 text-center">Nothing chained yet. Add the workflow that runs first.</p>
					)}
					<ol className="space-y-0" data-chain-stages>
						{stages.map((row, i) => {
							const w = byId.get(row.use);
							return (
								<li key={i} data-chain-stage={i + 1}>
									{i > 0 && <PassesOn {...passesOn(byId.get(stages[i - 1].use), w, i + 1)} />}
									<div className="rounded-xl border border-ink-200 bg-card p-3 space-y-2">
										<div className="flex items-center gap-2 min-w-0">
											<span className="w-5 h-5 rounded-full bg-ink-900 text-white text-micro flex items-center justify-center tabular-nums flex-shrink-0">{i + 1}</span>
											<span className="min-w-0 flex-1">
												<span className="block text-meta font-medium text-ink-900 truncate">{w ? wfName(w) : newWorkflowName(row.use)}</span>
												{w?.about && <span className="block text-micro text-ink-600 truncate">{w.about}</span>}
											</span>
											<span className="flex items-center flex-shrink-0">
												<IconButton label={`Move ${w ? wfName(w) : "this stage"} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></IconButton>
												<IconButton label={`Move ${w ? wfName(w) : "this stage"} down`} disabled={i === stages.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></IconButton>
												<IconButton label={`Remove ${w ? wfName(w) : "this stage"}`} danger onClick={() => setStages((s) => s.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></IconButton>
											</span>
										</div>
										<div className="pl-7">
											<div className="text-caption font-medium text-ink-700 mb-1">Inputs</div>
											<InputRowsEditor
												rows={row.inputs}
												own={w?.inputs ?? {}}
												onChange={(inputs) => setStages((s) => s.map((x, j) => (j === i ? { ...x, inputs } : x)))}
											/>
										</div>
									</div>
								</li>
							);
						})}
					</ol>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<label className="inline-flex items-center gap-1.5 text-caption text-gold-700 font-medium">
							<Plus className="w-3.5 h-3.5" aria-hidden />
							<span className="sr-only">Add a workflow</span>
							<select
								value=""
								aria-label="Add a workflow"
								data-chain-add
								onChange={(e) => {
									const w = byId.get(e.target.value);
									if (w) setStages((s) => [...s, chainRowFor(w)]);
								}}
								className={cn(field, "w-auto py-1 text-gold-700 font-medium")}
							>
								<option value="">{stages.length ? "Add a workflow" : "Add the first workflow"}</option>
								{pool.map((w) => <option key={w.id} value={w.id}>{wfName(w)}</option>)}
							</select>
						</label>
						<p className="ml-auto text-caption text-ink-700" data-chain-stops>Stops at the first stage that fails.</p>
					</div>
				</section>

				<section aria-label="Feedback and metrics" className="space-y-3">
					<SectionTitle n={2} title="Feedback & metrics" hint={ownFeedback ? "What judges each run of the chain." : "Starts as the last stage's: what judges each run of the chain."} />
					<FeedbackEditor value={feedback} onChange={setOwnFeedback} />
				</section>

				<section aria-label="Name and node" className="space-y-3">
					<SectionTitle n={3} title="Name and node" />
					<div className="rounded-xl border border-ink-200 bg-card p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
						<div>
							<label htmlFor="chain-title" className="text-caption font-medium text-ink-700">Title</label>
							<input id="chain-title" value={title} placeholder="e.g. Strategy, start to finish" className={cn(field, "mt-1")}
								onChange={(e) => { const t = e.target.value; if (id === autoId(title)) setId(autoId(t)); setTitle(t); }} />
						</div>
						<div>
							<label htmlFor="chain-id" className="text-caption font-medium text-ink-700">Id</label>
							<input id="chain-id" value={id} aria-invalid={!!idWhy}
								onChange={(e) => setId(e.target.value.toLowerCase().replace(/[\s-]+/g, "_"))}
								className={cn(field, "mt-1 font-mono", idWhy && "border-brick-500")} />
							{idWhy && <p className="text-caption text-brick-700 mt-1">{idWhy}</p>}
						</div>
					</div>
					{spec.nodes.length > 0 && (
						<fieldset className="space-y-2">
							<legend className="text-caption font-medium text-ink-700 mb-1">Where it goes on the map</legend>
							<Choice name="chain-placement" checked={placementMode === "under"} onPick={() => setPlacementMode("under")}>
								At the top, beside the app's other workflows
							</Choice>
							<Choice name="chain-placement" checked={placementMode === "into"} onPick={() => setPlacementMode("into")}>
								<span className="flex-1 flex flex-wrap items-center gap-2">
									Into the node
									<select value={intoNode} onChange={(e) => { setIntoNode(e.target.value); setPlacementMode("into"); }} aria-label="Existing node" className={cn(field, "w-auto py-1")}>
										{spec.nodes.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
									</select>
								</span>
							</Choice>
						</fieldset>
					)}
				</section>
			</div>

			<footer className="border-t border-ink-200 px-5 py-3 space-y-2 bg-ink-50/60">
				{error && <p role="alert" className="text-caption text-brick-700">{error}</p>}
				{!error && blocked && <p className="text-caption text-ink-600">{blocked}</p>}
				{!error && !blocked && <p data-creates className="text-caption text-ink-800">{createsSentence(name, appName)}</p>}
				<div className="flex items-center justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={onBack} disabled={busy} className="mr-auto">
						<ArrowLeft className="w-3.5 h-3.5" />Back
					</Button>
					<Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
					<Button variant="accent" size="sm" onClick={create} disabled={busy || !!blocked}>
						{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
						Create workflow
					</Button>
				</div>
			</footer>
		</>
	);
}

/** The line between two stages: what the next one can use, and what it does use. */
function PassesOn({ line, uses }: { line: string; uses: string[] }) {
	return (
		<div className="flex items-start gap-1.5 py-1.5 pl-3 text-caption text-ink-600" data-passes-on>
			<ArrowDown className="w-3.5 h-3.5 mt-0.5 text-plum-600 flex-shrink-0" aria-hidden />
			<span className="min-w-0">
				{line}
				{uses.length > 0 && (
					<span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-plum-50 px-1.5 py-px text-micro font-medium text-plum-700 align-middle" data-uses>
						<Link2 className="w-3 h-3" aria-hidden />uses {uses.join(", ")}
					</span>
				)}
			</span>
		</div>
	);
}

function IconButton({ label, disabled, danger, onClick, children }: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
			className={cn("p-1.5 rounded text-ink-600 disabled:opacity-40 disabled:cursor-not-allowed", danger ? "hover:text-brick-700" : "hover:text-ink-900 hover:bg-ink-100")}>
			{children}
		</button>
	);
}

export default WorkflowSheet;
