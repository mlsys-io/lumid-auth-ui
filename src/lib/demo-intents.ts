// Demo intent registry — one source of truth for the rail + the detail
// panel + the URL. Each intent declares its rail data (persona, title,
// chips, latest outcome) and an optional detail body. The detail page
// looks the intent up by id, then dispatches to a body component by
// `body.kind`. Adding a new intent kind = add a discriminated-union
// variant + a body renderer; the shell stays untouched.

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

export interface IntentDetail {
	period?: string;       // small top-right meta, e.g. "cycle 3 of 12", "week 2"
	stats: IntentStat[];
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
	detail?: IntentDetail; // when set, the rail card becomes clickable
}

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
		detail: {
			period: 'week 2',
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
		detail: {
			period: 'cycle 3 of 12',
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
