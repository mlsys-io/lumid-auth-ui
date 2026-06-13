// ChatEmptyState — what the chat (the /studio main surface) shows
// before the first message, claude.ai-home style.
//
// Two pieces, because the composer card sits between them in the page:
//
//   <ChatHero />        — lone coral ✳ + serif "Good evening, Yao" +
//                         one-line promise. Rendered ABOVE the composer.
//   <ChatEmptyState />  — the grounded content rendered BELOW it:
//     1. "Right now" — a digest of what's actually happening (failing /
//        running workflows, pending drafts), each row one click from a
//        grounded chat action (the prompt ships ViewingContext overrides).
//     2. Context prompts — "try asking" pills that change with the page.
//     3. Capability-gated starter pills.
//
// Data comes from the same endpoints the pages poll (listWorkflows +
// drafts); refreshes on the chat→page bus so a fix reflects here too.

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lock, AlertTriangle, Activity, FileText } from 'lucide-react';
import { me, type MeWorkflowRow } from '@/api/me';
import { useAuth } from '@/hooks/useAuth';
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

// ChatHero — the greeting block above the composer card.
export function ChatHero() {
	const { user } = useAuth();
	const name = useMemo(() => {
		const raw = user?.username || user?.email?.split('@')[0] || '';
		const first = raw.split(/[\s.]+/)[0];
		return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
	}, [user?.username, user?.email]);
	const h = new Date().getHours();
	const tod = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
	return (
		<div className="text-center select-none">
			<div aria-hidden className="text-coral text-[26px] leading-none mb-3">✳</div>
			<h1 className="font-display text-[26px] font-medium tracking-tight text-foreground">
				Good {tod}{name ? `, ${name}` : ''}
			</h1>
			<p className="mt-1.5 text-[13px] text-muted-foreground">
				I can see this page — ask anything in plain English.
			</p>
		</div>
	);
}

// Page-aware "try asking" pills. The chat is the main surface, but
// studio:ask context still flips with the page the user came from.
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

const PILL =
	'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors';

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
	useStudioRefetch(['workflows', 'loops', 'drafts'], load);

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
		<div className="max-w-[640px] mx-auto w-full space-y-5">
			{/* ── Right now — the live digest; each row is a grounded action ── */}
			{hasDigest && (
				<div className="space-y-1.5">
					<div className="text-[10.5px] tracking-[0.08em] font-medium text-foreground/45 uppercase px-0.5">Right now</div>
					{failing.map((w) => {
						const loop = loopOf(w);
						return (
							<button
								key={w.slug}
								onClick={() => fire(
									`The ${loopLabel(w.name, loop)} workflow in ${w.app} is failing — diagnose it and tell me how to fix it.`,
									{ app: w.app, loop },
								)}
								className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left text-[12.5px]"
							>
								<AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
								<span className="flex-1 min-w-0 truncate text-foreground">
									{appTitle(w.app || '')} · {loopLabel(w.name, loop)} failing
								</span>
								<span className="text-[11px] font-medium text-rose-700 shrink-0">diagnose</span>
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
								className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left text-[12.5px]"
							>
								<Activity className="w-3.5 h-3.5 shrink-0 text-sky-600 animate-pulse" />
								<span className="flex-1 min-w-0 truncate text-foreground">
									{appTitle(w.app || '')} · {loopLabel(w.name, loop)} running
								</span>
								<span className="text-[11px] font-medium text-sky-700 shrink-0">watch</span>
							</button>
						);
					})}
					{draftCount > 0 && (
						<button
							onClick={() => fire(`I have ${draftCount} pending draft${draftCount === 1 ? '' : 's'} — walk me through them.`)}
							className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left text-[12.5px]"
						>
							<FileText className="w-3.5 h-3.5 shrink-0 text-amber-600" />
							<span className="flex-1 min-w-0 truncate text-foreground">
								{draftCount} draft{draftCount === 1 ? '' : 's'} awaiting you
							</span>
							<span className="text-[11px] font-medium text-amber-700 shrink-0">review</span>
						</button>
					)}
				</div>
			)}

			{/* One quiet row of context-aware suggestions — capped at 3 so the
			    empty state stays calm (was two rows = six boxes). Setup actions
			    live on the Apps page's launcher, not here. */}
			<div className="flex flex-wrap justify-center gap-1.5">
				{samples.slice(0, 3).map((s) => (
					<button key={s.label} onClick={() => fire(s.prompt, s.context)} className={PILL}>
						{s.label}
					</button>
				))}
			</div>
		</div>
	);
}
