// Demo intent registry — one source of truth for the rail + the detail
// panel + the URL. Each intent declares its rail data (persona, title,
// chips, latest outcome) and an optional detail body. The detail page
// looks the intent up by id, then dispatches to a body component by
// `body.kind`. Adding a new intent kind = add a discriminated-union
// variant + a body renderer; the shell stays untouched.
//
// Every intent also carries `axisMovements` — what's recently improved
// across the six axes (examples/standard/recipe/pieces/memory/rules).
// The shape mirrors the production /me/intents/:id/audit response so
// the rail card + detail hero render identically once live data flows.

export interface IntentStat {
	label: string;
	value: string;
	delta?: string;
	deltaTone?: 'up' | 'neutral';
}

// Pareto chart point in the SVG viewport (0..600 × 0..240).
export interface ChartPoint { cx: number; cy: number }

export interface Variant {
	id: string;
	config: string;
	accuracy: number; // %
	latency: number; // p95 ms
	cost: number;    // $/1k
	status: 'frontier' | 'dominated' | 'over';
}

export interface ActivityItem {
	when: string;          // human-readable ("just now", "10m ago")
	text: string;          // headline action
	detail?: string;       // optional supporting line
	tone?: 'good' | 'info' | 'warn';
}

export interface AutoresearchBody {
	kind: 'autoresearch';
	direction: string;     // the "direction: latency-prior · changed …" badge
	chart: {
		frontier: ChartPoint[];
		underBudget: ChartPoint[];
		overBudget: ChartPoint[];
	};
	variants: Variant[];
}

export interface JudgmentBody {
	kind: 'judgment';
	activity: ActivityItem[];
	// Optional cross-ref to Knowledge — voice principles that fired today.
	appliedPrinciples?: { text: string; count: number }[];
}

export type IntentBody = AutoresearchBody | JudgmentBody;

// ── Six-axis improvement model ────────────────────────────────────
// Mirrors the production schema in /me/intents/:id/audit. The Axis
// label maps to a user-facing phrase via AXIS_META below — the rail +
// detail components consume only AxisMovement, never the raw word.

export type Axis = 'examples' | 'standard' | 'recipe' | 'pieces' | 'memory' | 'rules';

export interface AxisMovement {
	axis: Axis;
	count: number;           // events in window
	net?: number;            // optional numeric net delta (e.g. metric pp change)
	latest?: string;         // most-recent label, shown on hover/click
}

// ── Narrative bullet (detail hero) ────────────────────────────────
// One human-readable line of "what your AI did this week" — derived
// from the audit ledger in production; declared statically in demo.
export interface NarrativeBullet {
	axis: Axis;
	text: string;            // "raised Voice match from 78% → 84%"
}

export interface IntentDetail {
	period?: string;       // small top-right meta, e.g. "cycle 3 of 12", "week 2"
	stats: IntentStat[];
	narrative?: NarrativeBullet[]; // detail-page hero bullets
	body: IntentBody;
}

export interface DemoIntent {
	id: string;            // URL slug (under /studio/intents/<id>)
	persona: string;
	title: string;
	progress: number;      // 0-100, drives the rail progress bar
	latest: string;        // outcome chip on the card
	chips: string[];       // T12 — skills assembled into this intent's workflow
	live?: boolean;
	axisMovements?: AxisMovement[]; // rail mini-row + detail axis chips
	detail?: IntentDetail; // when set, the rail card becomes clickable
	// Editorial single-line for the paper-journal Show mode. One
	// sentence the user reads to know "what your AI did this week."
	// When omitted, falls back to detail.narrative[0].text.
	summary?: string;
	// One headline outcome inside the intent (e.g. "4h 12m reclaimed").
	// Surfaces inline so the global OutcomeRow can be retired.
	headline?: { label: string; value: string };
}

// User-facing labels + tones for each axis. Single source of truth so
// the card, detail hero, chat tool result, and future docs use the
// same vocabulary.
export const AXIS_META: Record<Axis, { label: string; phrase: string; tone: string }> = {
	standard: { label: 'Standard', phrase: 'how it judges itself',     tone: 'text-violet-700  bg-violet-50  border-violet-100' },
	examples: { label: 'Examples', phrase: 'what it learns from',       tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
	memory:   { label: 'Memory',   phrase: 'what it remembers about you', tone: 'text-sky-700     bg-sky-50     border-sky-100' },
	rules:    { label: 'Rules',    phrase: 'patterns it figured out',   tone: 'text-amber-700   bg-amber-50   border-amber-100' },
	recipe:   { label: 'Recipe',   phrase: 'the steps it takes',        tone: 'text-rose-700    bg-rose-50    border-rose-100' },
	pieces:   { label: 'Pieces',   phrase: 'how it does each step',     tone: 'text-slate-700   bg-slate-50   border-slate-200' },
};

export function findIntent(id: string): DemoIntent | undefined {
	return DEMO_INTENTS.find((i) => i.id === id);
}

export const DEMO_INTENTS: DemoIntent[] = [
	{
		id: 'common-person-week-2',
		persona: 'common person · week 2',
		title: 'Handle my weekly inbox and calendar the way I would',
		progress: 60,
		latest: '12 drafts queued, 2 conflicts resolved',
		chips: [
			'Gmail reader',
			'Calendar reconciler',
			'Voice draft',
			'Urgency check',
			'Deadline tracker',
			'Follow-up scheduler',
		],
		axisMovements: [
			{ axis: 'standard', count: 2, net: 6, latest: 'voice-match floor raised 78% → 84%' },
			{ axis: 'examples', count: 4, latest: 'family-register draft endorsed' },
			{ axis: 'rules',    count: 1, latest: 'never start family replies with "Dear"' },
			{ axis: 'memory',   count: 3, latest: '3 new contacts added to inner circle' },
		],
		summary: 'voice match 78 → 84%, 4 family drafts endorsed, 3 contacts added, the no-"Dear" rule learned from your reject.',
		headline: { label: 'reclaimed', value: '4h 12m' },
		detail: {
			period: 'week 2',
			narrative: [
				{ axis: 'standard', text: 'Voice match raised 78% → 84% — you accepted 4 family drafts in a row.' },
				{ axis: 'rules',    text: 'Learned: never start replies to family with "Dear".' },
				{ axis: 'memory',   text: 'Added 3 contacts to your inner circle (Aunt Mei, Jamie, Priya).' },
				{ axis: 'examples', text: '4 of your edits became future-cycle examples.' },
			],
			stats: [
				{ label: 'Drafts queued',       value: '12' },
				{ label: 'Conflicts resolved',  value: '2 of 2' },
				{ label: 'Hours reclaimed',     value: '4h 12m', delta: '+48m vs last week', deltaTone: 'up' },
				{ label: 'Voice match',         value: '84%',    delta: 'up from 78%',       deltaTone: 'up' },
			],
			body: {
				kind: 'judgment',
				activity: [
					{ when: 'just now',     text: 'Drafted reply to Aunt Mei',                detail: 'pending your review' },
					{ when: '10m ago',      text: 'Resolved 2 calendar conflicts',            detail: 'Mon 2pm · Wed 4pm', tone: 'good' },
					{ when: '1h ago',       text: 'Sent follow-up: Q4 review summary' },
					{ when: '3h ago',       text: 'Skipped meeting prep for ad-hoc 1:1',      detail: 'low-signal flag triggered', tone: 'info' },
					{ when: 'this morning', text: 'Triaged 38 emails',                        detail: '4 archived · 12 drafted · 22 left' },
				],
				appliedPrinciples: [
					{ text: "Write to family in a warm, casual register — never start with 'Dear'.", count: 4 },
					{ text: 'Exclude vendor quotes above $2000/mo unless explicitly approved.',       count: 1 },
				],
			},
		},
	},
	{
		id: 'scientist-cycle-3',
		persona: 'scientist · cycle 3',
		title: 'Find the best NL-to-SQL config under 200ms',
		progress: 35,
		latest: '4 variants benchmarked, Pareto updated',
		chips: [
			'Variant generator',
			'FlowMesh dispatch',
			'Benchmark runner',
			'Pareto analyzer',
			'Optimizer',
		],
		axisMovements: [
			{ axis: 'standard', count: 1, latest: 'latency floor tightened 250ms → 200ms (your reject)' },
			{ axis: 'recipe',   count: 2, latest: 'added "reject-if-over-budget" gate' },
			{ axis: 'pieces',   count: 3, latest: 'tried 3 reranker variants this cycle' },
			{ axis: 'examples', count: 12, latest: '12 benchmark queries scored' },
		],
		summary: 'latency floor tightened 250 → 200ms after your reject, 3 reranker variants tried, lightweight rerank now leads the frontier.',
		headline: { label: 'on frontier', value: '4 / 12' },
		detail: {
			period: 'cycle 3 of 12',
			narrative: [
				{ axis: 'standard', text: 'Latency budget tightened 250 → 200ms after you rejected v2c.' },
				{ axis: 'recipe',   text: 'Added a "reject over-budget" gate so off-frontier variants never reach you.' },
				{ axis: 'pieces',   text: '3 reranker variants tried — heavy rerank dominated, lightweight wins.' },
			],
			stats: [
				{ label: 'Variants tried',         value: '12' },
				{ label: 'Above accuracy floor',   value: '7' },
				{ label: 'Under latency budget',   value: '3' },
				{ label: 'On frontier',            value: '4' },
			],
			body: {
				kind: 'autoresearch',
				direction: 'direction: latency-prior · changed 5h ago by your reject',
				chart: {
					// Coordinates lifted from the LumidOS autoresearch mockup SVG.
					frontier:    [{ cx: 105, cy: 135 }, { cx: 145, cy: 108 }, { cx: 200, cy: 80 }, { cx: 248, cy: 62 }],
					underBudget: [{ cx: 170, cy: 155 }, { cx: 225, cy: 125 }],
					overBudget:  [{ cx: 320, cy: 45 }, { cx: 380, cy: 35 }, { cx: 290, cy: 55 }, { cx: 420, cy: 50 }, { cx: 480, cy: 40 }, { cx: 350, cy: 75 }],
				},
				variants: [
					{ id: 'v3a', config: 'small + dense retrieval + no rerank',           accuracy: 88.4, latency: 142, cost: 0.18, status: 'frontier' },
					{ id: 'v3b', config: 'small + sparse retrieval + lightweight rerank', accuracy: 90.1, latency: 178, cost: 0.21, status: 'frontier' },
					{ id: 'v3c', config: 'medium + dense + lightweight rerank',           accuracy: 91.5, latency: 189, cost: 0.34, status: 'dominated' },
					{ id: 'v3d', config: 'medium + sparse + heavy rerank',                accuracy: 92.3, latency: 244, cost: 0.41, status: 'over' },
				],
			},
		},
	},
];
