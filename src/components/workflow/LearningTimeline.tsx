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
	const [items, setItems] = useState<Memory[] | null>(null);
	const [total, setTotal] = useState(0);

	useEffect(() => {
		let live = true;
		if (!agents.length) { setItems([]); return; }
		Promise.all(
			agents.map((id) =>
				apiClient
					.get(`/api/v1/me/knowledge/agents/${encodeURIComponent(id)}/memories?limit=25`)
					.then((r) => ((r.data?.data?.memories ?? []) as Memory[]).map((m) => ({ ...m, agent: id })))
					.catch(() => [] as Memory[]),
			),
		).then((lists) => {
			if (!live) return;
			const all = lists.flat();
			setTotal(all.length);
			all.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
			setItems(all.slice(0, 12));
		});
		return () => { live = false; };
	}, [agents.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

	if (items === null) return <div className="h-16 rounded-lg bg-slate-100 animate-pulse" />;
	if (!agents.length) return <div className="text-xs text-slate-400 italic">This app has no knowledge agents configured.</div>;
	if (items.length === 0) return <div className="text-xs text-slate-400 italic">Nothing banked yet — learnings appear here as the loops run and reflect.</div>;

	return (
		<div className="space-y-2.5">
			<div className="text-[11px] text-slate-400">
				{total}+ learnings across {agents.length} agent{agents.length === 1 ? "" : "s"} ({agents.join(", ")})
			</div>
			<ol className="relative border-l border-slate-200 ml-1.5 space-y-2.5">
				{items.map((m, i) => (
					<li key={m.id || i} className="ml-3.5 relative">
						<span className="absolute -left-[1.18rem] top-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white" />
						<div className="flex items-center gap-1.5 flex-wrap">
							{m.kind && (
								<span className={`text-[9px] uppercase tracking-wide rounded-full px-1.5 py-px border ${KIND_CLS[m.kind.toLowerCase()] || "bg-slate-50 text-slate-600 border-slate-200"}`}>{m.kind}</span>
							)}
							<span className="text-[10px] text-slate-400">{m.agent}</span>
							<span className="text-[10px] text-slate-300 ml-auto">{rel(m.created_at)}</span>
						</div>
						<div className="text-[12px] text-slate-700 leading-snug mt-0.5">{m.content}</div>
					</li>
				))}
			</ol>
			<Link to="/studio/knowledge" className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-700 transition-colors">
				<Brain className="w-3 h-3" /> Explore the full knowledge graph <ArrowRight className="w-3 h-3" />
			</Link>
		</div>
	);
}
