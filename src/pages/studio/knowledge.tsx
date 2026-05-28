// Phase S3-D — knowledge browser.
//
// Lists the caller's knowledge agents (per-agent banks) and lets
// them drill into one agent's memories. Filter by kind, paginated.
// Reads /me/knowledge/agents + /me/knowledge/agents/:id/memories.
// Empty for users who haven't installed an app yet; clear empty
// state directs them to the composer.

import { useEffect, useState } from 'react';
import { Brain, ChevronRight, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import apiClient from '@/api/client';
import PageHints from '@/components/PageHints';
import { setStudioSelection } from '@/components/StudioContext';

type Agent = {
	id: string;
	memory_count: number;
	last_memory_ts?: string;
	bank_path: string;
};

type Memory = {
	id?: string;
	kind?: string;
	source?: string;
	content?: string;
	confidence?: number;
	created_at?: string;
	recurrence?: number;
};

const KIND_COLORS: Record<string, string> = {
	principle:    'bg-emerald-50 text-emerald-700 border-emerald-200',
	pattern:      'bg-indigo-50 text-indigo-700 border-indigo-200',
	fact:         'bg-slate-50 text-slate-700 border-slate-200',
	correction:   'bg-amber-50 text-amber-700 border-amber-200',
	anti_pattern: 'bg-rose-50 text-rose-700 border-rose-200',
	draft:        'bg-blue-50 text-blue-700 border-blue-200',
};

function AgentList() {
	const [agents, setAgents] = useState<Agent[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		apiClient.get('/api/v1/me/knowledge/agents')
			.then((r: any) => setAgents(r.data.data.agents))
			.catch((e: any) => setError(e?.message || 'Failed to load agents'));
	}, []);

	if (error) return <div className="text-rose-700 text-sm">{error}</div>;
	if (agents === null) return <div className="text-sm text-slate-500 italic">Loading…</div>;

	if (agents.length === 0) {
		return (
			<div className="max-w-md mx-auto pt-12 text-center space-y-4">
				<div className="inline-flex w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 items-center justify-center">
					<Brain className="w-7 h-7" />
				</div>
				<div>
					<h2 className="text-xl font-medium">Your AI hasn&apos;t learned anything yet</h2>
					<p className="mt-2 text-sm text-slate-600 leading-relaxed">
						Knowledge accumulates as your AI runs. Once you&apos;ve installed an app
						and it&apos;s done a few cycles, principles and patterns will show up here.
					</p>
				</div>
				<Link
					to="/studio/skills"
					className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
				>
					<Sparkles className="w-4 h-4" /> Set up your AI
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Page identity in StudioShell top-bar (or absent when this
			    component is embedded in Marketplace's Knowledge tab —
			    that surface owns its own header). */}
			<PageHints prompts={[
				'what did you learn about me this week?',
				'what do you know about my work style?',
				'forget that I mentioned the Acme project',
			]} />
			<ul className="space-y-2">
				{agents.map((a) => (
					<li key={a.id}>
						<Link
							to={`/studio/knowledge/${encodeURIComponent(a.id)}`}
							className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-3 hover:bg-slate-50 transition-colors"
						>
							<div className="min-w-0">
								<div className="font-mono text-sm truncate">{a.id}</div>
								<div className="text-xs text-slate-500 mt-0.5">
									{a.memory_count.toLocaleString()} memor{a.memory_count === 1 ? 'y' : 'ies'}
									{a.last_memory_ts && (
										<> · last {new Date(a.last_memory_ts).toLocaleDateString()}</>
									)}
								</div>
							</div>
							<ChevronRight className="w-4 h-4 text-slate-400" />
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

function AgentDetail({ agentId }: { agentId: string }) {
	const [memories, setMemories] = useState<Memory[] | null>(null);
	const [kindFilter, setKindFilter] = useState<string>('');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const q = kindFilter ? `?kind=${encodeURIComponent(kindFilter)}` : '';
		apiClient.get(`/api/v1/me/knowledge/agents/${encodeURIComponent(agentId)}/memories${q}`)
			.then((r: any) => setMemories(r.data.data.memories))
			.catch((e: any) => setError(e?.message || 'Failed to load memories'));
	}, [agentId, kindFilter]);

	// Phase S6b — announce this agent as the active selection so chat
	// asks like "what do you know about me" use this agent's bank.
	useEffect(() => {
		setStudioSelection({
			kind: 'agent',
			id: agentId,
			label: agentId,
			affordances: ['query_my_knowledge', 'subscribe_to_bank'],
		});
		return () => setStudioSelection(null);
	}, [agentId]);

	if (error) return <div className="text-rose-700 text-sm">{error}</div>;
	if (memories === null) return <div className="text-sm text-slate-500 italic">Loading memories…</div>;

	const kinds = Array.from(new Set(memories.map((m) => m.kind).filter(Boolean))) as string[];

	return (
		<div className="space-y-4">
			<Link to="/studio/knowledge" className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 gap-1">
				← Knowledge
			</Link>
			<header>
				<h1 className="font-mono text-lg font-medium">{agentId}</h1>
				<p className="text-sm text-slate-500 mt-1">{memories.length} memory record(s)</p>
			</header>

			{kinds.length > 1 && (
				<div className="flex items-center gap-2 flex-wrap">
					<button
						onClick={() => setKindFilter('')}
						className={[
							'px-3 py-1 rounded-full text-xs transition-colors',
							!kindFilter ? 'bg-gray-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50',
						].join(' ')}
					>All</button>
					{kinds.map((k) => (
						<button
							key={k}
							onClick={() => setKindFilter(k!)}
							className={[
								'px-3 py-1 rounded-full text-xs transition-colors',
								kindFilter === k ? 'bg-gray-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50',
							].join(' ')}
						>{k}</button>
					))}
				</div>
			)}

			<ul className="space-y-2">
				{memories.map((m, i) => (
					<li
						key={m.id || `${m.created_at}-${i}`}
						className="rounded-lg border border-slate-200 bg-white p-3"
					>
						<div className="flex items-start gap-3">
							{m.kind && (
								<span className={['px-2 py-0.5 rounded-full text-[10px] tracking-wide border flex-shrink-0', KIND_COLORS[m.kind] || 'bg-slate-50 text-slate-600 border-slate-200'].join(' ')}>
									{m.kind}
								</span>
							)}
							<div className="min-w-0 flex-1">
								<div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
									{m.content || '(no content)'}
								</div>
								<div className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-2 flex-wrap">
									{m.created_at && <span>{new Date(m.created_at).toLocaleString()}</span>}
									{m.source && <span>· {m.source}</span>}
									{m.confidence != null && <span>· confidence {m.confidence.toFixed(2)}</span>}
									{(m.recurrence ?? 0) > 1 && <span>· seen ×{m.recurrence}</span>}
								</div>
							</div>
						</div>
					</li>
				))}
				{memories.length === 0 && (
					<li className="text-sm text-slate-500 italic">No memories matching this filter.</li>
				)}
			</ul>
		</div>
	);
}

export default function StudioKnowledge() {
	const { agent } = useParams<{ agent?: string }>();
	return agent ? <AgentDetail agentId={agent} /> : <AgentList />;
}
