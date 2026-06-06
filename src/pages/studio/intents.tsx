// /studio/today — fresh-user onboarding hub + returning-user dashboard.
//
// Fresh users (no tenant apps yet) see a streamlined hero:
//   - One clear ask: "What should we set up for you?"
//   - 4 concrete starter chips (Daily brief / Email triage /
//     Research assistant / Meeting prep) — each dispatches a
//     studio:ask event so the chat agent handles compose+install
//   - One quiet escape hatch: "Or browse the marketplace"
//
// Returning users see AppLoops (recent cycles + headlines) as before.

import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import WorkflowComposer from '@/components/WorkflowComposer';
import {
	Sparkles, Sun, Mail, Search, Calendar, ArrowRight, MessagesSquare,
	TrendingUp,
} from 'lucide-react';
import AppLoops from '../app-revamp/loops';
import { me } from '@/api/me';
import { useAuth } from '@/hooks/useAuth';
import { IntentJournal } from '@/components/IntentJournal';
import { DEMO_MODE } from '@/lib/demo';
import { DEMO_INTENTS as INTENT_REGISTRY } from '@/lib/demo-intents';

export default function StudioToday() {
	const { user } = useAuth();
	const [empty, setEmpty] = useState<boolean | null>(null);
	const name = useMemo(() => {
		const raw = user?.username || user?.email?.split('@')[0] || '';
		const first = raw.split(/[\s.]+/)[0];
		return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
	}, [user?.username, user?.email]);
	useEffect(() => {
		me.listApps()
			.then((r: any) => {
				const tenantApps = (r.apps || []).filter((a: any) => a.tenant);
				setEmpty(tenantApps.length === 0);
			})
			.catch(() => setEmpty(false));
	}, []);

	// Compose host — the modal opens only on an explicit `?compose=1`
	// deep-link now. It no longer auto-opens when the chat agent finishes a
	// compose_workflow: that build renders inline in the chat (AssemblyCard),
	// not as a popup. See StudioChat's compose_workflow handler.
	const [composerOpen, setComposerOpen] = useState(false);
	const [searchParams, setSearchParams] = useSearchParams();
	useEffect(() => {
		if (searchParams.get('compose') === '1') {
			setComposerOpen(true);
			const sp = new URLSearchParams(searchParams);
			sp.delete('compose');
			setSearchParams(sp, { replace: true });
		}
	}, [searchParams, setSearchParams]);

	return (
		<>
			<WorkflowComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
			{empty === true && <div className="space-y-6"><FreshUserHero name={name} /></div>}
			{empty === false && (
				// Stage 1 — "given an intent, assemble a workflow (from the
				// workspace or AI-generated)" — is the standing, recurring
				// action, not a first-run-only thing. So the quick starters
				// STICK here above the user's existing intents/workflows, as a
				// permanent "start a new intent" launcher.
				<div className="space-y-6">
					<QuickStarters heading="Start a new intent" />
					{DEMO_MODE
						// IntentJournal reclaims the page-shell padding to paint
						// its editorial spread edge-to-edge; it sits below the
						// launcher as the user's standing-intent surface.
						? <IntentJournal intents={INTENT_REGISTRY} />
						: <AppLoops />}
				</div>
			)}
		</>
	);
}

// ── Fresh-user hero ────────────────────────────────────────────────

interface Starter {
	icon: React.ComponentType<{ className?: string }>;
	tone: 'amber' | 'rose' | 'sky' | 'violet' | 'indigo';
	title: string;
	subtitle: string;
	prompt: string;
}

const STARTERS: Starter[] = [
	{
		icon: Sun,
		tone: 'amber',
		title: 'Daily brief',
		subtitle: 'Every morning at 7am, summarize what I need to know.',
		prompt: 'Set up a daily brief — every morning at 7am, summarize my email, calendar, and any pending tasks.',
	},
	{
		icon: Mail,
		tone: 'rose',
		title: 'Email triage',
		subtitle: 'Watch my inbox; draft replies to anything obvious.',
		prompt: 'Set up email triage — every hour during work hours, scan my inbox and draft replies to anything obvious.',
	},
	{
		icon: Search,
		tone: 'sky',
		title: 'Research assistant',
		subtitle: 'Track a topic; surface what changed today.',
		prompt: 'Set up a research assistant — pick a topic with me, and every morning surface the latest changes.',
	},
	{
		icon: Calendar,
		tone: 'violet',
		title: 'Meeting prep',
		subtitle: 'Before each meeting, brief me on the attendees + context.',
		prompt: 'Set up meeting prep — 30 minutes before each meeting, brief me on the attendees, prior threads, and any context I need.',
	},
	{
		icon: TrendingUp,
		tone: 'indigo',
		title: 'Compose: daily web-research brief',
		subtitle: 'Assemble a brand-new workflow: research a topic and brief me each morning.',
		// The creation demo (Stage 1, assemble-from-intent): the prompt
		// explicitly asks the agent to compose_workflow (not install an
		// existing app), and names catalog-backed capabilities (web search +
		// scraping) so the token scorer assembles a real, runnable draft →
		// studio:composed → WorkflowComposer → review + install.
		// (The trading-flavoured "KOL tweets → strategy" variant is parked
		// until the FinData-backed catalog skills are published — Path B.)
		prompt: 'Compose a brand-new daily web-research brief workflow NOW — don\'t ask me questions, use sensible defaults (topic: AI industry news, 8am daily). Call compose_workflow with that intent to draft it from the marketplace catalog (web search + scraping), then show me the draft so I can review, tweak the topic/schedule, and install it.',
	},
];

function FreshUserHero({ name }: { name: string }) {
	return (
		<div className="space-y-5">
			{/* Hero — greeting + single primary ask */}
			<section className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50 via-white to-sky-50/40 p-6">
				<div className="flex items-start gap-3">
					<div className="relative flex-shrink-0">
						<div className="absolute inset-0 bg-emerald-400/30 blur-md rounded-full" />
						<div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center shadow-sm shadow-emerald-200">
							<Sparkles className="w-5 h-5" />
						</div>
					</div>
					<div className="flex-1 min-w-0">
						<h2 className="text-xl font-medium text-slate-900 tracking-tight">
							{name ? `Welcome, ${name}.` : 'Welcome.'}
						</h2>
						<p className="text-sm text-slate-600 mt-1 leading-relaxed">
							Lumid runs AI workflows for you in the background — email triage, daily briefs,
							anything you can describe. Pick a starter below, or just tell us what you want.
						</p>
					</div>
				</div>
			</section>

			<QuickStarters />

			{/* Quiet escape hatch — for power users who want to browse */}
			<div className="text-center pt-1">
				<a
					href="https://xp.io"
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-700 transition-colors"
				>
					Or browse the marketplace
					<ArrowRight className="w-3 h-3" />
				</a>
			</div>
		</div>
	);
}

// QuickStarters — the Stage 1 launcher: pick a starter (the AI composes +
// installs a workflow) or describe a new intent free-form. Rendered in the
// fresh-user hero AND, permanently, above a returning user's intents — Stage 1
// ("given an intent, assemble a workflow") is a recurring action, so this
// surface always sticks.
export function QuickStarters({ heading = 'Quick starters' }: { heading?: string }) {
	const dispatch = (prompt: string) =>
		window.dispatchEvent(new CustomEvent('studio:ask', { detail: { prompt, autosend: true } }));
	return (
		<div className="space-y-3">
			<div className="text-[11px] tracking-[0.08em] font-medium text-slate-400">
				{heading}
			</div>

			{/* Tight 2×2: three concrete starters + one free-form "describe". */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
				{STARTERS.slice(0, 3).map((s) => (
					<StarterCard key={s.title} s={s} onClick={() => dispatch(s.prompt)} />
				))}
				<DescribeCard onClick={() => dispatch('I want to set up a new workflow. Help me think through what would be most useful, then compose and install it.')} />
			</div>
		</div>
	);
}

// Describe-what-you-want — the free-form fourth tile, styled like a
// StarterCard so the launcher reads as one clean 2×2 grid.
function DescribeCard({ onClick }: { onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			className="group rounded-xl border border-dashed border-emerald-300/70 bg-emerald-50/30 p-3 text-left transition-all flex items-start gap-3 hover:shadow-sm hover:bg-emerald-50/60 active:scale-[0.98]"
		>
			<div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105">
				<MessagesSquare className="w-4 h-4" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="font-medium text-slate-900 text-[13px] leading-tight">Describe what you want</div>
				<div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">
					Tell the AI in your words — it composes, installs, and schedules it.
				</div>
			</div>
			<ArrowRight className="w-3.5 h-3.5 text-emerald-400 group-hover:text-emerald-600 transition-colors flex-shrink-0 mt-1" />
		</button>
	);
}

function StarterCard({ s, onClick }: { s: Starter; onClick: () => void }) {
	const Icon = s.icon;
	const tones: Record<Starter['tone'], { bg: string; iconBg: string; iconText: string; border: string }> = {
		amber:  { bg: 'hover:bg-amber-50/60',  iconBg: 'bg-amber-100',  iconText: 'text-amber-700',  border: 'hover:border-amber-200' },
		rose:   { bg: 'hover:bg-rose-50/60',   iconBg: 'bg-rose-100',   iconText: 'text-rose-700',   border: 'hover:border-rose-200' },
		sky:    { bg: 'hover:bg-sky-50/60',    iconBg: 'bg-sky-100',    iconText: 'text-sky-700',    border: 'hover:border-sky-200' },
		violet: { bg: 'hover:bg-violet-50/60', iconBg: 'bg-violet-100', iconText: 'text-violet-700', border: 'hover:border-violet-200' },
		indigo: { bg: 'hover:bg-indigo-50/60', iconBg: 'bg-indigo-100', iconText: 'text-indigo-700', border: 'hover:border-indigo-200' },
	};
	const t = tones[s.tone];
	return (
		<button
			onClick={onClick}
			className={[
				'group rounded-xl border border-slate-200 bg-white p-3 text-left transition-all',
				'flex items-start gap-3 hover:shadow-sm active:scale-[0.98]',
				t.bg, t.border,
			].join(' ')}
		>
			<div className={[
				'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105',
				t.iconBg, t.iconText,
			].join(' ')}>
				<Icon className="w-4 h-4" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="font-medium text-slate-900 text-[13px] leading-tight">{s.title}</div>
				<div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{s.subtitle}</div>
			</div>
			<ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 transition-colors flex-shrink-0 mt-1" />
		</button>
	);
}
