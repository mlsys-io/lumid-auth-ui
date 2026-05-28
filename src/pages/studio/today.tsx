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
import { Link } from 'react-router-dom';
import {
	Sparkles, Sun, Mail, Search, Calendar, ArrowRight, MessagesSquare,
} from 'lucide-react';
import AppLoops from '../app-revamp/loops';
import { me } from '@/api/me';
import { useAuth } from '@/hooks/useAuth';
import { IntentRail, type Intent } from '@/components/IntentRail';
import { OutcomeRow, type Outcome } from '@/components/OutcomeTile';
import { DecisionsPending } from '@/components/DecisionsPending';
import { DEMO_MODE } from '@/lib/demo';

// Demo content for the Intents view. Hardcoded here (the parent) per the
// demo plan; gated behind DEMO_MODE so it vanishes in the real build.
const DEMO_INTENTS: Intent[] = [
	{
		id: 'common-week-2',
		persona: 'common person · week 2',
		text: 'Handle my weekly inbox and calendar the way I would',
		progress: 60,
		latest: '12 drafts queued, 2 conflicts resolved',
	},
	{
		id: 'scientist-cycle-3',
		persona: 'scientist · cycle 3',
		text: 'Find the best NL-to-SQL config under 200ms',
		progress: 35,
		latest: '4 variants benchmarked, Pareto updated',
	},
];

const DEMO_OUTCOMES: Outcome[] = [
	{ label: 'Hours reclaimed', value: '4h 12m', delta: '+48m vs last week', deltaTone: 'up' },
	{ label: 'Agent matches your call', value: '84%', delta: 'up from 78%', deltaTone: 'up' },
	{ label: 'Decisions delegated', value: '14', delta: 'was 9 last week', deltaTone: 'neutral' },
];

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

	return (
		<div className="space-y-6">
			{empty === true && <FreshUserHero name={name} />}
			{empty === false && DEMO_MODE && (
				<>
					<IntentRail intents={DEMO_INTENTS} />
					<OutcomeRow outcomes={DEMO_OUTCOMES} />
					<DecisionsPending />
				</>
			)}
			{/* Workflow list is canonical on /studio/workflows; only fall
			    back to it here when the demo's three hero sections aren't
			    rendering (production, no demo content yet). PageHints
			    chips removed — the chat sidebar is the canonical ask
			    surface, the chips were instructional noise on the hero. */}
			{(empty === false && !DEMO_MODE) && <AppLoops />}
		</div>
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
];

function FreshUserHero({ name }: { name: string }) {
	const dispatch = (prompt: string) => {
		window.dispatchEvent(new CustomEvent('studio:ask', {
			detail: { prompt, autosend: true },
		}));
	};

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

			{/* Four concrete starters — one click installs + schedules */}
			<div>
				<div className="text-[11px] tracking-[0.08em] font-medium text-slate-400 mb-2">
					Quick starters
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
					{STARTERS.map((s) => (
						<StarterCard key={s.title} s={s} onClick={() => dispatch(s.prompt)} />
					))}
				</div>
			</div>

			{/* Custom path — for users who know exactly what they want */}
			<div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3">
				<div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
					<MessagesSquare className="w-4 h-4" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="text-sm font-medium text-slate-900">Or just tell us what you want</div>
					<div className="text-[12px] text-slate-500 mt-0.5">
						Type into the AI panel on the right — it will compose, install, and schedule for you.
					</div>
				</div>
				<button
					onClick={() => {
						window.dispatchEvent(new CustomEvent('studio:ask', {
							detail: {
								prompt: 'I want to set up my first workflow. Help me think through what would be most useful for my day.',
								autosend: true,
							},
						}));
					}}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-900 text-white hover:bg-slate-800 active:scale-95 transition-all flex-shrink-0"
				>
					Start chat <ArrowRight className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* Quiet escape hatch — for power users who want to browse */}
			<div className="text-center pt-1">
				<Link
					to="/studio/library"
					className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-700 transition-colors"
				>
					Or browse the marketplace
					<ArrowRight className="w-3 h-3" />
				</Link>
			</div>
		</div>
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
