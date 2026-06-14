// AppSurfaceCard — renders an app's home surface inline inside the chat, so
// opening an app drops you into the conversation with its page (stats, tables,
// forms) right there as a live, interactive card. Reuses the same directive
// renderer (LumidMarkdown) the standalone surface uses; forms/actions keep
// hitting the allowlisted backends. Native/interactive surfaces (e.g. the
// gpu-rentals SSH terminal) aren't embedded — they link out to the full view.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { me, type MeAppSurface, type MeWorkflowRow, MeApiError } from '@/api/me';
import { LumidMarkdown } from '@/components/app-surface/LumidMarkdown';
import { appTitle, appHasSurface } from '@/components/workflow/AppCard';
import { TONES, workflowTone } from '@/lib/tones';
import { loopLabel } from '@/lib/workflow-names';

function relSec(tsSec?: number): string {
	if (!tsSec) return '';
	const diff = Date.now() / 1000 - tsSec;
	if (diff < 60) return 'just now';
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

// Inline overview for loop apps with no custom surface — the workflow-health
// rows the old observability page led with, so opening any app in chat is
// useful (not a "no page yet" dead end).
function OverviewBody({ app }: { app: string }) {
	const [wfs, setWfs] = useState<MeWorkflowRow[] | null>(null);
	useEffect(() => {
		let live = true;
		me.listWorkflows("scheduled")
			.then((r) => { if (live) setWfs((r.workflows || []).filter((w) => w.app === app)); })
			.catch(() => { if (live) setWfs([]); });
		return () => { live = false; };
	}, [app]);
	if (wfs === null) return <div className="text-[12px] text-muted-foreground py-2 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>;
	if (wfs.length === 0) return <div className="text-[12px] text-muted-foreground py-1">No workflows yet — ask me to set one up.</div>;
	return (
		<div className="divide-y divide-border/60">
			{wfs.map((w) => {
				const loop = w.app && w.slug.startsWith(w.app + ':') ? w.slug.slice(w.app.length + 1) : w.slug;
				const tone = TONES[workflowTone(w)];
				return (
					<div key={w.slug} className="flex items-center gap-2.5 py-1.5 text-[12.5px]">
						<span className={`w-2 h-2 rounded-full shrink-0 ${tone.dot}`} />
						<span className="flex-1 min-w-0 truncate text-foreground">{loopLabel(w.name, loop)}</span>
						<span className="text-[10.5px] text-muted-foreground shrink-0">{w.trigger || ''}{w.last_run_ts ? ` · ${relSec(w.last_run_ts)}` : ''}</span>
					</div>
				);
			})}
		</div>
	);
}

// Flatten the app's xpcloud config into {config.<key>} params so directive
// sources like qa://dashboard/leaderboard/{config.primary_contest} resolve —
// the same substitution AppSurface does. Without this the token stays literal
// and the fetch errors (the red chips on config-templated surfaces).
function configParams(config?: Record<string, unknown>): Record<string, string> {
	const params: Record<string, string> = {};
	for (const [k, v] of Object.entries(config ?? {})) {
		if (['string', 'number', 'boolean'].includes(typeof v)) params[`config.${k}`] = String(v);
	}
	return params;
}

// Drop a leading "# Title" so it doesn't duplicate the card header.
function stripH1(md: string): string {
	const lines = md.split('\n');
	let i = 0;
	while (i < lines.length && !lines[i].trim()) i++;
	if (lines[i]?.startsWith('# ')) {
		lines.splice(0, i + 1);
		return lines.join('\n');
	}
	return md;
}

export default function AppSurfaceCard({ app, surface }: { app: string; surface?: string }) {
	const [state, setState] = useState<{ data?: MeAppSurface; loading: boolean; error?: string; noSurface?: boolean }>({ loading: true });

	useEffect(() => {
		let live = true;
		// Skip the probe entirely for apps we already know declare no surface —
		// go straight to the overview, avoiding a 404 the browser logs.
		if (appHasSurface(app) === false) {
			setState({ loading: false, noSurface: true });
			return () => { live = false; };
		}
		setState({ loading: true });
		me.appUI(app, surface)
			.then((data) => { if (live) setState({ data, loading: false }); })
			.catch((e) => {
				if (!live) return;
				if (e instanceof MeApiError && e.ret_code === 1404) setState({ loading: false, noSurface: true });
				else setState({ loading: false, error: String(e?.message ?? e) });
			});
		return () => { live = false; };
	}, [app, surface]);

	// Full-view target: the observability panel for surfaceless (loop) apps,
	// the standalone surface page for apps that declare one.
	const fullHref = state.noSurface
		? `/studio/apps/${encodeURIComponent(app)}?full=1`
		: `/studio/a/${encodeURIComponent(app)}${surface && surface !== 'home' ? `/${encodeURIComponent(surface)}` : ''}?full=1`;

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden max-w-full">
			<div className="flex items-center gap-2 px-3 py-2 border-b border-border/70">
				<span className="text-[13px] font-medium text-foreground flex-1 truncate">{appTitle(app)}</span>
				<Link
					to={fullHref}
					className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
					title="Open the full page"
				>
					open full view <ArrowUpRight className="w-3 h-3" />
				</Link>
			</div>
			<div className="px-3 py-3">
				{state.loading ? (
					<div className="flex items-center gap-2 text-[12px] text-muted-foreground py-4">
						<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading {appTitle(app)}…
					</div>
				) : state.noSurface ? (
					// No custom surface — show the app's workflow overview instead
					// of a dead end, so opening a loop app in chat is useful.
					<OverviewBody app={app} />
				) : state.error ? (
					<div className="text-[12px] text-rose-600 py-2">Couldn’t load this app’s surface. <Link to={fullHref} className="underline">Open full view →</Link></div>
				) : state.data?.native ? (
					// Interactive native surface (terminal/SSH/logs) — not embeddable
					// in chat; the agent reports status and links to the full view.
					<div className="text-[12px] text-muted-foreground py-2">
						This is an interactive view. <Link to={fullHref} className="text-coral hover:underline">Open it full-screen →</Link>
					</div>
				) : state.data?.markdown ? (
					<div className="lumid-surface-in-chat text-[13px]">
						<LumidMarkdown
							source={stripH1(state.data.markdown)}
							params={configParams(state.data.config)}
							appConfig={state.data.config}
						/>
					</div>
				) : (
					<div className="text-[12px] text-muted-foreground py-2">This app declares no surface content.</div>
				)}
			</div>
		</div>
	);
}
