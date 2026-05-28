// /studio/intents/:intentId — the generic intent-detail panel.
//
// One shell (header + period · stats grid · body · back-link), one
// dispatcher: body component is picked by `intent.detail.body.kind`.
// Adding a new intent kind = declare its data in lib/demo-intents and
// add a renderer in BODY_RENDERERS — no shell changes.
//
// Today: 'autoresearch' (scientist, Pareto + variants) and 'judgment'
// (common person, activity timeline + voice principles applied).

import { useParams, Link } from 'react-router-dom';
import { ChevronRight, CheckCircle2, Info, Quote } from 'lucide-react';
import {
	findIntent, type AutoresearchBody, type JudgmentBody, type IntentBody,
	type IntentStat,
} from '@/lib/demo-intents';

export default function StudioIntentDetail() {
	const { intentId = '' } = useParams<{ intentId: string }>();
	const intent = findIntent(intentId);

	if (!intent || !intent.detail) {
		return (
			<div className="max-w-3xl mx-auto py-12 text-center">
				<div className="text-sm text-slate-500 mb-3">No detail panel for this intent.</div>
				<Link to="/studio/intents" className="text-sm text-emerald-700 hover:underline">← Back to Intents</Link>
			</div>
		);
	}

	return (
		<div className="max-w-4xl mx-auto px-1 py-2 space-y-5">
			<header className="flex items-end justify-between gap-3">
				<div>
					<div className="text-[11px] text-slate-400 mb-1">{intent.persona}</div>
					<h1 className="text-lg font-medium text-slate-900 leading-tight">{intent.title}</h1>
				</div>
				{intent.detail.period && (
					<div className="text-[11px] text-slate-400 flex-shrink-0">{intent.detail.period}</div>
				)}
			</header>

			<StatsRow stats={intent.detail.stats} />

			<IntentBodyView body={intent.detail.body} />

			<div>
				<Link to="/studio/intents" className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800">
					<ChevronRight className="w-3 h-3 rotate-180" /> Back to Intents
				</Link>
			</div>
		</div>
	);
}

// ── Shared shell pieces ────────────────────────────────────────────

function StatsRow({ stats }: { stats: IntentStat[] }) {
	const cols = stats.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3';
	return (
		<div className={`grid grid-cols-2 ${cols} gap-2.5`}>
			{stats.map((s) => (
				<div key={s.label} className="rounded-lg border border-slate-200/70 bg-[#f7f7f5] px-3.5 py-2.5">
					<div className="text-[10px] text-slate-500">{s.label}</div>
					<div className="mt-0.5 text-[18px] font-medium text-slate-900 leading-none">{s.value}</div>
					{s.delta && (
						<div className={`mt-1 text-[10px] ${s.deltaTone === 'neutral' ? 'text-slate-500' : 'text-emerald-700'}`}>
							{s.delta}
						</div>
					)}
				</div>
			))}
		</div>
	);
}

// ── Body dispatcher ────────────────────────────────────────────────

function IntentBodyView({ body }: { body: IntentBody }) {
	// Each kind gets a typed body renderer. Adding a new kind = add a
	// new variant to IntentBody (lib/demo-intents) + a branch here.
	switch (body.kind) {
		case 'autoresearch': return <AutoresearchBodyView body={body} />;
		case 'judgment':     return <JudgmentBodyView body={body} />;
	}
}

// ── Body: autoresearch ─────────────────────────────────────────────

function AutoresearchBodyView({ body }: { body: AutoresearchBody }) {
	return (
		<>
			<section className="rounded-xl border border-slate-200/70 bg-white px-4 py-3.5">
				<div className="flex items-center justify-between gap-3 mb-2">
					<div className="text-[11px] tracking-[0.06em] text-slate-400">Accuracy vs latency · Pareto frontier</div>
					<div className="flex items-center gap-1.5 text-[11px] text-slate-500">
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
						<span>{body.direction}</span>
					</div>
				</div>
				<ParetoChart chart={body.chart} />
			</section>

			<section>
				<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">This cycle's variants</div>
				<div className="rounded-lg border border-slate-200/70 overflow-hidden">
					<table className="w-full text-[12px]">
						<thead className="bg-[#f7f7f5]">
							<tr className="text-left text-slate-400 text-[11px]">
								<th className="px-3.5 py-2 font-normal">Variant</th>
								<th className="px-3.5 py-2 font-normal">Config</th>
								<th className="px-3.5 py-2 font-normal text-right">Accuracy</th>
								<th className="px-3.5 py-2 font-normal text-right">Latency</th>
								<th className="px-3.5 py-2 font-normal text-right">Cost/1k</th>
								<th className="px-3.5 py-2 font-normal text-right">Status</th>
							</tr>
						</thead>
						<tbody>
							{body.variants.map((v, i) => (
								<tr key={v.id} className={i < body.variants.length - 1 ? 'border-b border-slate-200/70' : ''}>
									<td className="px-3.5 py-2 font-mono text-slate-900">{v.id}</td>
									<td className="px-3.5 py-2 text-slate-500">{v.config}</td>
									<td className="px-3.5 py-2 text-right text-slate-900">{v.accuracy.toFixed(1)}%</td>
									<td className={`px-3.5 py-2 text-right ${v.status === 'over' ? 'text-amber-700' : v.status === 'frontier' ? 'text-emerald-700' : 'text-slate-900'}`}>{v.latency}ms</td>
									<td className="px-3.5 py-2 text-right text-slate-900">${v.cost.toFixed(2)}</td>
									<td className={`px-3.5 py-2 text-right text-[11px] ${
										v.status === 'frontier' ? 'text-emerald-700' :
										v.status === 'over'     ? 'text-amber-700'   :
										                          'text-slate-500'
									}`}>
										{v.status === 'frontier' ? 'on frontier' : v.status === 'over' ? 'over budget' : 'dominated'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</>
	);
}

function ParetoChart({ chart }: { chart: AutoresearchBody['chart'] }) {
	const frontierPath = chart.frontier.map((p) => `${p.cx},${p.cy}`).join(' ');
	return (
		<svg viewBox="0 0 600 240" width="100%" className="block">
			<g stroke="#e7e5e0" strokeWidth="0.5">
				<line x1="50" y1="20"  x2="580" y2="20"  />
				<line x1="50" y1="65"  x2="580" y2="65"  />
				<line x1="50" y1="110" x2="580" y2="110" />
				<line x1="50" y1="155" x2="580" y2="155" />
				<line x1="50" y1="200" x2="580" y2="200" />
			</g>
			<line x1="50" y1="20"  x2="50"  y2="200" stroke="#a1a1aa" strokeWidth="0.5" />
			<line x1="50" y1="200" x2="580" y2="200" stroke="#a1a1aa" strokeWidth="0.5" />
			<g fontSize="9" fill="#71717a">
				<text x="44" y="23"  textAnchor="end">94%</text>
				<text x="44" y="68"  textAnchor="end">90%</text>
				<text x="44" y="113" textAnchor="end">86%</text>
				<text x="44" y="158" textAnchor="end">82%</text>
				<text x="44" y="203" textAnchor="end">78%</text>
			</g>
			<g fontSize="9" fill="#71717a">
				<text x="50"  y="215" textAnchor="middle">0</text>
				<text x="156" y="215" textAnchor="middle">100ms</text>
				<text x="262" y="215" textAnchor="middle">200ms</text>
				<text x="368" y="215" textAnchor="middle">300ms</text>
				<text x="474" y="215" textAnchor="middle">400ms</text>
				<text x="568" y="215" textAnchor="middle">500ms</text>
			</g>
			<line x1="262" y1="20" x2="262" y2="200" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" />
			<text x="266" y="30" fontSize="9" fill="#10b981">200ms budget</text>
			<polyline points={frontierPath} fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0.6" />
			{chart.frontier.map((p, i) => (
				<circle key={`f${i}`} cx={p.cx} cy={p.cy} r="5" fill="#10b981" opacity="0.85" />
			))}
			{chart.underBudget.map((p, i) => (
				<circle key={`u${i}`} cx={p.cx} cy={p.cy} r="4" fill="#a1a1aa" opacity="0.6" />
			))}
			{chart.overBudget.map((p, i) => (
				<circle key={`o${i}`} cx={p.cx} cy={p.cy} r="4" fill="#a1a1aa" opacity="0.5" />
			))}
			<text x="320" y="232" fontSize="10" fill="#71717a" textAnchor="middle">Latency (p95)</text>
			<text x="15"  y="115" fontSize="10" fill="#71717a" textAnchor="middle" transform="rotate(-90 15 115)">Accuracy</text>
		</svg>
	);
}

// ── Body: judgment ─────────────────────────────────────────────────

function JudgmentBodyView({ body }: { body: JudgmentBody }) {
	return (
		<>
			<section>
				<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Recent activity</div>
				<ol className="space-y-1.5">
					{body.activity.map((a, i) => {
						const Icon = a.tone === 'good' ? CheckCircle2 : Info;
						const tone =
							a.tone === 'good' ? 'text-emerald-600' :
							a.tone === 'warn' ? 'text-amber-600'   :
							                    'text-slate-400';
						return (
							<li key={i} className="rounded-lg border border-slate-200/70 bg-white px-4 py-2.5 flex items-start gap-3">
								<Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${tone}`} />
								<div className="flex-1 min-w-0">
									<div className="text-sm text-slate-900">{a.text}</div>
									{a.detail && <div className="text-[11px] text-slate-400 mt-0.5">{a.detail}</div>}
								</div>
								<span className="text-[11px] text-slate-400 flex-shrink-0">{a.when}</span>
							</li>
						);
					})}
				</ol>
			</section>

			{body.appliedPrinciples && body.appliedPrinciples.length > 0 && (
				<section>
					<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Voice principles applied today</div>
					<ul className="space-y-1.5">
						{body.appliedPrinciples.map((p) => (
							<li key={p.text} className="rounded-lg border border-slate-200/70 bg-white px-4 py-2.5 flex items-start gap-3">
								<Quote className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
								<div className="flex-1 min-w-0 text-sm text-slate-800 leading-snug">{p.text}</div>
								<span className="text-[11px] text-emerald-700 flex-shrink-0">applied {p.count}×</span>
							</li>
						))}
					</ul>
				</section>
			)}
		</>
	);
}
