// ModuleSheet — register a compute module, or edit one.
//
// One form for the `modules:` entry identity runs (lib/modules): name, what
// it does, the pinned image and its command, the inputs it reads (name →
// words), limits (the clamp is shown as you type), and who reuses / may use
// it. Every check here is identity's own rule, in its words, so the form says
// before the save what the save would say. Save is ONE comment-preserving spec
// edit through useAppGraph's `save` (base_sha; a 409 re-reads and retries) —
// and if lum.id still refuses, its words are shown verbatim. Nothing runs.

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
	addModule, blankModuleForm, clampNoteWords, fixCountWords, digestCommand, entryFromForm, formFromEntry, formProblems, limitsPreview, moduleIdFrom,
	MODULE_MAX_CPU, MODULE_MAX_TIMEOUT_S, publicWords, saveErrorText, savesWords, shareWords, updateModule,
	type ModuleForm, type ModuleRef,
} from "@/lib/modules";
import { FIELD, HINT, LABEL, MODULE_SHEET } from "./sheet";

export interface ModuleSheetProps {
	app: string;
	/** The entry being edited, as written in the spec; absent = register a new one. */
	entry?: Record<string, unknown>;
	at?: ModuleRef;
	/** Ids the app's other modules already use. */
	takenIds: string[];
	/** useAppGraph's save: applies `edit` to the newest spec and writes it with base_sha. */
	save: (edit: (text: string) => string) => Promise<unknown>;
	onClose: () => void;
	onSaved?: (id: string) => void;
}

export default function ModuleSheet({ app, entry, at, takenIds, save, onClose, onSaved }: ModuleSheetProps) {
	const editing = !!entry;
	const [form, setForm] = useState<ModuleForm>(() => (entry ? formFromEntry(entry) : blankModuleForm()));
	// The id follows the title until it is typed by hand (or the module exists).
	const [idByHand, setIdByHand] = useState(editing);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<{ words: string; verbatim: boolean } | null>(null);
	const [tried, setTried] = useState(false);

	const set = <K extends keyof ModuleForm>(k: K, v: ModuleForm[K]) => setForm((f) => ({ ...f, [k]: v }));
	const setTitle = (title: string) => setForm((f) => ({ ...f, title, id: idByHand ? f.id : title.trim() ? moduleIdFrom(title, takenIds) : "" }));

	const problems = useMemo(() => formProblems(form, takenIds), [form, takenIds]);
	const preview = useMemo(() => limitsPreview(form), [form]);
	const problemOf = (field: keyof ModuleForm | "limits") => problems.find((p) => p.field === field)?.words;
	// Say a field's problem once the reader has touched it, or tried to save.
	const show = (field: keyof ModuleForm | "limits", touched: boolean) => (tried || touched ? problemOf(field) : undefined);
	const label = editing ? "Edit module" : "Register a module";

	const onSave = async () => {
		setTried(true);
		setError(null);
		if (problems.length) return;
		const next = entryFromForm(form);
		setBusy(true);
		try {
			await save((text) => (at ? updateModule(text, at, next) : addModule(text, next)));
			onSaved?.(String(next.id));
			onClose();
		} catch (e) {
			setError(saveErrorText(e));
		} finally {
			setBusy(false);
		}
	};

	const inputs = form.inputs.length ? form.inputs : [{ name: "", words: "" }];
	const setInput = (i: number, k: "name" | "words", v: string) => set("inputs", inputs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

	return (
		<Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
			<DialogContent aria-label={label} onInteractOutside={(e) => { if (busy) e.preventDefault(); }} className={MODULE_SHEET}>
				<header className="px-5 pt-5 pb-3 border-b border-ink-200 pr-12">
					<DialogTitle className="font-display text-h3 text-ink-900 font-normal">{label}</DialogTitle>
					<DialogDescription className="text-caption text-ink-600 mt-1">
						A small CPU-only program in an image. lum.id runs it for this app&apos;s workflows, with hard limits, as whoever uses it.
					</DialogDescription>
				</header>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-5" data-testid="module-form">
					{/* What it is */}
					<section className="space-y-3">
						<div>
							<label className={LABEL} htmlFor="module-title">Name</label>
							<input id="module-title" className={FIELD} value={form.title} onChange={(e) => setTitle(e.target.value)} placeholder="Trace statistics" disabled={busy} />
						</div>
						<div>
							<label className={LABEL} htmlFor="module-id">Short id</label>
							<input id="module-id" className={cn(FIELD, "font-mono")} value={form.id} disabled={busy}
								onChange={(e) => { setIdByHand(true); set("id", e.target.value); }} placeholder="trace_stats" />
							<p className={HINT}>Workflows name it by this; lowercase letters, digits, _ or -.</p>
							<FieldProblem words={show("id", !!form.id)} />
						</div>
						<div>
							<label className={LABEL} htmlFor="module-about">What it does</label>
							<input id="module-about" className={FIELD} value={form.about} onChange={(e) => set("about", e.target.value)} disabled={busy}
								placeholder="Request count and token-length percentiles of a request trace" />
						</div>
					</section>

					{/* The code */}
					<section className="space-y-3">
						<div>
							<label className={LABEL} htmlFor="module-image">Image, pinned by digest</label>
							<input id="module-image" className={cn(FIELD, "font-mono")} value={form.image} onChange={(e) => set("image", e.target.value)} disabled={busy}
								placeholder="ghcr.io/your-org/your-repo@sha256:…" spellCheck={false} />
							<p className={HINT}>
								Pinned so the code can never change under a result someone reuses. Find the digest with{" "}
								<code className="font-mono text-ink-800 break-all">{digestCommand(form.image)}</code>
							</p>
							<FieldProblem words={show("image", !!form.image)} />
						</div>
						<div>
							<label className={LABEL} htmlFor="module-run">Command</label>
							<input id="module-run" className={cn(FIELD, "font-mono")} value={form.run} onChange={(e) => set("run", e.target.value)} disabled={busy}
								placeholder="python -m your_package.job" spellCheck={false} />
							<p className={HINT}>Gets the inputs as ONE JSON object on stdin and must print ONE JSON object on stdout. There is no network.</p>
							<FieldProblem words={show("run", !!form.run)} />
						</div>
					</section>

					{/* Inputs */}
					<section className="space-y-2">
						<div className={LABEL}>Inputs it reads</div>
						<p className="text-micro text-ink-600 -mt-1">Each name, and a few words on what to pass — the chat and Try it show these.</p>
						{inputs.map((r, i) => (
							<div key={i} className="flex gap-2 items-start">
								<input aria-label={`Input ${i + 1} name`} className={cn(FIELD, "font-mono w-36 sm:w-44 flex-none")} value={r.name} placeholder="trace"
									onChange={(e) => setInput(i, "name", e.target.value)} disabled={busy} spellCheck={false} />
								<input aria-label={`Input ${i + 1} words`} className={cn(FIELD, "flex-1 min-w-0")} value={r.words} placeholder="rows of {prompt_tokens, output_tokens}"
									onChange={(e) => setInput(i, "words", e.target.value)} disabled={busy} />
								<Button variant="ghost" size="icon-sm" aria-label={`Remove input ${r.name || i + 1}`} disabled={busy}
									onClick={() => set("inputs", inputs.filter((_, j) => j !== i))}>
									<Trash2 />
								</Button>
							</div>
						))}
						<Button variant="ghost" size="sm" onClick={() => set("inputs", [...inputs, { name: "", words: "" }])} disabled={busy}>
							<Plus /> Add an input
						</Button>
						<FieldProblem words={show("inputs", false)} />
					</section>

					{/* Limits */}
					<section className="space-y-2">
						<div className={LABEL}>Limits</div>
						<div className="grid grid-cols-3 gap-2">
							<div>
								<label className="text-micro text-ink-600 block mb-1" htmlFor="module-cpu">CPUs (up to {MODULE_MAX_CPU})</label>
								<input id="module-cpu" inputMode="decimal" className={FIELD} value={form.cpu} onChange={(e) => set("cpu", e.target.value)} disabled={busy} />
							</div>
							<div>
								<label className="text-micro text-ink-600 block mb-1" htmlFor="module-memory">Memory (up to 4 GiB)</label>
								<div className="flex">
									<input id="module-memory" inputMode="numeric" className={cn(FIELD, "rounded-r-none min-w-0")} value={form.memory} onChange={(e) => set("memory", e.target.value)} disabled={busy} />
									<select aria-label="Memory unit" className="rounded-r-lg border border-l-0 border-ink-200 bg-card px-1.5 text-meta text-ink-800" value={form.memoryUnit}
										onChange={(e) => set("memoryUnit", e.target.value === "Mi" ? "Mi" : "Gi")} disabled={busy}>
										<option value="Gi">GiB</option>
										<option value="Mi">MiB</option>
									</select>
								</div>
							</div>
							<div>
								<label className="text-micro text-ink-600 block mb-1" htmlFor="module-timeout">Seconds (up to {MODULE_MAX_TIMEOUT_S})</label>
								<input id="module-timeout" inputMode="numeric" className={FIELD} value={form.timeout} onChange={(e) => set("timeout", e.target.value)} disabled={busy} />
							</div>
						</div>
						<div className="rounded-lg bg-muted px-3 py-2 text-caption text-ink-800" aria-live="polite" data-testid="module-limits-preview">
							{preview.problem
								? <span className="text-brick-700">{preview.problem}</span>
								: <>It gets <span className="font-medium">{preview.words}</span>. No GPU, no network.</>}
							{preview.notes.map((n) => <div key={n} className="text-ember-700 mt-0.5">{clampNoteWords(n)}</div>)}
						</div>
					</section>

					{/* Reuse and visibility */}
					<section className="space-y-3">
						<div>
							<div className={LABEL}>Who reuses a result</div>
							<Segmented<"you" | "everyone">
								aria-label="Who reuses a result"
								value={form.share}
								onChange={(v) => set("share", v)}
								options={[{ value: "you", label: "Only the person who ran it" }, { value: "everyone", label: "Everyone" }]}
							/>
							<p className={HINT}>{shareWords(form.share)} Choose everyone only when the output depends on nothing but the inputs.</p>
						</div>
						<label className="flex items-start gap-2 text-caption text-ink-800">
							<input type="checkbox" className="mt-0.5 accent-gold-700" checked={form.public} onChange={(e) => set("public", e.target.checked)} disabled={busy} />
							<span>
								<span className="font-medium">Let any lum.id user&apos;s app use it</span>
								<span className="block text-micro text-ink-600">{publicWords(form.public, app)}</span>
							</span>
						</label>
					</section>
				</div>

				<footer className="border-t border-ink-200 px-5 py-3 space-y-2">
					{error && (
						<div role="alert" className="rounded-lg border border-brick-200 bg-brick-50 px-3 py-2 text-caption text-brick-700" data-testid="module-save-error">
							{error.verbatim ? <><span className="font-medium">lum.id refused it:</span> <span className="whitespace-pre-wrap">{error.words}</span></> : error.words}
						</div>
					)}
					{tried && problems.length > 0 && !error && (
						<p className="text-caption text-brick-700">{fixCountWords(problems.length)}</p>
					)}
					<div className="flex items-center gap-3">
						<p className="flex-1 text-micro text-ink-600">{savesWords(app, "module")}</p>
						<Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
						<Button onClick={onSave} disabled={busy} data-testid="module-save">
							{busy && <Loader2 className="animate-spin" />} {editing ? "Save" : "Register"}
						</Button>
					</div>
				</footer>
			</DialogContent>
		</Dialog>
	);
}

function FieldProblem({ words }: { words?: string }) {
	if (!words) return null;
	return <p className="text-micro text-brick-700 mt-1">{words}</p>;
}
