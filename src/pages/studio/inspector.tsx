// Phase S3-B — cycle inspector page.
//
// Surfaces a single cycle's step-by-step drill-down: each step's
// input/output, the prompt audit (sha + preview), and the cycle's
// headline summary. Linked from any cycle row on Today.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import apiClient from '@/api/client';

type Step = {
	step_id: string;
	skill?: string;
	stage?: string;
	ok: boolean;
	output_summary?: string;
	output?: Record<string, unknown>;
	error?: string;
	duration_s?: number;
	prompt_sha?: string;
	prompt_preview?: string;
};

export default function CycleInspector() {
	const { app, loop, ts } = useParams<{ app: string; loop: string; ts: string }>();
	const [data, setData] = useState<{ summary: Record<string, unknown>; steps: Step[] } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	useEffect(() => {
		if (!app || !loop || !ts) return;
		apiClient.get(`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}`)
			.then((r: { data: { data: any } }) => setData(r.data.data))
			.catch((e) => setError(e?.message || 'Failed to load cycle'));
	}, [app, loop, ts]);

	if (error) return <div className="text-rose-700 text-sm">{error}</div>;
	if (!data) return <div className="text-sm text-slate-500 italic">Loading cycle…</div>;

	return (
		<div className="space-y-4">
			<Link to="/studio/intents" className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 gap-1">
				<ChevronLeft className="w-4 h-4" /> Today
			</Link>

			<header>
				<h1 className="text-lg font-medium">{loop}</h1>
				<div className="text-xs text-slate-500 mt-0.5 font-mono">
					{app} · {ts}
				</div>
			</header>

			{/* Summary */}
			<div className="rounded-lg border border-slate-200 bg-white p-4">
				<h2 className="text-xs font-medium tracking-wide text-slate-500 mb-2">Summary</h2>
				<pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">
					{JSON.stringify(data.summary, null, 2)}
				</pre>
			</div>

			{/* Steps */}
			<div>
				<h2 className="text-xs font-medium tracking-wide text-slate-500 mb-2">
					Steps ({data.steps.length})
				</h2>
				<ul className="space-y-2">
					{data.steps.map((s) => {
						const open = expanded[s.step_id];
						const Icon = s.ok ? CheckCircle2 : AlertCircle;
						const Chev = open ? ChevronDown : ChevronRight;
						return (
							<li key={s.step_id} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
								<button
									onClick={() => setExpanded((m) => ({ ...m, [s.step_id]: !m[s.step_id] }))}
									className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50"
								>
									<Chev className="w-4 h-4 text-slate-400 flex-shrink-0" />
									<Icon className={s.ok ? 'w-4 h-4 text-emerald-600 flex-shrink-0' : 'w-4 h-4 text-rose-600 flex-shrink-0'} />
									<span className="font-mono text-sm font-medium">{s.step_id}</span>
									{s.skill && <span className="text-xs text-slate-500">{s.skill}</span>}
									{s.stage && <span className="text-[10px] tracking-wide text-slate-400 ml-1">{s.stage}</span>}
									<span className="flex-1" />
									{s.duration_s != null && (
										<span className="text-xs text-slate-500 tabular-nums">{s.duration_s.toFixed(2)}s</span>
									)}
								</button>

								{!open && s.output_summary && (
									<div className="px-3 pb-2 pl-12 text-xs text-slate-600 truncate">{s.output_summary}</div>
								)}

								{open && (
									<div className="px-3 pb-3 pl-12 space-y-3">
										{s.error && (
											<div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 whitespace-pre-wrap font-mono">
												{s.error}
											</div>
										)}
										{s.prompt_preview && (
											<div>
												<div className="text-[10px] tracking-wide text-slate-400 mb-1">
													Prompt preview {s.prompt_sha && <span className="font-mono">· {s.prompt_sha.slice(0, 12)}</span>}
												</div>
												<pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 rounded p-2 border border-slate-200">
													{s.prompt_preview}
												</pre>
											</div>
										)}
										<div>
											<div className="text-[10px] tracking-wide text-slate-400 mb-1">Output</div>
											<pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 rounded p-2 border border-slate-200 max-h-96 overflow-auto">
												{JSON.stringify(s.output, null, 2)}
											</pre>
										</div>
									</div>
								)}
							</li>
						);
					})}
				</ul>
				{data.steps.length === 0 && (
					<div className="text-sm text-slate-500 italic">No step artifacts for this cycle.</div>
				)}
			</div>
		</div>
	);
}
