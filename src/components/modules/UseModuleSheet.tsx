// UseModuleSheet — "Use in a workflow": a new workflow whose one step is the
// module, `{id, title, run: manual, steps: {module, inputs}}` (lib/modules
// addModuleWorkflow, built on app-spec addWorkflows). It runs only when
// someone presses Run (round 8: nothing new starts on its own). A public
// module of another app is named by its owner-qualified name; this app's own
// by its id. Saved as ONE comment-preserving spec edit (base_sha).

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { workflowPath } from "@/lib/run-routes";
import { inputTemplate, parseTryInputs, saveErrorText, savesWords, stepModuleRef, addModuleWorkflow, workflowIdFrom } from "@/lib/modules";
import { FIELD, HINT, LABEL, MODULE_SHEET } from "./sheet";
import type { TryTarget } from "./TryModuleSheet";

export default function UseModuleSheet({ app, target, workflowIds, save, onClose, from }: {
	app: string;
	target: TryTarget;
	workflowIds: string[];
	save: (edit: (text: string) => string) => Promise<unknown>;
	onClose: () => void;
	/** The app another owner's public module comes from, by its title. */
	from?: string;
}) {
	const declared = useMemo(() => Object.fromEntries(target.inputs.map((i) => [i.name, i.words])), [target.inputs]);
	const [title, setTitle] = useState(target.title);
	const [text, setText] = useState(() => inputTemplate(declared));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<{ words: string; verbatim: boolean } | null>(null);
	const [made, setMade] = useState<string | null>(null);
	const id = useMemo(() => workflowIdFrom(title || target.title, workflowIds), [title, target.title, workflowIds]);
	const check = useMemo(() => parseTryInputs(text || "{}", declared), [text, declared]);
	const ref = stepModuleRef(app, target.name);

	const onAdd = async () => {
		if (!check.value) return;
		setBusy(true);
		setError(null);
		try {
			await save((t) => addModuleWorkflow(t, { id, title, module: ref, inputs: check.value }));
			setMade(id);
		} catch (e) {
			setError(saveErrorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
			<DialogContent aria-label="Use in a workflow" onInteractOutside={(e) => { if (busy) e.preventDefault(); }} className={MODULE_SHEET}>
				<header className="px-5 pt-5 pb-3 border-b border-ink-200 pr-12">
					<DialogTitle className="font-display text-h3 text-ink-900 font-normal">Use {target.title} in a workflow</DialogTitle>
					<DialogDescription className="text-caption text-ink-600 mt-1">
						A new workflow in this app whose one step is this module{from ? <>, from {from}, run as you</> : null}. Its numbers become the run&apos;s results, so feedback steps can read them.
					</DialogDescription>
				</header>

				{made ? (
					<div className="flex-1 px-5 py-6 space-y-3" data-testid="use-made">
						<p className="text-body text-ink-900">Added the workflow <span className="font-medium">{title || target.title}</span>.</p>
						<p className="text-caption text-ink-600">It runs only when you press Run.</p>
						<Button asChild variant="secondary"><Link to={workflowPath(app, made)}>Open the workflow</Link></Button>
					</div>
				) : (
					<div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
						<div>
							<label className={LABEL} htmlFor="use-title">Workflow name</label>
							<input id="use-title" className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
							<p className={HINT}>Saved as <code className="font-mono text-ink-800">{id}</code>.</p>
						</div>
						<div>
							<label className={LABEL} htmlFor="use-inputs">The step&apos;s inputs, as one JSON object</label>
							<textarea id="use-inputs" value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} disabled={busy}
								className={cn(FIELD, "font-mono text-caption leading-relaxed resize-y")} />
							{check.problem
								? <p className="text-micro text-brick-700 mt-1">{check.problem}</p>
								: <p className={HINT}>A run can change any of them. {check.notes.join(" ")}</p>}
						</div>
						{error && (
							<div role="alert" className="rounded-lg border border-brick-200 bg-brick-50 px-3 py-2 text-caption text-brick-700">
								{error.verbatim ? <><span className="font-medium">lum.id refused it:</span> <span className="whitespace-pre-wrap">{error.words}</span></> : error.words}
							</div>
						)}
					</div>
				)}

				<footer className="border-t border-ink-200 px-5 py-3 flex items-center gap-3">
					<p className="flex-1 text-micro text-ink-600">{made ? "" : savesWords(app, "workflow")}</p>
					<Button variant="ghost" onClick={onClose} disabled={busy}>{made ? "Done" : "Cancel"}</Button>
					{!made && (
						<Button onClick={onAdd} disabled={busy || !check.value} data-testid="use-add">
							{busy ? <Loader2 className="animate-spin" /> : <Plus />} Add workflow
						</Button>
					)}
				</footer>
			</DialogContent>
		</Dialog>
	);
}
