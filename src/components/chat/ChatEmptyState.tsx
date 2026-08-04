// ChatEmptyState — the context-aware "try asking" chips shown BELOW the
// composer before the first message (claude.ai-home style).
//
//   <ChatHero />        — golden spiral + serif greeting. Rendered ABOVE the
//                         composer.
//   <ChatEmptyState />  — the suggestion chips, rendered BELOW the composer.
//
// The live "Right now" digest moved to the top-bar ticker (TopStatusStrip),
// which is present on every page — so it's no longer duplicated here.

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { buildViewingContext, type ViewingContext } from '@/components/StudioContext';
import { appTitle } from '@/components/workflow/AppCard';
import { loopLabel } from '@/lib/workflow-names';

const fire = (prompt: string, context?: Partial<ViewingContext>) =>
	window.dispatchEvent(new CustomEvent('studio:ask', { detail: { prompt, autosend: true, context } }));

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
			{/* Golden spiral brand mark. */}
			<img src="/auth/spiral.png" alt="Lumid" className="mx-auto mb-3 h-11 w-auto select-none" draggable={false} />

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
				{ label: 'suggest an improvement', prompt: `Look at this agent's recent runs and suggest one concrete improvement.`, context: base },
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
				{ label: 'what should I install next?', prompt: 'Based on my installed agents and how I use them, what from the marketplace would help most?' },
			];
		case 'knowledge':
		case 'knowledge-agent':
			return [
				{ label: 'what did you learn about me this week?', prompt: 'What did you learn about me this week?' },
			];
		default:
			// Chat-home landing. Initiate with concrete working-contexts a common
			// user can explore by clicking — FinData (market data), a FinData→Lumilake
			// analysis (HALO-optimized workflow via /ll), and QuantArena (trading).
			// Each prompt drives the agent to render the app's live surface / DAG inline.
			return [
				{ label: 'Explore a stock — AAPL', prompt: 'Explore AAPL — show its price chart and key fundamentals from FinData.' },
				{ label: 'Analyze NVDA with Lumilake', prompt: 'Analyze NVDA — pull its recent daily prices from FinData, then compose and run a HALO-optimized Lumilake workflow that summarizes the trend and flags risks.' },
				{ label: "Today's market movers", prompt: "Show today's top market gainers and losers from FinData." },
				{ label: 'Trading leaderboard', prompt: 'Show the QuantArena trading competition leaderboard.' },
				{ label: 'What did you learn this week?', prompt: 'What did you learn about me this week?' },
			];
	}
}

const PILL =
	'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors';

export default function ChatEmptyState() {
	const location = useLocation();
	const ctx = useMemo(
		() => buildViewingContext(location.pathname, location.search),
		[location.pathname, location.search],
	);
	const samples = samplesFor(ctx);

	// One quiet row of context-aware suggestions, capped at 3 — the live digest
	// now lives in the top-bar "Right now" ticker.
	return (
		<div className="flex flex-wrap justify-center gap-1.5 max-w-[640px] mx-auto w-full">
			{samples.slice(0, 4).map((s) => (
				<button key={s.label} onClick={() => fire(s.prompt, s.context)} className={PILL}>
					{s.label}
				</button>
			))}
		</div>
	);
}
