// ArtifactIconButton — the Artifacts panel, as a self-contained module.
//
// Lives here rather than in StudioChat.tsx because the Studio SHELL renders
// it (the sidebar Artifacts row). While it was exported from StudioChat, the
// shell chunk imported the chat chunk, so every Studio and dashboard route
// paid for the whole chat bundle just to draw one sidebar row.
//
// It is genuinely independent of the chat: its state is the artifact list it
// fetches itself, and it couples to the chat only through two window events
// (`studio:artifact-saved`, `studio:artifact-panel-toggle`).

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Boxes, Copy, Download, Loader2, Trash2 } from 'lucide-react';
import { ArtifactView, ArtifactKindIcon, artifactDownload, type ArtifactKind } from './ArtifactView';
import { useClickOutside } from '@/hooks/useClickOutside';

// ArtifactIconButton — full artifact panel embedded in a popover
// anchored to the icon. Replaces the old left-rail StudioArtifactPanel.
// Shows list + detail-on-click + per-item copy/download/delete in
// one ~420px wide popover. Auto-opens + selects when the agent
// dispatches `studio:artifact-saved`.
type ArtifactRow = {
	id: string;
	kind: ArtifactKind;
	title: string;
	language?: string;
	source_tool?: string;
	created_at: string;
	bytes: number;
};
type ArtifactFull = ArtifactRow & { content: string };

export function ArtifactIconButton({ align = 'right', variant = 'icon' }: { align?: 'left' | 'right'; variant?: 'icon' | 'sidebar' }) {
	const [open, setOpen] = useState(false);
	const ref = useClickOutside(open, () => setOpen(false));
	const [rows, setRows] = useState<ArtifactRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selected, setSelected] = useState<ArtifactFull | null>(null);
	const [selectedLoading, setSelectedLoading] = useState(false);
	const [copied, setCopied] = useState(false);

	const loadList = useCallback(async () => {
		setLoading(true);
		try {
			const r = await fetch('/api/v1/me/artifacts', { credentials: 'include' });
			if (!r.ok) return;
			const j = await r.json();
			setRows(Array.isArray(j?.data?.artifacts) ? j.data.artifacts : []);
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
			if (j?.data) setSelected(j.data as ArtifactFull);
		} catch { /* ignore */ } finally {
			setSelectedLoading(false);
		}
	}, []);

	const deleteOne = useCallback(async (id: string) => {
		if (!confirm('Delete this artifact?')) return;
		try {
			await fetch('/api/v1/me/artifacts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' });
			if (selectedId === id) { setSelected(null); setSelectedId(null); }
			loadList();
		} catch { /* ignore */ }
	}, [loadList, selectedId]);

	const copyContent = useCallback(() => {
		if (!selected) return;
		try {
			navigator.clipboard.writeText(selected.content);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch { /* ignore */ }
	}, [selected]);

	const downloadOne = useCallback(() => {
		if (!selected) return;
		artifactDownload(selected.kind, selected.content, selected.title, selected.id);
	}, [selected]);

	// Open via the chat header icon + auto-open on save event.
	useEffect(() => {
		const onSaved = (ev: Event) => {
			loadList();
			const ce = ev as CustomEvent<{ id?: string }>;
			if (ce.detail?.id) { setOpen(true); loadOne(ce.detail.id); }
		};
		const onToggle = () => setOpen((v) => !v);
		window.addEventListener('studio:artifact-saved', onSaved as EventListener);
		window.addEventListener('studio:artifact-panel-toggle', onToggle);
		return () => {
			window.removeEventListener('studio:artifact-saved', onSaved as EventListener);
			window.removeEventListener('studio:artifact-panel-toggle', onToggle);
		};
	}, [loadList, loadOne]);

	// Refresh list when the popover opens.
	useEffect(() => { if (open) loadList(); }, [open, loadList]);

	const KindIcon = ({ k }: { k: ArtifactRow['kind'] }) => <ArtifactKindIcon kind={k} />;

	// Two triggers, one panel: the compact icon (chat header, legacy callers)
	// and a full-width sidebar nav row matching NavItemView's weight.
	const sidebar = variant === 'sidebar';
	return (
		<div ref={ref} className="relative">
			{sidebar ? (
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					title={rows.length > 0 ? `Artifacts (${rows.length})` : 'Artifacts'}
					className={[
						'group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
						open ? 'bg-black/[0.06] text-foreground font-medium' : 'text-foreground/60 hover:bg-black/[0.04] hover:text-foreground',
					].join(' ')}
				>
					<Boxes className={['w-4 h-4 flex-shrink-0 transition-colors', open ? 'text-foreground/80' : 'text-foreground/45 group-hover:text-foreground/70'].join(' ')} />
					<span>Artifacts</span>
					{rows.length > 0 && (
						<span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gold-100 text-gold-700 text-[10px] font-semibold tabular-nums">
							{rows.length > 99 ? '99+' : rows.length}
						</span>
					)}
				</button>
			) : (
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				title={rows.length > 0 ? `Artifacts (${rows.length})` : 'Artifacts'}
				className={[
					'relative p-1.5 rounded-md transition-colors',
					open ? 'text-gold-700 bg-gold-50' : 'text-muted-foreground hover:text-gold-700 hover:bg-gold-50',
				].join(' ')}
			>
				<Boxes className="w-3.5 h-3.5" />
				{rows.length > 0 && (
					<span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-gold-500 text-white text-[8.5px] font-bold flex items-center justify-center ring-2 ring-white leading-none">
						{rows.length > 99 ? '99+' : rows.length}
					</span>
				)}
			</button>
			)}
			{open && (
				<div className={[
					'absolute z-50 w-[420px] max-h-[32rem] flex flex-col rounded-xl border border-border bg-popover shadow-xl shadow-foreground/10',
					// Sidebar variant opens upward and to the right so the 420px
					// panel clears the narrow rail instead of being clipped by it.
					sidebar ? 'left-0 bottom-full mb-1' : ['top-full mt-1', align === 'left' ? 'left-0' : 'right-0'].join(' '),
				].join(' ')}>

					{/* Header strip */}
					<div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
						{selected ? (
							<button
								type="button"
								onClick={() => { setSelected(null); setSelectedId(null); }}
								className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
								title="Back to list"
							>
								<ArrowLeft className="w-3.5 h-3.5" />
							</button>
						) : (
							<Boxes className="w-4 h-4 text-gold-600 flex-shrink-0" />
						)}
						<div className="flex-1 min-w-0">
							<div className="text-[12.5px] font-semibold text-foreground truncate">
								{selected ? selected.title : 'Artifacts'}
							</div>
							<div className="text-[10.5px] text-muted-foreground truncate">
								{selected
									? `${selected.kind}${selected.language ? ' · ' + selected.language : ''} · ${selected.content.length} chars`
									: `${rows.length} saved`}
							</div>
						</div>
						{selected && (
							<div className="flex items-center gap-0.5">
								<button
									type="button"
									onClick={copyContent}
									title={copied ? 'Copied' : 'Copy'}
									className={[
										'p-1.5 rounded-md transition-colors',
										copied ? 'text-gold-700 bg-gold-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
									].join(' ')}
								>
									<Copy className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={downloadOne}
									title="Download"
									className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
								>
									<Download className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={() => deleteOne(selected.id)}
									title="Delete"
									className="p-1.5 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						)}
					</div>

					{/* Body — list mode or detail mode */}
					<div className="flex-1 min-h-0 overflow-y-auto">
						{!selected && (
							<>
								{loading && (
									<div className="px-3 py-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
										<Loader2 className="w-3 h-3 animate-spin" /> Loading…
									</div>
								)}
								{!loading && rows.length === 0 && (
									<div className="px-3 py-4 text-[11.5px] text-muted-foreground italic leading-snug">
										No artifacts yet. The agent saves long-form output here when you ask — research briefs, code listings, anything worth keeping.
									</div>
								)}
								{rows.map((r) => (
									<button
										key={r.id}
										type="button"
										onClick={() => loadOne(r.id)}
										className="w-full text-left px-3 py-1.5 border-b border-border/40 last:border-b-0 hover:bg-muted/60 transition-colors"
									>
										<div className="flex items-center gap-1.5">
											<KindIcon k={r.kind} />
											<span className="text-[12.5px] font-medium text-foreground truncate flex-1">{r.title}</span>
											<span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
												{Math.round(r.bytes / 1024)}KB
											</span>
										</div>
										<div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
											<span>{r.kind}</span>
											{r.language && <span>· {r.language}</span>}
											{r.source_tool && <span>· {r.source_tool}</span>}
											<span className="ml-auto">{relativeTime(r.created_at)}</span>
										</div>
									</button>
								))}
							</>
						)}
						{selectedLoading && (
							<div className="px-3 py-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
								<Loader2 className="w-3 h-3 animate-spin" /> Loading…
							</div>
						)}
						{selected && !selectedLoading && (
							<div className="px-3 py-2.5 text-[12.5px]">
								<ArtifactView kind={selected.kind} content={selected.content} title={selected.title} language={selected.language} />
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// Compact relative stamp for the list rows ("now", "5m", "3h", "2d").
// Deliberately terser than lib/relative-time.ts::formatRelative, which spells
// out "5 minutes ago" — too wide for a 420px panel row.
function relativeTime(iso: string): string {
	try {
		const d = new Date(iso).getTime();
		const diff = (Date.now() - d) / 1000;
		if (diff < 60) return 'now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		return `${Math.floor(diff / 86400)}d`;
	} catch { return iso.slice(0, 10); }
}
