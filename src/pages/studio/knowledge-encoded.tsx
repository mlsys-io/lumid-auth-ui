// /studio/knowledge — the real "compounding" ledger: what the apps have
// actually learned, aggregated across every knowledge agent's bank. Each
// row is a real memory (principle / correction / pattern / fact / cc_*)
// with its source agent + recurrence. Drill into one bank at
// /studio/knowledge/:agent (StudioKnowledge). Real data only.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, ArrowRight } from 'lucide-react';
import apiClient from '@/api/client';

type Agent = { id: string; memory_count: number; last_memory_ts?: string; bank_path?: string };
type Memory = {
	id?: string;
	kind?: string;
	source?: string;
	content?: string;
	confidence?: number;
	created_at?: string;
	recurrence?: number;
	agent?: string;
};

const KIND_COLORS: Record<string, string> = {
	principle:     'bg-emerald-50 text-emerald-700 border-emerald-200',
	recipe:        'bg-emerald-50 text-emerald-700 border-emerald-200',
	pattern:       'bg-indigo-50 text-indigo-700 border-indigo-200',
	fact:          'bg-slate-50 text-slate-700 border-slate-200',
	correction:    'bg-amber-50 text-amber-700 border-amber-200',
	anti_pattern:  'bg-rose-50 text-rose-700 border-rose-200',
	cc_correction: 'bg-amber-50 text-amber-700 border-amber-200',
	cc_decision:   'bg-sky-50 text-sky-700 border-sky-200',
	cc_override:   'bg-violet-50 text-violet-700 border-violet-200',
};

function rel(ts?: string): string {
	if (!ts) return '';
	const d = new Date(ts).getTime();
	if (Number.isNaN(d)) return '';
	const s = (Date.now() - d) / 1000;
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

function badgeCls(kind?: string): string {
	const c = KIND_COLORS[(kind || '').toLowerCase()] || 'bg-slate-50 text-slate-600 border-slate-200';
	return `text-[10px] uppercase tracking-wide rounded-full px-1.5 py-px border ${c}`;
}

export default function StudioKnowledgeEncoded() {
	const [agents, setAgents] = useState<Agent[] | null>(null);
	const [recent, setRecent] = useState<Memory[]>([]);
	const [corpus, setCorpus] = useState<Memory[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		apiClient.get('/api/v1/me/knowledge/agents')
			.then(async (r: any) => {
				const ags: Agent[] = (r.data.data.agents || []).filter((a: Agent) => (a.memory_count || 0) > 0);
				setAgents(ags);
				// Aggregate a larger sample across the most-active banks for
				// the distribution + word cloud; recent[] drives the list.
				const top = [...ags]
					.sort((a, b) => (b.last_memory_ts || '').localeCompare(a.last_memory_ts || ''))
					.slice(0, 12);
				const all: Memory[] = [];
				await Promise.all(top.map(async (a) => {
					try {
						const m = await apiClient.get(
							`/api/v1/me/knowledge/agents/${encodeURIComponent(a.id)}/memories?limit=40`,
						);
						(m.data.data.memories || []).forEach((x: Memory) => all.push({ ...x, agent: a.id }));
					} catch { /* skip a bank that fails to read */ }
				}));
				all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
				setCorpus(all);
				setRecent(all.slice(0, 12));
			})
			.catch((e: any) => setError(e?.message || 'Failed to load knowledge'));
	}, []);

	// Distribution by kind + a simple frequency word cloud over the sample.
	const kindDist = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const m of corpus) {
			const k = (m.kind || 'memory').toLowerCase();
			counts[k] = (counts[k] || 0) + 1;
		}
		return Object.entries(counts).sort((a, b) => b[1] - a[1]);
	}, [corpus]);

	const words = useMemo(() => {
		const stop = new Set('the a an and or of to in on for with is are be as at by from this that it its into your you our we their they them then than over under more most less when what which who how why use using used can will would should could may might must not no yes per via about across after before each every both either neither only just also very much many few some any all one two three new old set get got make made take taken give given run runs ran loop loops cycle cycles step steps data based using value values info item items name names day days entry entries true false null none list lists count counts test tests this that with from into when then them'.split(/\s+/));
		const freq: Record<string, number> = {};
		for (const m of corpus) {
			const text = (m.content || '').toLowerCase();
			for (const w of text.split(/[^a-z]+/)) {
				if (w.length < 4 || stop.has(w)) continue;
				freq[w] = (freq[w] || 0) + 1;
			}
		}
		return Object.entries(freq).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 30);
	}, [corpus]);

	if (error) return <div className="max-w-4xl mx-auto px-1 py-2 text-sm text-rose-600">{error}</div>;
	if (agents === null) return <div className="max-w-4xl mx-auto px-1 py-2 text-sm text-slate-500 italic">Loading…</div>;

	const totalMemories = agents.reduce((n, a) => n + (a.memory_count || 0), 0);
	const distilled = recent.filter((m) => ['principle', 'recipe', 'pattern'].includes((m.kind || '').toLowerCase())).length;

	return (
		<div className="max-w-4xl mx-auto px-1 py-2 space-y-6">
			{/* Metrics — real */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
				<Tile label="Memories" value={String(totalMemories)} ctx={`across ${agents.length} agents`} />
				<Tile label="Knowledge agents" value={String(agents.length)} ctx="with accumulated memory" neutral />
				<Tile label="Distilled (recent)" value={String(distilled)} ctx="principles + patterns" />
			</div>

			{/* Distribution by kind + a themes word cloud (over a sample) */}
			{corpus.length > 0 && (
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<section className="rounded-lg border border-slate-200/70 bg-white px-4 py-3">
						<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">By kind</div>
						<div className="space-y-1.5">
							{kindDist.map(([k, n]) => {
								const pct = Math.round((n / corpus.length) * 100);
								return (
									<div key={k} className="flex items-center gap-2">
										<span className={badgeCls(k)}>{k}</span>
										<div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
											<div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
										</div>
										<span className="text-[10px] text-slate-400 tabular-nums w-6 text-right">{n}</span>
									</div>
								);
							})}
						</div>
					</section>
					<section className="rounded-lg border border-slate-200/70 bg-white px-4 py-3">
						<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Themes</div>
						<div className="flex flex-wrap gap-x-2.5 gap-y-1 items-baseline">
							{words.length === 0 ? (
								<span className="text-xs text-slate-400 italic">building as memories accrue…</span>
							) : words.map(([w, n]) => {
								const max = words[0][1];
								const size = 11 + Math.round((n / max) * 12);
								const op = 0.5 + (n / max) * 0.5;
								return <span key={w} style={{ fontSize: `${size}px`, opacity: op }} className="text-emerald-800 leading-none font-medium">{w}</span>;
							})}
						</div>
					</section>
				</div>
			)}

			{/* Recently learned — real */}
			<section>
				<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Recently learned — captured from real cycles</div>
				{recent.length === 0 ? (
					<div className="text-sm text-slate-500 italic">
						Nothing learned yet — memories land here as your loops run.
					</div>
				) : (
					<ul className="space-y-2">
						{recent.map((m, i) => (
							<li key={m.id || i} className="rounded-lg border border-slate-200/70 bg-white px-4 py-3">
								<div className="flex items-center gap-2">
									<span className={badgeCls(m.kind)}>{m.kind || 'memory'}</span>
									{(m.recurrence || 0) > 1 && (
										<span className="text-[10px] text-slate-500">seen ×{m.recurrence}</span>
									)}
									<span className="text-[10px] text-slate-400 ml-auto">{rel(m.created_at)}</span>
								</div>
								<div className="text-sm text-slate-800 mt-1 leading-snug">{m.content}</div>
								<Link
									to={`/studio/knowledge/${encodeURIComponent(m.agent || '')}`}
									className="text-[11px] text-slate-400 hover:text-slate-700 mt-1 inline-flex items-center gap-1"
								>
									{m.agent} <ArrowRight className="w-3 h-3" />
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* Browse the agents */}
			<section>
				<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Knowledge agents</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
					{[...agents].sort((a, b) => (b.memory_count || 0) - (a.memory_count || 0)).map((a) => (
						<Link
							key={a.id}
							to={`/studio/knowledge/${encodeURIComponent(a.id)}`}
							className="rounded-lg border border-slate-200/70 bg-white px-3 py-2 flex items-center gap-2 hover:border-slate-300 transition-colors"
						>
							<Brain className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
							<span className="text-sm text-slate-800 truncate flex-1">{a.id}</span>
							<span className="text-[11px] text-slate-400">{a.memory_count}</span>
						</Link>
					))}
				</div>
			</section>
		</div>
	);
}

function Tile({ label, value, ctx, neutral }: { label: string; value: string; ctx: string; neutral?: boolean }) {
	return (
		<div className="rounded-lg border border-slate-200/70 bg-[#f7f7f5] px-4 py-3">
			<div className="text-[12px] text-slate-500">{label}</div>
			<div className="mt-1 text-[22px] font-medium text-slate-900 leading-none tracking-tight">{value}</div>
			<div className={`mt-1.5 text-[11px] ${neutral ? 'text-slate-500' : 'text-emerald-700'}`}>{ctx}</div>
		</div>
	);
}
