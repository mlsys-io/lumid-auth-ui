// ModulesPanel — "Compute modules" for one app (Manage app → Compute modules).
//
// Answers: what small compute does this app register on lum.id, can it run,
// what does it cost, and how do I use it? Every installed app gets this —
// nothing here knows any app. The spec is the source (lib/modules reads the
// `modules:` entries, so a refused one can still be edited); identity's
// listing (GET /me/measure/instruments?app=&public=1) adds its refusal words,
// the usual usage, and other owners' public modules.
//
// Writes are comment-preserving spec edits through useAppGraph's `save`
// (base_sha; 409 → re-read, reapply once). Try it once runs the module as the
// caller and saves nothing. `ModulesView` is the panel without its requests —
// the design gallery renders it from fixtures.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Cpu, Globe2, Loader2, Lock, Pencil, Play, Plus, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { toast } from "sonner";
import { me } from "@/api/me";
import { AuthContext } from "@/hooks/useAuth";
import { useAppGraph } from "@/hooks/useAppGraph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { plainCause } from "@/lib/activity";
import { workflowPath } from "@/lib/run-routes";
import {
	clampNoteWords, moduleRows, publicModuleRows, publicStatusWords, publicWords, removeBlocker, removeModule, saveErrorText, savesWords,
	shareWords, specModuleEntries, GUARANTEE_WORDS,
	type MeasureClient, type ModuleListing, type ModuleRow, type PublicModuleRow,
} from "@/lib/modules";
import ModuleSheet from "./ModuleSheet";
import TryModuleSheet, { type TryTarget } from "./TryModuleSheet";
import UseModuleSheet from "./UseModuleSheet";

type Save = (edit: (text: string) => string) => Promise<unknown>;

export default function ModulesPanel({ app, readOnly = false, onSaved }: {
	app: string;
	/** Operator-shared copy: show, don't edit. */
	readOnly?: boolean;
	/** The spec changed (the host page re-reads its own copy). */
	onSaved?: () => void;
}) {
	const { graph, error: specError, save } = useAppGraph(app);
	const role = useContext(AuthContext)?.user?.role;
	const isAdmin = role === "admin" || role === "super_admin";
	const [listing, setListing] = useState<ModuleListing | null>(null);
	const [listError, setListError] = useState<string | null>(null);

	const loadListing = useCallback(() => {
		me.moduleInstruments(app, { public: true })
			.then((l) => { setListing(l); setListError(null); })
			.catch((e) => setListError(plainCause((e as Error)?.message)));
	}, [app]);
	useEffect(() => { loadListing(); }, [loadListing]);

	const saveAndRefresh: Save = useCallback(async (edit) => {
		const g = await save(edit);
		loadListing();
		onSaved?.();
		return g;
	}, [save, loadListing, onSaved]);

	// /manage#modules (the "Compute modules" menu entries) lands here.
	const ref = useRef<HTMLElement>(null);
	const scrolled = useRef(false);
	useEffect(() => {
		if (!scrolled.current && graph && window.location.hash === "#modules") {
			scrolled.current = true;
			ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, [graph]);

	return (
		<section ref={ref} id="modules" className="rounded-xl border border-ink-200 bg-card p-4 space-y-3 scroll-mt-4" data-testid="modules-panel">
			<ModulesView
				app={app}
				specText={graph?.text ?? ""}
				loading={!graph && !specError}
				specError={specError}
				listing={listing}
				listError={listError}
				editable={!readOnly && !!graph?.editable}
				isAdmin={isAdmin}
				workflowIds={graph?.spec.workflows.map((w) => w.id) ?? []}
				save={saveAndRefresh}
			/>
		</section>
	);
}

export interface ModulesViewProps {
	app: string;
	specText: string;
	loading?: boolean;
	specError?: string | null;
	listing: ModuleListing | null;
	listError?: string | null;
	editable: boolean;
	isAdmin?: boolean;
	workflowIds: string[];
	save: Save;
	/** The gallery's fake lum.id; the live one by default. */
	client?: MeasureClient;
}

type Sheet =
	| { kind: "register" }
	| { kind: "edit"; row: ModuleRow }
	| { kind: "try"; target: TryTarget }
	| { kind: "use"; target: TryTarget; from?: string };

const PUBLIC_SHOWN = 5;

export function ModulesView({ app, specText, loading, specError, listing, listError, editable, isAdmin, workflowIds, save, client }: ModulesViewProps) {
	const rows = useMemo(() => moduleRows(app, specText, listing?.instruments), [app, specText, listing]);
	const pub = useMemo(() => publicModuleRows(listing?.instruments), [listing]);
	const stale = publicStatusWords(listing?.public_modules);
	const entries = useMemo(() => specModuleEntries(specText), [specText]);
	const [sheet, setSheet] = useState<Sheet | null>(null);
	const [allPublic, setAllPublic] = useState(false);

	const target = (r: { name: string; title: string; inputs: ModuleRow["inputs"]; limits?: ModuleRow["limits"] }): TryTarget =>
		({ name: r.name, title: r.title, inputs: r.inputs, limits: r.limits ?? null });

	return (
		<>
			<div className="flex items-center gap-2">
				<Cpu className="w-3.5 h-3.5 text-ink-600" />
				<h2 className="text-meta font-medium text-ink-800">Compute modules</h2>
				{editable && rows.length > 0 && (
					<Button size="sm" variant="secondary" className="ml-auto" onClick={() => setSheet({ kind: "register" })}>
						<Plus /> Register a module
					</Button>
				)}
			</div>

			{loading ? (
				<p className="text-caption text-ink-600 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading this app&apos;s modules…</p>
			) : rows.length === 0 ? (
				<div className="rounded-lg border border-dashed border-ink-300 px-4 py-5 text-center space-y-3" data-testid="modules-empty">
					<p className="text-caption text-ink-600 max-w-md mx-auto">
						A module is a small CPU-only program in a pinned image — a small model or a data-processing step — that lum.id runs for this app&apos;s workflows, with hard limits, as whoever uses it.
					</p>
					{editable
						? <Button size="sm" onClick={() => setSheet({ kind: "register" })}><Plus /> Register a module</Button>
						: <p className="text-micro text-ink-600">Only the app&apos;s owner can register one.</p>}
				</div>
			) : (
				<ul className="space-y-2" data-testid="modules-own">
					{rows.map((r) => (
						<ModuleCard
							key={`${r.index}:${r.id}`}
							app={app}
							row={r}
							specText={specText}
							editable={editable && r.index >= 0}
							save={save}
							onEdit={() => setSheet({ kind: "edit", row: r })}
							onTry={() => setSheet({ kind: "try", target: target(r) })}
							onUse={() => setSheet({ kind: "use", target: target(r) })}
						/>
					))}
				</ul>
			)}
			{specError && !loading && <p className="text-caption text-brick-700">{specError}; showing what lum.id lists.</p>}

			{/* Other owners' public modules */}
			<div className="pt-1 space-y-2" data-testid="modules-public">
				<h3 className="text-caption font-medium text-ink-800 flex items-center gap-1.5">
					<Globe2 className="w-3.5 h-3.5 text-ink-600" /> Public modules from other apps
				</h3>
				{stale && (
					<p className="text-caption text-ember-700 flex items-start gap-1.5" data-testid="modules-public-stale">
						<AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-none" /> <span>{stale}</span>
					</p>
				)}
				{isAdmin && listing?.public_modules?.refresh_error && (
					<p className="text-micro text-ink-600 font-mono break-all">Index error: {listing.public_modules.refresh_error}</p>
				)}
				{listError ? (
					<p className="text-caption text-ink-600">Couldn&apos;t ask lum.id which modules are public: {listError}.</p>
				) : !listing ? (
					<p className="text-caption text-ink-600 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Asking lum.id…</p>
				) : pub.length === 0 ? (
					<p className="text-caption text-ink-600">No other app has made a module public yet. A public module runs as you, on your budget.</p>
				) : (
					<>
						<p className="text-micro text-ink-600">Any of these can be a step in this app&apos;s workflows. It runs as you, on your budget — never with its author&apos;s rights.</p>
						<ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
							{(allPublic ? pub : pub.slice(0, PUBLIC_SHOWN)).map((p) => (
								<PublicRow key={p.name} row={p} editable={editable} isAdmin={isAdmin}
									onUse={() => setSheet({ kind: "use", target: { name: p.name, title: p.title, inputs: p.inputs, limits: null }, from: p.by })} />
							))}
						</ul>
						{pub.length > PUBLIC_SHOWN && (
							<Button variant="link" size="sm" onClick={() => setAllPublic((v) => !v)}>
								{allPublic ? "Show fewer" : `Show all ${pub.length}`}
							</Button>
						)}
					</>
				)}
			</div>

			{sheet?.kind === "register" && (
				<ModuleSheet app={app} takenIds={rows.map((r) => r.id).filter(Boolean)} save={save} onClose={() => setSheet(null)}
					onSaved={(id) => toast.success(`Registered ${id}. Try it once, or use it in a workflow.`)} />
			)}
			{sheet?.kind === "edit" && (
				<ModuleSheet app={app} entry={entries[sheet.row.index] ?? {}} at={{ id: sheet.row.id, index: sheet.row.index }}
					takenIds={rows.filter((r) => r.index !== sheet.row.index).map((r) => r.id).filter(Boolean)} save={save}
					onClose={() => setSheet(null)} onSaved={() => toast.success("Saved.")} />
			)}
			{sheet?.kind === "try" && <TryModuleSheet app={app} target={sheet.target} client={client} isAdmin={isAdmin} onClose={() => setSheet(null)} />}
			{sheet?.kind === "use" && (
				<UseModuleSheet app={app} target={sheet.target} from={sheet.from} workflowIds={workflowIds} save={save} onClose={() => setSheet(null)} />
			)}
		</>
	);
}

function ModuleCard({ app, row: r, specText, editable, save, onEdit, onTry, onUse }: {
	app: string; row: ModuleRow; specText: string; editable: boolean; save: Save;
	onEdit: () => void; onTry: () => void; onUse: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const blocker = r.id ? removeBlocker(specText, r.id) : null;

	const remove = async () => {
		setBusy(true);
		setError(null);
		try {
			await save((t) => removeModule(t, { id: r.id, index: r.index }));
			toast.success(`Removed ${r.title}.`);
		} catch (e) {
			const w = saveErrorText(e);
			setError(w.verbatim ? `lum.id refused it: ${w.words}` : w.words);
			setBusy(false);
		}
	};

	return (
		<li className="rounded-lg border border-ink-200 px-3 py-3 space-y-2" data-testid="module-card" data-module={r.id}>
			<div className="flex items-start gap-2 flex-wrap">
				<div className="min-w-0 flex-1">
					<div className="text-meta font-medium text-ink-900">{r.title}</div>
					{r.about && <p className="text-caption text-ink-600">{r.about}</p>}
				</div>
				{r.public
					? <Badge variant="knowledge"><Globe2 /> Public</Badge>
					: <Badge variant="idle"><Lock /> Only this app</Badge>}
			</div>

			{r.refused && (
				<div className="rounded-md border border-brick-200 bg-brick-50 px-2.5 py-1.5 text-caption text-brick-700 flex items-start gap-1.5" data-testid="module-refused">
					<AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-none" />
					<span><span className="font-medium">Can&apos;t run:</span> {r.refused}</span>
				</div>
			)}

			<dl className="grid grid-cols-1 sm:grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 sm:gap-y-1 text-caption [&>dt]:mt-1.5 sm:[&>dt]:mt-0 [&>dt]:text-micro sm:[&>dt]:text-caption">
				{r.repo && <>
					<dt className="text-ink-600">Image</dt>
					<dd className="text-ink-800 min-w-0 break-all">
						<span className="font-mono">{r.repo}</span>
						{r.digest && <span className="text-ink-600"> · pinned <span className="font-mono">{r.digest}</span></span>}
					</dd>
				</>}
				{r.limitsText && <>
					<dt className="text-ink-600">Limits</dt>
					<dd className="text-ink-800">{r.limitsText}<span className="text-ink-600"> · {GUARANTEE_WORDS}</span></dd>
				</>}
				{r.notes.length > 0 && <>
					<dt className="text-ink-600">Clamped</dt>
					<dd className="text-ember-700">{r.notes.map((n) => <div key={n}>{clampNoteWords(n)}</div>)}</dd>
				</>}
				<dt className="text-ink-600">Reuse</dt>
				<dd className="text-ink-800">{shareWords(r.share)} {publicWords(r.public, app)}</dd>
				{r.inputs.length > 0 && <>
					<dt className="text-ink-600">Reads</dt>
					<dd className="text-ink-800 space-y-0.5">
						{r.inputs.map((i) => <div key={i.name}><span className="font-medium">{i.label}</span>{i.words ? <span className="text-ink-600"> — {i.words}</span> : null}</div>)}
					</dd>
				</>}
				{r.estimate && <>
					<dt className="text-ink-600">Cost</dt>
					<dd className="text-ink-800">{r.estimate}</dd>
				</>}
				<dt className="text-ink-600">Used by</dt>
				<dd className="text-ink-800">
					{r.usedBy.length
						? r.usedBy.map((u, i) => <span key={u.workflow}>{i ? ", " : ""}<Link to={workflowPath(app, u.workflow)} className="underline hover:text-ink-900">{u.title}</Link></span>)
						: <span className="text-ink-600">no workflow yet</span>}
				</dd>
			</dl>

			<div className="flex flex-wrap gap-1.5 pt-0.5">
				<Button size="sm" variant="secondary" onClick={onEdit} disabled={!editable}><Pencil /> Edit</Button>
				<Button size="sm" variant="secondary" onClick={onTry} disabled={!!r.refused} title={r.refused ? "Fix it first: it can't run" : undefined}><Play /> Try it once</Button>
				<Button size="sm" variant="secondary" onClick={onUse} disabled={!editable || !!r.refused}><WorkflowIcon /> Use in a workflow</Button>
				<Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={!editable || confirming}><Trash2 /> Remove</Button>
			</div>

			{confirming && (
				<div className="rounded-md border border-ink-200 bg-muted px-3 py-2 text-caption space-y-2" data-testid="module-remove-confirm">
					{blocker ? (
						<>
							<p className="text-brick-700">{blocker}</p>
							<Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>OK</Button>
						</>
					) : (
						<>
							<p className="text-ink-800">Remove {r.title}? Workflows can&apos;t use it after this. {savesWords(app, "remove")}</p>
							{error && <p className="text-brick-700">{error}</p>}
							<div className="flex gap-2">
								<Button size="sm" variant="destructive" onClick={remove} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Remove</Button>
								<Button size="sm" variant="ghost" onClick={() => { setConfirming(false); setError(null); }} disabled={busy}>Keep it</Button>
							</div>
						</>
					)}
				</div>
			)}
		</li>
	);
}

function PublicRow({ row: p, editable, isAdmin, onUse }: { row: PublicModuleRow; editable: boolean; isAdmin?: boolean; onUse: () => void }) {
	return (
		<li className="px-3 py-2.5 flex items-start gap-3 flex-wrap" data-testid="module-public-row">
			<div className="min-w-0 flex-1">
				<div className="text-meta font-medium text-ink-900">{p.title}</div>
				{p.by && <div className="text-micro text-ink-600">From {p.by}{isAdmin && p.owner ? <span className="font-mono"> · {p.owner}</span> : null}</div>}
				{p.about && <p className="text-caption text-ink-600 mt-0.5">{p.about}</p>}
				<p className="text-micro text-ink-600 mt-0.5">
					{p.limitsText}{p.limitsText ? " · " : ""}{p.share === "everyone" ? "results reused for everyone" : "results reused only by you"}{p.estimate ? ` · ${p.estimate.charAt(0).toLowerCase()}${p.estimate.slice(1)}` : ""}
				</p>
			</div>
			<Button size="sm" variant="secondary" onClick={onUse} disabled={!editable}><WorkflowIcon /> Use in a workflow</Button>
		</li>
	);
}
