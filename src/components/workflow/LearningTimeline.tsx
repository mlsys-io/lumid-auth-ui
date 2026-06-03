// LearningTimeline — what the app has actually learned over time.
//
// An app's knowledge lives in its memory agents' banks (e.g. auto-sysresearch
// → sr-optimizer / sr-analyst). This pulls each agent's recent memories, merges
// them newest-first, and shows the compounding ledger: principle/pattern/
// correction/fact entries with their source agent + when. The "Compound" beat
// of the Assemble→Adapt→Compound story, made concrete per app.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, ArrowRight } from "lucide-react";
import apiClient from "@/api/client";

type Memory = { id?: string; kind?: string; content?: string; created_at?: string; agent?: string };

const KIND_CLS: Record<string, string> = {
	principle: "bg-emerald-50 text-emerald-700 border-emerald-200",
	recipe: "bg-emerald-50 text-emerald-700 border-emerald-200",
	pattern: "bg-indigo-50 text-indigo-700 border-indigo-200",
	fact: "bg-slate-50 text-slate-600 border-slate-200",
	correction: "bg-amber-50 text-amber-700 border-amber-200",
	anti_pattern: "bg-rose-50 text-rose-700 border-rose-200",
};

function rel(ts?: string): string {
	if (!ts) return "";
	const d = new Date(ts).getTime();
	if (Number.isNaN(d)) return "";
	const s = (Date.now() - d) / 1000;
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

export default function LearningTimeline({ agents }: { agents: string[] }) {
	const [data, setData] = useState<{ total: number; kinds: [string, number][]; recent: Memory[] } | null>(null);

	useEffect(() => {
		let live = true;
		if (!agents.length) { setData({ total: 0, kinds: [], recent: [] }); return; }
		Promise.all(
			agents.map((id) =>
				apiClient
					.get(`/api/v1/me/knowledge/agents/${encodeURIComponent(id)}/memories?limit=40`)
					.then((r) => ((r.data?.data?.memories ?? []) as Memory[]).map((m) => ({ ...m, agent: id })))
					.catch(() => [] as Memory[]),
			),
		).then((lists) => {
			if (!live) return;
			const all = lists.flat();
			all.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
			const counts: Record<string, number> = {};
			for (const m of all) counts[(m.kind || "memory").toLowerCase()] = (counts[(m.kind || "memory").toLowerCase()] || 0) + 1;
			const kinds = Object.entries(counts).sort((a, b) => b[1] - a[1]);
			setData({ total: all.length, kinds, recent: all.slice(0, 3) });
		});
		return () => { live = false; };
	}, [agents.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

	if (data === null) return <div className="h-12 rounded-lg bg-slate-100 animate-pulse" />;
	if (!agents.length) return <div className="text-xs text-slate-400 italic">No knowledge agents configured for this app.</div>;
	if (data.total === 0) return <div className="text-xs text-slate-400 italic">Nothing banked yet — learnings appear as the loops run and reflect.</div>;

	return (
		<div className="space-y-2">
			{/* Succinct: total + a breakdown by kind, not a wall of entries. */}
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span className="text-[13px] font-semibold text-slate-800 tabular-nums">{data.total}</span>
				<span className="text-[11px] text-slate-400">learnings ·</span>
				{data.kinds.map(([k, n]) => (
					<span key={k} className={`text-[10px] rounded-full px-1.5 py-px border ${KIND_CLS[k] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
						{k.replace(/_/g, " ")} <span className="tabular-nums font-semibold">{n}</span>
					</span>
				))}
			</div>
			{/* The few freshest, one line each. */}
			<ul className="space-y-1">
				{data.recent.map((m, i) => (
					<li key={m.id || i} className="flex items-start gap-1.5 text-[11px]">
						<span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${(m.kind || "").match(/correction|anti/) ? "bg-amber-400" : "bg-emerald-400"}`} />
						<span className="text-slate-600 truncate" title={m.content}>{m.content}</span>
						<span className="text-[10px] text-slate-300 ml-auto flex-shrink-0">{rel(m.created_at)}</span>
					</li>
				))}
			</ul>
			<Link to="/studio/knowledge" className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-700 transition-colors">
				<Brain className="w-3 h-3" /> Explore all <ArrowRight className="w-3 h-3" />
			</Link>
		</div>
	);
}
