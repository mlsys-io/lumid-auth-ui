// ChatEmptyState — what the chat rail shows before the first message.
//
// The old version was a static greeting + four generic prompts, leaving
// a tall void. This one earns the space with live, grounded content:
//
//   1. "Right now" — a digest of what's actually happening (failing /
//      running workflows, pending drafts), each row one click from a
//      grounded chat action (the prompt ships ViewingContext overrides).
//   2. Context prompts — "try asking" chips that change with the page
//      the user is looking at (app page asks about THAT app).
//   3. Capability-gated starters, compacted at the bottom.
//
// Data comes from the same endpoints the pages poll (listWorkflows +
// drafts); refreshes on the chat→page bus so a fix reflects here too.

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, Lock, AlertTriangle, Activity, FileText } from 'lucide-react';
import { me, type MeWorkflowRow } from '@/api/me';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useStudioRefetch } from '@/hooks/useStudioRefetch';
import { STARTERS, missingReq, CONNECT_ROUTE } from '@/components/studio/starters';
import { buildViewingContext, type ViewingContext } from '@/components/StudioContext';
import { appTitle } from '@/components/workflow/AppCard';
import { loopLabel } from '@/lib/workflow-names';

const fire = (prompt: string, context?: Partial<ViewingContext>) =>
	window.dispatchEvent(new CustomEvent('studio:ask', { detail: { prompt, autosend: true, context } }));

function loopOf(w: MeWorkflowRow): string {
	const app = w.app || '';
	if (app && w.slug.startsWith(app + ':')) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(':');
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

// Page-aware "try asking" chips. The chat rail persists across pages,
// so these flip as the user navigates — the visible promise that the
// AI knows where they are.
function samplesFor(ctx: ViewingContext): Array<{ label: string; prompt: string; context?: Partial<ViewingContext> }> {
	const appName = ctx.app ? appTitle(ctx.app) : '';
	switch (ctx.page) {
		case 'app': {
			const base = { app: ctx.app, loop: ctx.loop };
			return [
				ctx.loop
					? { label: `walk me through the last ${loopLabel(undefined, ctx.loop)} run`, prompt: `Walk me through the last ${loopLabel(undefined, ctx.loop)} run — what it did, what it learned, anything wrong.`, context: base }
					: { label: `how is ${appName} doing?`, prompt: `How is ${appName} doing — health, recent runs, anything I should act on?`, context: base },
				{ label: 'suggest an improvement', prompt: `Look at this app's recent runs and suggest one concrete improvement.`, context: base },
				{ label: `what has it learned lately?`, prompt: `What has ${appName} learned recently (new memories, adopted offers)?`, context: base },
			];
		}
		case 'runs':
			return [
				{ label: 'what failed today?', prompt: 'What failed today? Use list_runs with state=failed and diagnose the most recent one.' },
				{ label: 'anything unusually slow?', prompt: 'Looking at recent runs, is anything running unusually long or stuck?' },
			];
		case 'skills':
			return [
				{ label: 'which skills are failing CI?', prompt: 'Which of my skills are failing CI or flagged broken?' },
				{ label: 'any updates worth pulling?', prompt: 'Do any of my installed skills have newer versions worth updating to? Anything breaking?' },
			];
		case 'experiments':
			return [
				{ label: 'which experiments are winning?', prompt: 'Which experiments have a winning variant — and should I adopt any?' },
				{ label: 'summarize what they learned', prompt: 'Summarize what my experiments learned this week.' },
			];
		case 'inbox':
			return [
				{ label: "what's pending in my inbox?", prompt: "What's pending in my inbox?" },
				{ label: 'send any obvious replies', prompt: 'Send any obvious replies.' },
			];
		case 'marketplace':
			return [
				{ label: 'what should I install next?', prompt: 'Based on my installed apps and how I use them, what from the marketplace would help most?' },
			];
		case 'knowledge':
		case 'knowledge-agent':
			return [
				{ label: 'what did you learn about me this week?', prompt: 'What did you learn about me this week?' },
			];
		default:
			return [
				{ label: 'what should I do next?', prompt: 'what should I do next?' },
				{ label: "what's pending in my inbox?", prompt: "what's pending in my inbox?" },
				{ label: 'what did you learn about me this week?', prompt: 'what did you learn about me this week?' },
			];
	}
}

export default function ChatEmptyState() {
	const caps = useCapabilities();
	const navigate = useNavigate();
	const location = useLocation();
	const [wfs, setWfs] = useState<MeWorkflowRow[]>([]);
	const [draftCount, setDraftCount] = useState(0);

	const load = () => {
		me.listWorkflows()
			.then((r) => setWfs((r.workflows || []).filter((w) => w.tenant || w.showcase)))
			.catch(() => { /* digest just stays empty */ });
		me.listDrafts({ state: 'pending' })
			.then((r) => setDraftCount(r.drafts?.length || 0))
			.catch(() => { /* ignore */ });
	};
	useEffect(load, []);
	useStudioRefetch(['workflows', 'loops', 'runs', 'cycles', 'drafts'], load);

	const failing = wfs.filter((w) => w.enabled !== false && w.last_run_ok === false).slice(0, 3);
	const running = wfs.filter((w) => w.running).slice(0, 2);
	const hasDigest = failing.length > 0 || running.length > 0 || draftCount > 0;

	const ctx = useMemo(
		() => buildViewingContext(location.pathname, location.search),
		[location.pathname, location.search],
	);
	const samples = samplesFor(ctx);
	const starters = STARTERS.slice(0, 3);

	return (
		<div className="pt-6 text-center text-xs text-slate-500 space-y-3">
			<div className="relative inline-block">
				<div className="absolute inset-0 bg-emerald-400/20 blur-2xl rounded-full" />
				<div className="relative w-11 h-11 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-200">
					<Bot className="w-5 h-5" />
				</div>
			</div>
			<div className="space-y-1">
				<div className="text-sm font-semibold text-slate-900">Hi — I&apos;m your AI.</div>
				<p className="text-[11.5px] leading-relaxed max-w-[260px] mx-auto">
					I can see this page. Ask in plain English.
				</p>
			</div>

			{/* ── Right now — the live digest; each row is a grounded action ── */}
			{hasDigest && (
				<div className="pt-1 text-left max-w-xs mx-auto space-y-1.5">
					<div className="text-[10px] tracking-[0.08em] font-semibold text-slate-400 uppercase px-0.5">Right now</div>
					{failing.map((w) => {
						const loop = loopOf(w);
						return (
							<button
								key={w.slug}
								onClick={() => fire(
									`The ${loopLabel(w.name, loop)} workflow in ${w.app} is failing — diagnose it and tell me how to fix it.`,
									{ app: w.app, loop },
								)}
								className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50/70 border border-rose-200/60 hover:bg-rose-100/70 transition-colors text-left"
							>
								<AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
								<span className="flex-1 min-w-0 truncate text-rose-900">
									{appTitle(w.app || '')} · {loopLabel(w.name, loop)} failing
								</span>
								<span className="text-[10px] font-medium text-rose-700 shrink-0">diagnose</span>
							</button>
						);
					})}
					{running.map((w) => {
						const loop = loopOf(w);
						return (
							<button
								key={w.slug}
								onClick={() => fire(
									`The ${loopLabel(w.name, loop)} workflow is running right now — what is it doing?`,
									{ app: w.app, loop },
								)}
								className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-50/70 border border-sky-200/60 hover:bg-sky-100/70 transition-colors text-left"
							>
								<Activity className="w-3.5 h-3.5 shrink-0 text-sky-600 animate-pulse" />
								<span className="flex-1 min-w-0 truncate text-sky-900">
									{appTitle(w.app || '')} · {loopLabel(w.name, loop)} running
								</span>
								<span className="text-[10px] font-medium text-sky-700 shrink-0">watch</span>
							</button>
						);
					})}
					{draftCount > 0 && (
						<button
							onClick={() => fire(`I have ${draftCount} pending draft${draftCount === 1 ? '' : 's'} — walk me through them.`)}
							className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50/70 border border-amber-200/60 hover:bg-amber-100/70 transition-colors text-left"
						>
							<FileText className="w-3.5 h-3.5 shrink-0 text-amber-600" />
							<span className="flex-1 min-w-0 truncate text-amber-900">
								{draftCount} draft{draftCount === 1 ? '' : 's'} awaiting you
							</span>
							<span className="text-[10px] font-medium text-amber-700 shrink-0">review</span>
						</button>
					)}
				</div>
			)}

			{/* ── Context prompts — change with the page the user is on ── */}
			<div className="pt-1 text-left max-w-xs mx-auto space-y-1.5">
				<div className="text-[10px] tracking-[0.08em] font-semibold text-slate-400 uppercase px-0.5">
					{ctx.page === 'app' && ctx.app ? `About ${appTitle(ctx.app)}` : 'Try asking'}
				</div>
				{samples.map((s) => (
					<button
						key={s.label}
						onClick={() => fire(s.prompt, s.context)}
						className="w-full text-left px-3 py-1.5 rounded-lg bg-white/60 border border-slate-200/60 text-slate-600 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-900 transition-colors"
					>
						{s.label}
					</button>
				))}
			</div>

			{/* ── Starters — set something new up (capability-gated) ── */}
			<div className="pt-1 space-y-1.5 text-left max-w-xs mx-auto">
				<div className="text-[10px] tracking-[0.08em] font-semibold text-slate-400 uppercase px-0.5">Set up</div>
				{starters.map((s) => {
					const missing = missingReq(s, caps);
					const Icon = missing ? Lock : s.icon;
					return (
						<button
							key={s.title}
							onClick={() => missing ? navigate(CONNECT_ROUTE[missing]) : fire(s.prompt)}
							className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/70 border border-slate-200/60 hover:bg-emerald-50 hover:border-emerald-200 transition-colors"
						>
							<Icon className={`w-3.5 h-3.5 shrink-0 ${missing ? 'text-slate-400' : 'text-emerald-600'}`} />
							<span className="flex-1 text-slate-700">{s.title}</span>
							{missing && <span className="text-[10px] text-amber-600">connect {missing}</span>}
						</button>
					);
				})}
			</div>
		</div>
	);
}
