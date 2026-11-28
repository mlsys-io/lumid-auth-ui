// AddVersions — "Add versions" from an experiment's panel: new versions of an
// existing experiment, written into the app's spec (comments kept). It defines
// them and nothing else; the runs start when the reader presses "Run the N
// untried versions" (manual dispatch).
//
// Round 10 (2026-11-28): a researcher with ten ideas had two ways in — the
// chat (which could not read the app's own notes) or hand-editing the YAML.
// Round 11 (2026-11-28): the YAML box read as blank raw keys, so a form is the
// default — one field per setting of the first version, labelled in words,
// pre-filled and marked when changed; a name instead of an id; a version that
// repeats one already there can't be added. "Edit as text" keeps the YAML box
// for several at once. Both go through parseNewVersions → addVersions, the
// same save as before. Logic and words: lib/version-form.ts (tested).

import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAppGraph } from "@/hooks/useAppGraph";
import { addVersions, parseNewVersions, versionIds, versionInputs, versionTemplate, type NewVersion } from "@/lib/app-spec";
import { experimentLoop, humanId, experimentLabel, versionLabel } from "@/lib/research-map";
import {
	addedField, addsLine, buildSettings, duplicateProblems, fieldChange, firstVersionSettings, formVersion, inputDefaults,
	nameHint, settingFields, startsFromWords, versionIdFrom, versionSettings, versionsYaml, type SettingField,
} from "@/lib/version-form";
import type { MeExperiment } from "@/api/me";

const fieldCls = "w-full rounded-md border border-ink-200 bg-card px-2 py-1 text-caption text-ink-900 focus:outline-none focus:ring-2 focus:ring-plum-300";

function SettingRow({ f, value, onChange, onReset, onRemove }: {
	f: SettingField; value: string | boolean; onChange: (v: string | boolean) => void; onReset: () => void; onRemove?: () => void;
}) {
	const id = useId();
	const changed = fieldChange(f, value);
	return (
		<div className={cn("grid grid-cols-1 gap-1 border-l-2 py-1 pl-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3", changed ? "border-plum-500" : "border-transparent")}>
			<label htmlFor={id} className="pt-1 text-caption text-ink-700">{f.label}</label>
			<div className="min-w-0 space-y-0.5">
				<div className="flex items-start gap-1.5">
					{f.kind === "yesno" ? (
						<div className="flex items-center gap-2 py-1">
							<Checkbox id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />
							<span className="text-caption text-ink-700">{value === true ? "yes" : "no"}</span>
						</div>
					) : f.long || f.kind === "json" ? (
						<textarea id={id} rows={2} value={String(value)} onChange={(ev) => onChange(ev.target.value)} spellCheck={false}
							className={cn(fieldCls, "resize-y leading-relaxed", f.kind === "json" && "font-mono")} />
					) : (
						<input id={id} value={String(value)} onChange={(ev) => onChange(ev.target.value)} spellCheck={false}
							inputMode={f.kind === "number" ? "decimal" : undefined} className={fieldCls} />
					)}
					{onRemove ? (
						<button type="button" onClick={onRemove} aria-label={`Don't set ${f.label}`} title="Don't set it"
							className="mt-1 rounded p-0.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900"><X className="size-3.5" /></button>
					) : changed ? (
						<button type="button" onClick={onReset} aria-label={`Put ${f.label} back`} title="Put it back"
							className="mt-1 rounded p-0.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900"><RotateCcw className="size-3.5" /></button>
					) : null}
				</div>
				{changed ? <div className="text-micro text-plum-700">{changed}</div> : null}
			</div>
		</div>
	);
}

/** The form itself — shown IN the experiment's panel with Back (operator,
 *  2026-11-28: "reuse the panel, don't pop up another"), or in the popup below
 *  for a caller with no panel. `onDone` runs after Cancel and after a save. */
export function AddVersionsBody({ app, e, onDone }: { app: string; e: MeExperiment; onDone: () => void }) {
	const onClose = onDone;
	const { graph, save } = useAppGraph(app);
	const text = graph?.text ?? "";
	const loop = experimentLoop(e);
	const inputs = useMemo(() => (graph ? versionInputs(graph.spec, loop) : []), [graph, loop]);
	const defaults = useMemo(() => (graph ? inputDefaults(graph.spec, loop) : {}), [graph, loop]);
	const arms = useMemo(() => (e.arms || []) as Array<Record<string, unknown>>, [e.arms]);
	const taken = useMemo(() => [...new Set([...versionIds(text, e.id), ...arms.map((a) => String(a.id))])], [text, e.id, arms]);
	const template = useMemo(() => (text ? versionTemplate(text, e.id) : ""), [text, e.id]);
	const existing = useMemo(() => arms.map((a) => ({ id: String(a.id), label: versionLabel(e, String(a.id)), settings: versionSettings(a) })), [arms, e]);
	const firstLabel = arms[0] ? versionLabel(e, String(arms[0].id)) : "its first version";

	// ── the form ──
	const [mode, setMode] = useState<"form" | "text">("form");
	const [name, setName] = useState("");
	const [about, setAbout] = useState("");
	const [edits, setEdits] = useState<Record<string, string | boolean>>({});
	const [added, setAdded] = useState<string[]>([]);
	const base = useMemo(() => firstVersionSettings(arms, template), [arms, template]);
	const baseFields = useMemo(() => settingFields(base), [base]);
	const fields = useMemo(() => [...baseFields, ...added.map((k) => addedField(k, defaults[k] ?? ""))], [baseFields, added, defaults]);
	const addable = inputs.filter((k) => !(k in base) && !added.includes(k));
	const built = useMemo(() => buildSettings(base, fields, edits), [base, fields, edits]);
	const id = versionIdFrom(name, taken);
	const formV = useMemo(() => formVersion({ id, name, about, settings: built.settings }), [id, name, about, built.settings]);
	const formParsed = useMemo(() => parseNewVersions(versionsYaml([formV]), taken, inputs), [formV, taken, inputs]);

	// ── the text box ──
	const [draft, setDraft] = useState<string | null>(null);
	const value = draft ?? template;
	const textParsed = useMemo(() => parseNewVersions(value, taken, inputs), [value, taken, inputs]);

	const hint = mode === "form" ? nameHint(name) : null;
	const parsed = mode === "form"
		? { versions: formParsed.versions, problems: [...built.problems, ...formParsed.problems] }
		: textParsed;
	const repeats = useMemo(() => duplicateProblems(parsed.versions, existing), [parsed.versions, existing]);
	const versions: NewVersion[] = parsed.versions;
	const [busy, setBusy] = useState(false);
	const n = versions.length;
	const ready = n > 0 && !parsed.problems.length && !repeats.length && !hint && !busy;

	const toText = () => { setDraft(versionsYaml([formV])); setMode("text"); };
	const edit = (k: string, v: string | boolean) => setEdits((cur) => ({ ...cur, [k]: v }));
	const reset = (k: string) => setEdits((cur) => { const next = { ...cur }; delete next[k]; return next; });

	const add = async () => {
		setBusy(true);
		try {
			await save((cur) => addVersions(cur, e.id, versions));
			window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["experiments"] } }));
			toast.success(`${n} version${n === 1 ? "" : "s"} added to ${experimentLabel(e)}`, {
				description: "Nothing has run yet — press “Run the untried versions” when you're ready.",
			});
			onClose();
		} catch (ex) {
			toast.error("Couldn't add the versions", { description: String((ex as Error).message || ex) });
		} finally {
			setBusy(false);
		}
	};

	// A portal: the panel that opens this sheet animates with a transform,
	// which made it the containing block of this fixed overlay — the sheet was
	// clipped inside the panel (round 10, 2026-11-28).
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
				<div className="flex justify-end">
					<Button size="sm" variant="ghost" onClick={mode === "form" ? toText : () => setMode("form")}>
						{mode === "form" ? "Edit as text" : "Back to the form"}
					</Button>
				</div>

				{mode === "form" ? (
					<div className="min-h-0 space-y-3 overflow-y-auto pr-1">
						<p className="text-caption text-ink-700">{startsFromWords(firstLabel, arms.length)}</p>
						<div className="space-y-1">
							<label className="block text-caption font-medium text-ink-900" htmlFor="add-version-name">Name</label>
							<input id="add-version-name" value={name} onChange={(ev) => setName(ev.target.value)} autoFocus
								placeholder="e.g. Six-month momentum, top 500" className={cn(fieldCls, "text-body")} />
							{name.trim() ? <div className="text-micro text-ink-600">Saved as <span className="font-mono">{id}</span></div> : null}
						</div>
						<div className="space-y-1">
							<label className="block text-caption font-medium text-ink-900" htmlFor="add-version-about">What it changes</label>
							<textarea id="add-version-about" value={about} onChange={(ev) => setAbout(ev.target.value)} rows={2}
								placeholder="What this version changes, and why it might win" className={cn(fieldCls, "resize-y text-body")} />
						</div>
						<div>
							<div className="mb-1 text-caption font-medium text-ink-900">Settings</div>
							{fields.length ? (
								<div className="space-y-0.5">
									{fields.map((f) => (
										<SettingRow key={f.key} f={f} value={f.key in edits ? edits[f.key] : f.initial}
											onChange={(v) => edit(f.key, v)} onReset={() => reset(f.key)}
											onRemove={f.original === undefined ? () => { setAdded((cur) => cur.filter((k) => k !== f.key)); reset(f.key); } : undefined} />
									))}
								</div>
							) : (
								<p className="text-caption text-ink-600">The first version sets nothing of its own yet.</p>
							)}
							{addable.length ? (
								<div className="mt-2 flex flex-wrap items-center gap-1.5">
									<span className="text-micro text-ink-600">Also set:</span>
									{addable.map((k) => (
										<button key={k} type="button" onClick={() => setAdded((cur) => [...cur, k])}
											className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-2 py-0.5 text-micro text-ink-700 hover:border-plum-300 hover:text-plum-700">
											<Plus className="size-3" />{humanId(k)}
										</button>
									))}
								</div>
							) : null}
						</div>
					</div>
				) : (
					<>
						<p className="text-caption text-ink-700">
							One entry per version: an <span className="font-mono">id</span>, a <span className="font-mono">title</span>, what it changes (<span className="font-mono">about</span>), and the inputs it sets
							{inputs.length ? <> — {inputs.map((k, i) => <span key={k}>{i ? ", " : ""}<span className="font-mono">{k}</span></span>)}</> : null}.
							Paste several to add them at once.
						</p>
						<textarea
							aria-label="New versions (YAML or JSON)"
							value={value}
							onChange={(ev) => setDraft(ev.target.value)}
							spellCheck={false}
							rows={14}
							className="w-full resize-y rounded-lg border border-ink-200 bg-card p-2.5 font-mono text-caption leading-relaxed text-ink-900 focus:outline-none focus:ring-2 focus:ring-plum-300"
						/>
					</>
				)}

				{parsed.problems.length > 0 ? (
					<ul role="alert" className="space-y-0.5 text-caption text-brick-700">
						{parsed.problems.map((p) => <li key={p}>{p}</li>)}
					</ul>
				) : repeats.length > 0 || hint ? (
					<ul role="status" className="space-y-0.5 text-caption">
						{repeats.map((p) => <li key={p} className="text-ember-700">{p}</li>)}
						{hint ? <li className="text-ink-600">{hint}</li> : null}
					</ul>
				) : n > 0 ? (
					<p role="status" className="text-caption text-ink-700">
						{addsLine(versions.map((v) => v.title || humanId(v.id)), mode === "form" ? built.changed : 0)}
					</p>
				) : null}
				<div className="flex items-center justify-end gap-2">
					<Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
					<Button size="sm" variant="accent" disabled={!ready} onClick={add}>
						{busy ? "Adding…" : n > 1 ? `Add ${n} versions` : "Add the version"}
					</Button>
				</div>
		</div>
	);
}

/** The popup form, for a caller with no panel to show it in. A portal: the
 *  panel that opens it animates with a transform, which made it the containing
 *  block of this fixed overlay — the sheet was clipped inside the panel. */
export default function AddVersions({ app, e, onClose }: { app: string; e: MeExperiment; onClose: () => void }) {
	return createPortal((
		<div role="dialog" aria-label="Add versions" className="fixed inset-0 z-[7000] flex items-center justify-center bg-ink-900/30 p-4" onClick={onClose}>
			<div className="flex max-h-[90vh] w-full max-w-xl flex-col gap-3 rounded-xl border border-ink-200 bg-card p-4 shadow-e3 map-panel-in" onClick={(ev) => ev.stopPropagation()}>
				<div>
					<div className="eyebrow text-plum-700">Add versions</div>
					<div className="text-title font-semibold text-ink-900">{experimentLabel(e)}</div>
				</div>
				<AddVersionsBody app={app} e={e} onDone={onClose} />
			</div>
		</div>
	), document.body);
}
