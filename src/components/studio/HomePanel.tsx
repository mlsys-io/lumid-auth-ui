// HomePanel — the LEFT column of the Studio workspace when no app is featured
// (the front page). A compact "control surface": what needs attention right
// now, your apps (click → open that app's workspace), and quick actions. The
// chat is the RIGHT column; this panel is the structured context beside it.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Activity, FileText, ArrowRight } from 'lucide-react';
import { me, type MeWorkflowRow } from '@/api/me';
import { useAppNav, iconFor } from '@/components/useAppNav';
import { useStudioRefetch } from '@/hooks/useStudioRefetch';
import { appTitle } from '@/components/workflow/AppCard';
import { loopLabel } from '@/lib/workflow-names';

function loopOf(w: MeWorkflowRow): string {
	const app = w.app || '';
	if (app && w.slug.startsWith(app + ':')) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(':');
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

const SECTION = 'text-[10.5px] tracking-[0.08em] font-medium text-muted-foreground uppercase px-0.5';

export default function HomePanel() {
	const navigate = useNavigate();
	const appNav = useAppNav();
	const [wfs, setWfs] = useState<MeWorkflowRow[]>([]);
	const [draftCount, setDraftCount] = useState(0);
	const liveRef = useRef(true);
	useEffect(() => { liveRef.current = true; return () => { liveRef.current = false; }; }, []);
	const load = () => {
		me.listWorkflows('scheduled')
			.then((r) => { if (liveRef.current) setWfs((r.workflows || []).filter((w) => w.tenant || w.showcase)); })
			.catch(() => {});
		me.listDrafts({ state: 'pending' })
			.then((r) => { if (liveRef.current) setDraftCount(r.drafts?.length || 0); })
			.catch(() => {});
	};
	useEffect(load, []);
	useStudioRefetch(['workflows', 'loops', 'drafts'], load);

	const failing = wfs.filter((w) => w.enabled !== false && w.last_run_ok === false).slice(0, 4);
	const running = wfs.filter((w) => w.running).slice(0, 4);
	const hasDigest = failing.length > 0 || running.length > 0 || draftCount > 0;

	const openApp = (app: string, loop?: string) =>
		navigate(`/studio/apps/${encodeURIComponent(app)}${loop ? `?selected=${encodeURIComponent(loop)}` : ''}`);

	return (
		<div className="h-full overflow-y-auto px-4 py-4 space-y-5 max-w-[420px]">
			{/* ── Right now ───────────────────────────────────────────── */}
			{hasDigest && (
				<div className="space-y-1.5">
					<div className={SECTION}>Right now</div>
					{failing.map((w) => {
						const loop = loopOf(w);
						return (
							<button key={w.slug} onClick={() => openApp(w.app || '', loop)}
								className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left text-[12.5px]">
								<AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
								<span className="flex-1 min-w-0 truncate text-foreground">{appTitle(w.app || '')} · {loopLabel(w.name, loop)}</span>
								<span className="text-[11px] font-medium text-rose-700 shrink-0">failing</span>
							</button>
						);
					})}
					{running.map((w) => {
						const loop = loopOf(w);
						return (
							<button key={w.slug} onClick={() => openApp(w.app || '', loop)}
								className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left text-[12.5px]">
								<Activity className="w-3.5 h-3.5 shrink-0 text-sky-600 animate-pulse" />
								<span className="flex-1 min-w-0 truncate text-foreground">{appTitle(w.app || '')} · {loopLabel(w.name, loop)}</span>
								<span className="text-[11px] font-medium text-sky-700 shrink-0">running</span>
							</button>
						);
					})}
					{draftCount > 0 && (
						<button onClick={() => navigate('/studio/inbox')}
							className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left text-[12.5px]">
							<FileText className="w-3.5 h-3.5 shrink-0 text-gold-600" />
							<span className="flex-1 min-w-0 truncate text-foreground">{draftCount} draft{draftCount === 1 ? '' : 's'} awaiting you</span>
							<span className="text-[11px] font-medium text-gold-700 shrink-0">review</span>
						</button>
					)}
				</div>
			)}

			{/* ── Your apps (click → open its workspace) ──────────────── */}
			{appNav.map((sec) => (
				<div key={sec.section} className="space-y-1">
					<div className={SECTION}>{sec.section}</div>
					{sec.items.map((it) => {
						const Icon = iconFor(it.icon);
						return (
							<button key={it.app} onClick={() => openApp(it.app)}
								className="w-full group flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-muted transition-colors text-left text-[13px]">
								<Icon className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
								<span className="flex-1 min-w-0 truncate text-foreground">{it.label}</span>
								<ArrowRight className="w-3.5 h-3.5 shrink-0 text-transparent group-hover:text-muted-foreground transition-colors" />
							</button>
						);
					})}
				</div>
			))}

			{/* ── Quick actions ───────────────────────────────────────── */}
			<div className="space-y-1">
				<div className={SECTION}>Discover</div>
				<button onClick={() => navigate('/studio/library/marketplace')}
					className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-dashed border-border hover:bg-muted transition-colors text-left text-[12.5px] text-muted-foreground hover:text-foreground">
					+ Browse the marketplace
				</button>
			</div>
		</div>
	);
}
