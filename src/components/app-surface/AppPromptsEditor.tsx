// AppPromptsEditor — Tune › Prompts (WS-7). Edit the analyst & judge prompt
// files an app runs on (e.g. mbb-ai's analyst_system / analyst_skill_* /
// judge_*). Cloned from AppSurfaceEditor: a list rail + a split-pane editor
// (textarea left, rendered-markdown preview right) with a base_sha optimistic
// lock.
//
// Route: /studio/a/:app/prompts  (reached from the Tune tab)
//
// Each prompt is LOCAL (an editable override in the tenant's own bundle) or
// SHARED (inherited read-only from a shared skill). Editing a shared prompt
// and saving creates a LOCAL OVERRIDE — the shared skill file is never
// mutated. A banner makes this explicit before the first save.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
	FileText, Save, X, AlertTriangle, Info, Loader2, RotateCcw,
	Eye, EyeOff, Scale, Brain,
} from "lucide-react";
import { me, MeApiError, type MeAppPrompt } from "@/api/me";
import { LumidMarkdown } from "./LumidMarkdown";
import { cn } from "@/lib/utils";

// Group a prompt by its filename stem. Analyst cards (analyst_system,
// analyst_skill_*) vs Judge rubrics (judge_*) vs anything else.
function groupOf(name: string): "analyst" | "judge" | "other" {
	if (name.startsWith("analyst")) return "analyst";
	if (name.startsWith("judge")) return "judge";
	return "other";
}
function prettyName(name: string): string {
	return name.replace(/^analyst_skill_/, "").replace(/^analyst_/, "").replace(/^judge_/, "")
		.replace(/_/g, " ").trim() || name;
}

export function AppPromptsEditor() {
	const { app = "" } = useParams<{ app: string }>();
	const [prompts, setPrompts] = useState<MeAppPrompt[] | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);

	// Load the prompt list.
	const loadList = useCallback(() => {
		setListError(null);
		me.appPrompts(app)
			.then(({ prompts }) => {
				const list = prompts || [];
				setPrompts(list);
				// Auto-select the first prompt so the editor isn't empty on open.
				setSelected((cur) => cur ?? (list[0]?.name ?? null));
			})
			.catch((e) => setListError(String((e as Error)?.message ?? e)));
	}, [app]);
	useEffect(() => { loadList(); }, [loadList]);

	const groups = useMemo(() => {
		const g: Record<"analyst" | "judge" | "other", MeAppPrompt[]> = { analyst: [], judge: [], other: [] };
		for (const p of prompts ?? []) g[groupOf(p.name)].push(p);
		return g;
	}, [prompts]);

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* Header */}
			<div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-white flex-shrink-0">
				<Link to={`/studio/apps/${encodeURIComponent(app)}`} className="text-[12px] text-slate-500 hover:text-slate-800 flex items-center gap-1">← {app}</Link>
				<span className="text-slate-300">/</span>
				<span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
					<FileText className="w-3.5 h-3.5 text-slate-400" /> Prompts
				</span>
				<span className="ml-auto text-[11px] text-slate-400">The analyst &amp; judge instructions this app runs on</span>
			</div>

			<div className="flex flex-1 min-h-0">
				{/* List rail */}
				<div className="w-60 flex-shrink-0 border-r border-slate-200 bg-slate-50/60 overflow-y-auto">
					{listError ? (
						<div className="p-4 text-xs text-rose-600">{listError}</div>
					) : prompts === null ? (
						<div className="p-4 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
					) : prompts.length === 0 ? (
						<div className="p-4 text-xs text-slate-400">This app declares no editable prompts.</div>
					) : (
						<div className="py-2">
							<PromptGroup title="Analyst" icon={Brain} items={groups.analyst} selected={selected} onSelect={setSelected} />
							<PromptGroup title="Judge" icon={Scale} items={groups.judge} selected={selected} onSelect={setSelected} />
							<PromptGroup title="Other" icon={FileText} items={groups.other} selected={selected} onSelect={setSelected} />
						</div>
					)}
				</div>

				{/* Editor pane */}
				<div className="flex-1 min-w-0 min-h-0">
					{selected ? (
						<PromptPane key={selected} app={app} name={selected} onChangedSource={loadList} />
					) : (
						<div className="h-full flex items-center justify-center text-sm text-slate-400">Select a prompt to edit.</div>
					)}
				</div>
			</div>
		</div>
	);
}

function PromptGroup({ title, icon: Icon, items, selected, onSelect }: {
	title: string; icon: React.ComponentType<{ className?: string }>;
	items: MeAppPrompt[]; selected: string | null; onSelect: (n: string) => void;
}) {
	if (!items.length) return null;
	return (
		<div className="mb-2">
			<div className="px-3 py-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
				<Icon className="w-3 h-3" /> {title}
			</div>
			{items.map((p) => (
				<button key={p.name} onClick={() => onSelect(p.name)}
					className={cn(
						"w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
						selected === p.name ? "bg-gold-50 text-gold-800" : "text-slate-700 hover:bg-slate-100",
					)}>
					<span className="flex-1 truncate" title={p.name}>{prettyName(p.name)}</span>
					<SourceBadge source={p.source} />
				</button>
			))}
		</div>
	);
}

function SourceBadge({ source }: { source: "local" | "shared" }) {
	return source === "local" ? (
		<span title="A local override in this app's own bundle — editable." className="text-[9px] uppercase tracking-wide rounded px-1 py-0.5 bg-gold-100 text-gold-700 border border-gold-200">local</span>
	) : (
		<span title="Inherited read-only from a shared skill — editing creates a local override." className="text-[9px] uppercase tracking-wide rounded px-1 py-0.5 bg-slate-100 text-slate-500 border border-slate-200">shared</span>
	);
}

// One prompt's split-pane editor with the base_sha optimistic lock.
function PromptPane({ app, name, onChangedSource }: { app: string; name: string; onChangedSource: () => void }) {
	const [original, setOriginal] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [source, setSource] = useState<"local" | "shared">("shared");
	const [baseSha, setBaseSha] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [reverting, setReverting] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [showPreview, setShowPreview] = useState(true);
	const liveRef = useRef(true);

	const dirty = original !== null && draft !== original;

	const load = useCallback(() => {
		liveRef.current = true;
		setLoading(true);
		setLoadError(null);
		me.appPrompt(app, name)
			.then((d) => {
				if (!liveRef.current) return;
				setOriginal(d.content ?? "");
				setDraft(d.content ?? "");
				setSource(d.source);
				setBaseSha(d.sha);
				setLoading(false);
			})
			.catch((e) => {
				if (!liveRef.current) return;
				setLoadError(String((e as Error)?.message ?? e));
				setLoading(false);
			});
	}, [app, name]);
	useEffect(() => { load(); return () => { liveRef.current = false; }; }, [load]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		try {
			const res = await me.updateAppPrompt(app, name, draft, baseSha);
			setOriginal(draft);
			setBaseSha(res.sha);
			const wasShared = source === "shared";
			if (wasShared) { setSource("local"); onChangedSource(); }
			toast.success(wasShared ? "Saved — created a local override." : "Prompt saved.");
		} catch (e) {
			if (e instanceof MeApiError && (e.ret_code === 1409 || e.status === 409)) {
				toast.error("This prompt changed since you opened it (another tab or chat). Copy your edits, reload, and reapply.", { duration: 10000 });
			} else {
				toast.error("Save failed: " + String((e as Error)?.message ?? e));
			}
		} finally { setSaving(false); }
	}, [app, name, draft, baseSha, source, onChangedSource]);

	const handleRevert = useCallback(async () => {
		if (!window.confirm("Revert to the shared copy? Your local edits to this prompt will be removed.")) return;
		setReverting(true);
		try {
			await me.resetAppPrompt(app, name);
			toast.success("Reverted to the shared copy.");
			onChangedSource();
			load();
		} catch (e) {
			toast.error("Revert failed: " + String((e as Error)?.message ?? e));
		} finally { setReverting(false); }
	}, [app, name, load, onChangedSource]);

	if (loading) return <div className="p-8 text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading {prettyName(name)}…</div>;
	if (loadError) return <div className="p-8"><div className="text-sm text-rose-600">Couldn't load prompt.</div><div className="mt-1 text-xs text-slate-400">{loadError}</div></div>;

	const bytes = new Blob([draft]).size;

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* Toolbar */}
			<div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 bg-white flex-shrink-0">
				<span className="text-[13px] font-medium text-slate-800 flex items-center gap-1.5">
					<FileText className="w-3.5 h-3.5 text-slate-400" /> {prettyName(name)}
				</span>
				<SourceBadge source={source} />
				<div className="ml-auto flex items-center gap-2">
					<button onClick={() => setShowPreview((v) => !v)} title={showPreview ? "Hide preview" : "Show preview"}
						className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors">
						{showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {showPreview ? "Hide preview" : "Preview"}
					</button>
					{source === "local" && (
						<button onClick={handleRevert} disabled={reverting} title="Revert to the shared copy"
							className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
							{reverting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Revert
						</button>
					)}
					<button onClick={() => { if (!dirty || window.confirm("Discard unsaved changes?")) setDraft(original ?? ""); }}
						disabled={!dirty}
						className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40">
						<X className="w-3.5 h-3.5" /> Reset
					</button>
					<button onClick={handleSave} disabled={saving || !dirty}
						className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
							dirty && !saving ? "bg-gold-500 text-white hover:bg-gold-600 shadow-sm shadow-gold-100" : "bg-slate-100 text-slate-400 cursor-not-allowed")}>
						{saving ? "Saving…" : <><Save className="w-3.5 h-3.5" /> Save</>}
					</button>
				</div>
			</div>

			{/* Shared → local override banner */}
			{source === "shared" && (
				<div className="flex items-start gap-2 px-4 py-2 bg-gold-50 border-b border-gold-200 text-[12px] text-gold-800 flex-shrink-0">
					<AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
					This prompt is inherited <strong>read-only from a shared skill</strong>. Saving creates an
					independent <strong>local copy</strong> in this app's bundle — the shared skill file is never changed.
				</div>
			)}
			{source === "local" && (
				<div className="flex items-start gap-2 px-4 py-2 bg-sky-50 border-b border-sky-200 text-[12px] text-sky-800 flex-shrink-0">
					<Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
					Local override — this copy overrides the shared one when the app runs. Revert to drop it.
				</div>
			)}

			{/* Body */}
			<div className="flex flex-1 min-h-0">
				<div className={cn("flex flex-col min-h-0", showPreview ? "w-1/2 border-r border-slate-200" : "w-full")}>
					<textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
						placeholder="Write the prompt (markdown) here…"
						className="flex-1 w-full font-mono text-[13px] leading-relaxed p-4 resize-none border-0 focus:outline-none bg-white text-slate-800 placeholder:text-slate-300" />
				</div>
				{showPreview && (
					<div className="w-1/2 overflow-y-auto">
						<div className="px-6 py-4"><LumidMarkdown source={draft || "_Nothing to preview yet._"} /></div>
					</div>
				)}
			</div>

			{/* Footer */}
			<div className="flex items-center px-4 py-1.5 border-t border-slate-100 bg-white flex-shrink-0">
				<span className="text-[11px] tabular-nums text-slate-400">{draft.length.toLocaleString()} chars · {bytes.toLocaleString()} bytes</span>
			</div>
		</div>
	);
}

export default AppPromptsEditor;
