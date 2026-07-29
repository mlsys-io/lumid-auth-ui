// StudioArtifactPanel — left-side drawer that lists the user's saved
// artifacts (output from save_artifact, web_fetch dumps, code_run
// listings the user pinned, etc.) and renders the selected one with
// copy + download + delete controls.
//
// Two ways to surface an artifact:
//   1. The agent calls save_artifact — the chat dispatches a
//      window CustomEvent('studio:artifact-saved', { detail: { id } })
//      and the panel auto-opens + selects.
//   2. The user clicks the Artifacts button in the chat header to
//      browse manually.
//
// Lives at the LEFT edge of the screen, between the sidebar and the
// workspace. Collapses to a thin rail (Files icon) when not in use.

import { useCallback, useEffect, useState } from 'react';
import { Boxes, ChevronLeft, ChevronRight, Copy, Download, Trash2, X, Loader2 } from 'lucide-react';
import { ArtifactView, ArtifactKindIcon, type ArtifactKind } from './ArtifactView';

const COLLAPSE_KEY = 'studio_artifact_panel_collapsed_v1';
const WIDTH_KEY    = 'studio_artifact_panel_width_v1';
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 380;

type ArtifactListRow = {
	id: string;
	kind: ArtifactKind;
	title: string;
	language?: string;
	source_tool?: string;
	created_at: string;
	bytes: number;
};

type Artifact = ArtifactListRow & {
	content: string;
};

export function StudioArtifactPanel() {
	const [collapsed, setCollapsed] = useState<boolean>(() => {
		try {
			const raw = localStorage.getItem(COLLAPSE_KEY);
			return raw === null ? true : raw === '1';
		} catch { return true; }
	});
	const [width, setWidth] = useState<number>(() => {
		try {
			const raw = localStorage.getItem(WIDTH_KEY);
			const n = raw ? parseInt(raw, 10) : NaN;
			return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
		} catch { return DEFAULT_WIDTH; }
	});
	const [resizing, setResizing] = useState(false);

	const [rows, setRows] = useState<ArtifactListRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selected, setSelected] = useState<Artifact | null>(null);
	const [selectedLoading, setSelectedLoading] = useState(false);

	// Persist collapse + width.
	useEffect(() => {
		try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
	}, [collapsed]);
	useEffect(() => {
		if (resizing) return;
		try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
	}, [resizing, width]);

	// Resize drag.
	const startResize = useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		setResizing(true);
		const startX = e.clientX;
		const startWidth = width;
		const onMove = (ev: PointerEvent) => {
			const delta = ev.clientX - startX;
			const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
			setWidth(next);
		};
		const onUp = () => {
			setResizing(false);
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
		};
		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
	}, [width]);

	const loadList = useCallback(async () => {
		setLoading(true);
		try {
			const r = await fetch('/api/v1/me/artifacts', { credentials: 'include' });
			if (!r.ok) return;
			const j = await r.json();
			const list: ArtifactListRow[] = j?.data?.artifacts || [];
			setRows(list);
		} catch { /* ignore */ } finally {
			setLoading(false);
		}
	}, []);

	const loadOne = useCallback(async (id: string) => {
		setSelectedId(id);
		setSelectedLoading(true);
		setSelected(null);
		try {
			const r = await fetch('/api/v1/me/artifacts/' + encodeURIComponent(id), { credentials: 'include' });
			if (!r.ok) return;
			const j = await r.json();
			const a: Artifact | undefined = j?.data;
			if (a) setSelected(a);
		} catch { /* ignore */ } finally {
			setSelectedLoading(false);
		}
	}, []);

	const deleteOne = useCallback(async (id: string) => {
		if (!confirm('Delete this artifact?')) return;
		try {
			await fetch('/api/v1/me/artifacts/' + encodeURIComponent(id), {
				method: 'DELETE',
				credentials: 'include',
			});
			if (selectedId === id) {
				setSelected(null);
				setSelectedId(null);
			}
			loadList();
		} catch { /* ignore */ }
	}, [loadList, selectedId]);

	const copyContent = useCallback(() => {
		if (!selected) return;
		navigator.clipboard.writeText(selected.content).catch(() => {});
	}, [selected]);

	const downloadOne = useCallback(() => {
		if (!selected) return;
		const safeTitle = selected.title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || selected.id;
		const a = document.createElement('a');
		// image/audio/pdf artifacts are data: URLs — download them verbatim so the
		// bytes round-trip (a text/plain blob would corrupt them).
		if ((selected.kind === 'image' || selected.kind === 'audio' || selected.kind === 'pdf') && selected.content.startsWith('data:')) {
			const mime = selected.content.slice(5, selected.content.indexOf(';'));
			const ext = mime.split('/')[1] || (selected.kind === 'image' ? 'png' : selected.kind === 'pdf' ? 'pdf' : 'mp3');
			a.href = selected.content;
			a.download = `${safeTitle}.${ext}`;
			document.body.appendChild(a);
			a.click();
			setTimeout(() => document.body.removeChild(a), 100);
			return;
		}
		const ext = (() => {
			switch (selected.kind) {
				case 'markdown': return 'md';
				case 'json': return 'json';
				case 'chart': return 'json';
				case 'code': return selected.language || 'txt';
				default: return 'txt';
			}
		})();
		const blob = new Blob([selected.content], { type: 'text/plain' });
		a.href = URL.createObjectURL(blob);
		a.download = `${safeTitle}.${ext}`;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			document.body.removeChild(a);
			URL.revokeObjectURL(a.href);
		}, 100);
	}, [selected]);

	// Initial load + refresh on save events from the chat.
	useEffect(() => {
		loadList();
	}, [loadList]);

	useEffect(() => {
		const onSaved = (ev: Event) => {
			loadList();
			const ce = ev as CustomEvent<{ id?: string }>;
			if (ce.detail?.id) {
				setCollapsed(false);
				loadOne(ce.detail.id);
			}
		};
		// Toggle from the chat-header artifact icon — flips collapsed
		// state on every fire. Lets the panel act as a togglable
		// right-side drawer triggered by the chat header.
		const onToggle = () => {
			setCollapsed((c) => !c);
			loadList();
		};
		window.addEventListener('studio:artifact-saved', onSaved as EventListener);
		window.addEventListener('studio:artifact-panel-toggle', onToggle);
		return () => {
			window.removeEventListener('studio:artifact-saved', onSaved as EventListener);
			window.removeEventListener('studio:artifact-panel-toggle', onToggle);
		};
	}, [loadList, loadOne]);

	if (collapsed) {
		return (
			<aside className="flex-shrink-0 border-r border-slate-200 bg-white/40 flex flex-col items-center py-3 w-10">
				<button
					type="button"
					onClick={() => setCollapsed(false)}
					title={`Artifacts${rows.length ? ` (${rows.length})` : ''}`}
					className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
				>
					<Boxes className="w-4 h-4" />
				</button>
				{rows.length > 0 && (
					<span className="mt-1 text-[10px] font-mono text-slate-400">{rows.length}</span>
				)}
				<button
					type="button"
					onClick={() => setCollapsed(false)}
					title="Expand artifacts panel"
					className="mt-auto p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
				>
					<ChevronRight className="w-3 h-3" />
				</button>
			</aside>
		);
	}

	return (
		<aside
			className="flex-shrink-0 border-r border-slate-200 bg-white/60 flex flex-col relative"
			style={{ width: `${width}px` }}
		>
			{/* Header */}
			<header className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
				<div className="flex items-center gap-1.5">
					<Boxes className="w-4 h-4 text-gold-600" />
					<span className="text-sm font-medium text-slate-800">Artifacts</span>
					<span className="text-[11px] text-slate-400">({rows.length})</span>
				</div>
				<button
					type="button"
					onClick={() => setCollapsed(true)}
					title="Collapse panel"
					className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
				>
					<ChevronLeft className="w-4 h-4" />
				</button>
			</header>

			{/* List + detail. Two-row layout: list on top, detail below. */}
			<div className="flex flex-col flex-1 min-h-0">
				<div className="overflow-y-auto border-b border-slate-200 max-h-48">
					{loading && (
						<div className="p-3 text-[11px] text-slate-400 flex items-center gap-1.5">
							<Loader2 className="w-3 h-3 animate-spin" /> Loading…
						</div>
					)}
					{!loading && rows.length === 0 && (
						<div className="p-3 text-[11px] text-slate-400 italic">
							No artifacts yet. The agent will fill this in when you ask it to save a result.
						</div>
					)}
					{rows.map((r) => (
						<button
							key={r.id}
							type="button"
							onClick={() => loadOne(r.id)}
							className={[
								'w-full text-left px-3 py-1.5 border-b border-slate-100 hover:bg-slate-50 transition-colors',
								r.id === selectedId ? 'bg-gold-50/60' : '',
							].join(' ')}
						>
							<div className="flex items-center gap-1.5">
								<ArtifactKindIcon kind={r.kind} />
								<span className="text-[12.5px] font-medium text-slate-800 truncate flex-1">{r.title}</span>
								<span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
									{Math.round(r.bytes / 1024)}KB
								</span>
							</div>
							<div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-500">
								<span>{r.kind}</span>
								{r.language && <span>· {r.language}</span>}
								{r.source_tool && <span>· {r.source_tool}</span>}
								<span className="ml-auto">{formatDate(r.created_at)}</span>
							</div>
						</button>
					))}
				</div>

				{/* Detail viewer */}
				<div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5">
					{!selected && !selectedLoading && (
						<div className="text-[11px] text-slate-400 italic">
							Select an artifact above to view, copy, or download.
						</div>
					)}
					{selectedLoading && (
						<div className="text-[11px] text-slate-400 flex items-center gap-1.5">
							<Loader2 className="w-3 h-3 animate-spin" /> Loading…
						</div>
					)}
					{selected && (
						<>
							<div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-slate-100">
								<button
									type="button"
									onClick={copyContent}
									title="Copy to clipboard"
									className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
								>
									<Copy className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={downloadOne}
									title="Download"
									className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
								>
									<Download className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={() => deleteOne(selected.id)}
									title="Delete"
									className="p-1.5 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={() => { setSelected(null); setSelectedId(null); }}
									title="Close viewer"
									className="ml-auto p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
								>
									<X className="w-3.5 h-3.5" />
								</button>
							</div>
							<div className="text-[12.5px]">
								<ArtifactView kind={selected.kind} content={selected.content} title={selected.title} language={selected.language} />
							</div>
						</>
					)}
				</div>
			</div>

			{/* Resize handle on the right edge */}
			<div
				onPointerDown={startResize}
				className={['absolute top-0 right-0 h-full w-1 cursor-col-resize', resizing ? 'bg-gold-300/50' : 'hover:bg-gold-200/40'].join(' ')}
			/>
		</aside>
	);
}

function formatDate(iso: string): string {
	try {
		const d = new Date(iso);
		const now = new Date();
		const diff = (now.getTime() - d.getTime()) / 1000;
		if (diff < 60) return 'now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		return `${Math.floor(diff / 86400)}d`;
	} catch { return iso.slice(0, 10); }
}

export default StudioArtifactPanel;
