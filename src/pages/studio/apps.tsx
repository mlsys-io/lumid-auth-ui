// Phase S3-C — app editor (lean v1).
//
// Lists the user's installed apps; clicking one opens the editor for
// that fork. The editor surfaces each loop with editable schedule +
// enabled toggle (writes through /me/loops PATCH which lands in
// `.user-overrides.yaml`). Full xpcloud.yaml editor (skill swap,
// prompt editor) is a follow-up — the schedule + enabled controls
// alone close 80% of "tune my AI" intent.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layers, ChevronRight, Pause, Play, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { me, MeApiError } from '@/api/me';
import PageHints from '@/components/PageHints';
import { setStudioSelection } from '@/components/StudioContext';

type App = { name: string; has_xpcloud: boolean; tenant: boolean };
type LoopRow = {
	app: string;
	loop: string;
	schedule?: string;
	enabled?: boolean;
};

function AppList() {
	const [apps, setApps] = useState<App[] | null>(null);
	useEffect(() => {
		me.listApps()
			.then((r) => setApps(r.apps.filter((a) => a.tenant)))
			.catch(() => setApps([]));
	}, []);
	if (apps === null) return <div className="text-sm text-slate-500 italic">Loading apps…</div>;
	if (apps.length === 0) {
		return (
			<div className="max-w-md mx-auto pt-12 text-center space-y-4">
				<div className="inline-flex w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 items-center justify-center">
					<Layers className="w-7 h-7" />
				</div>
				<div>
					<h2 className="text-xl font-semibold">No apps yet</h2>
					<p className="mt-2 text-sm text-slate-600">
						Set up your AI by picking skills — it&apos;ll install as your first app.
					</p>
				</div>
				<Link
					to="/studio/skills"
					className="inline-flex px-4 py-2 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600"
				>
					Open composer
				</Link>
			</div>
		);
	}
	return (
		<div className="space-y-4">
			<header>
				<h1 className="text-lg font-semibold">Apps</h1>
				<p className="text-sm text-slate-500 mt-1">Your installed AI apps. Click one to edit.</p>
			</header>
			<PageHints prompts={[
				'pause cc_watcher for the weekend',
				'change my morning brief to 7am',
				'list everything you can do',
			]} />
			<ul className="space-y-2">
				{apps.map((a) => (
					<li key={a.name}>
						<Link
							to={`/studio/apps/${encodeURIComponent(a.name)}`}
							className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-3 hover:bg-slate-50 transition-colors"
						>
							<div>
								<div className="font-mono text-sm">{a.name}</div>
								<div className="text-xs text-slate-500 mt-0.5">Click to edit loops</div>
							</div>
							<ChevronRight className="w-4 h-4 text-slate-400" />
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

function AppEditor({ appName }: { appName: string }) {
	const [rows, setRows] = useState<LoopRow[] | null>(null);
	// Per-loop edits stage in memory; Save commits via /me/loops PATCH.
	const [edits, setEdits] = useState<Record<string, { schedule?: string; enabled?: boolean }>>({});
	const [saving, setSaving] = useState<Record<string, boolean>>({});

	const load = async () => {
		const r = await me.loopsHealth();
		const list = (r as unknown as { loops?: LoopRow[] }).loops ?? (r as unknown as LoopRow[]) ?? [];
		setRows(list.filter((r) => r.app === appName));
	};
	useEffect(() => { load(); }, [appName]);

	// Phase S6b — announce this app as the active selection so the chat
	// agent knows what "pause it" / "run morning_brief on this" refers to.
	useEffect(() => {
		setStudioSelection({
			kind: 'app',
			id: appName,
			label: appName,
			affordances: ['patch_loop (schedule/enabled)', 'run_loop_now', 'list_loops'],
		});
		return () => setStudioSelection(null);
	}, [appName]);

	const k = (r: LoopRow) => `${r.app}:${r.loop}`;
	const setEdit = (loop: LoopRow, patch: { schedule?: string; enabled?: boolean }) => {
		setEdits((m) => ({ ...m, [k(loop)]: { ...m[k(loop)], ...patch } }));
	};
	const save = async (loop: LoopRow) => {
		const patch = edits[k(loop)];
		if (!patch || (patch.schedule === undefined && patch.enabled === undefined)) return;
		setSaving((m) => ({ ...m, [k(loop)]: true }));
		try {
			await me.patchLoop(loop.app, loop.loop, patch);
			toast.success(`${loop.loop} updated`);
			await load();
			setEdits((m) => { const n = { ...m }; delete n[k(loop)]; return n; });
		} catch (e) {
			toast.error(`Save failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setSaving((m) => ({ ...m, [k(loop)]: false }));
		}
	};

	const dirty = useMemo(() => new Set(Object.keys(edits)), [edits]);

	if (rows === null) return <div className="text-sm text-slate-500 italic">Loading…</div>;

	return (
		<div className="space-y-4">
			<Link to="/studio/apps" className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 gap-1">
				← Apps
			</Link>
			<header>
				<h1 className="font-mono text-lg font-medium">{appName}</h1>
				<p className="text-sm text-slate-500 mt-1">
					Edit each loop&apos;s schedule and on/off. Changes save to
					<span className="font-mono"> .user-overrides.yaml</span> — the underlying
					app stays untouched.
				</p>
			</header>

			<ul className="space-y-2">
				{rows.map((r) => {
					const edit = edits[k(r)] || {};
					const effSched   = edit.schedule  ?? r.schedule ?? '';
					const effEnabled = edit.enabled   ?? r.enabled ?? true;
					const isDirty    = dirty.has(k(r));
					const isSaving   = saving[k(r)];
					return (
						<li key={k(r)} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
							<div className="flex items-center justify-between gap-3">
								<div className="font-medium">{r.loop}</div>
								<button
									onClick={() => setEdit(r, { enabled: !effEnabled })}
									className={[
										'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border',
										effEnabled
											? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
											: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
									].join(' ')}
								>
									{effEnabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
									{effEnabled ? 'Paused on save' : 'Enabled on save'}
								</button>
							</div>
							<div className="flex items-center gap-2">
								<label className="text-xs uppercase tracking-wide text-slate-500 w-16 flex-shrink-0">
									Schedule
								</label>
								<input
									type="text"
									value={effSched}
									onChange={(e) => setEdit(r, { schedule: e.target.value })}
									placeholder="cron e.g. 0 8 * * *"
									className="flex-1 px-2 py-1 text-sm font-mono rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
								/>
								<button
									onClick={() => save(r)}
									disabled={!isDirty || isSaving}
									className={[
										'inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded',
										isDirty
											? 'bg-emerald-500 text-white hover:bg-emerald-600'
											: 'bg-slate-200 text-slate-400 cursor-not-allowed',
									].join(' ')}
								>
									{isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
									Save
								</button>
							</div>
						</li>
					);
				})}
				{rows.length === 0 && (
					<li className="text-sm text-slate-500 italic">No loops discovered for this app yet.</li>
				)}
			</ul>

			<p className="text-xs text-slate-500 italic">
				Full editor — swap skills, edit prompts, change role models — is a follow-up.
				For now use the CLI: <code className="font-mono">~/.tenants/&lt;sub&gt;/.xp/apps/{appName}/xpcloud.yaml</code>
			</p>
		</div>
	);
}

export default function StudioApps() {
	const { app } = useParams<{ app?: string }>();
	return app ? <AppEditor appName={app} /> : <AppList />;
}
