// ApprovalCard — "For your approval": what an app suggests trying next, with
// what it will try, what it costs and when it is done, and two answers —
// Go ahead (starts the experiment through the existing experiments route) or
// Not now (hidden for this session). Shared by the app's Research map and the
// Inbox's "Needs you", so a suggestion reads and acts the same in both.
// Kept out of ResearchMap.tsx so the Inbox does not load the map's graph code.

import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import { criteriaInWords, humanId, type Proposal } from "@/lib/research-map";
import { loopLabel } from "@/lib/workflow-names";
import { appTitle } from "@/components/workflow/AppCard";
import { StrandAvatar } from "@/components/illustrations/StrandAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NOT_NOW = (app: string) => `research_not_now_v1:${app}`;
export function readNotNow(app: string): string[] {
	try { return JSON.parse(sessionStorage.getItem(NOT_NOW(app)) || "[]"); } catch { return []; }
}

export function writeNotNow(app: string, ids: string[]): void {
	try { sessionStorage.setItem(NOT_NOW(app), JSON.stringify(ids)); } catch { /* private mode */ }
}

export default function ApprovalCard({ app, list, index, onIndex, onDone, showApp = false }: {
	app: string; list: Proposal[]; index: number; onIndex: (i: number) => void; onDone: (id: string) => void;
	/** Name the app and link to its map — for places outside the app (the Inbox). */
	showApp?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const [full, setFull] = useState(false);
	const p = list[index];
	if (!p) return null;
	const loop = p.dispatch_loop || p.dispatch?.loop;
	const metric = p.metric || (p.metric_name ? { name: p.metric_name } : undefined);
	const done = criteriaInWords(p.success_criteria);
	const missing = !loop ? "which workflow runs it" : !metric ? "what it measures" : "";
	const goAhead = async () => {
		if (!loop || !metric) return;
		setBusy(true);
		try {
			await me.upsertExperiment(app, {
				id: p.id, loop, metric, dataset_id: p.dataset_id, kind: p.kind, hypothesis: p.hypothesis,
				success_criteria: p.success_criteria, min_samples: p.min_samples, arms: p.arms,
			});
			toast.success(`Started “${humanId(p.id)}” — it joins the map when ${loopLabel("", loop)} next runs.`);
			onDone(p.id);
		} catch (e) {
			toast.error(`Couldn't start it: ${e instanceof MeApiError ? e.message : String(e)}`, {
				action: { label: "Ask in chat", onClick: () => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: `Start the suggested experiment ${p.id} for me — it failed from the map.`, context: { app } } })) },
			});
		} finally { setBusy(false); }
	};
	return (
		<section aria-label="For your approval" className="rounded-xl border border-gold-200 bg-card shadow-e2 animate-lumen-rise">
			<div className="flex items-center gap-2 px-3 pt-2.5">
				{showApp ? <StrandAvatar slug={app} size={18} /> : <Sparkles className="w-3.5 h-3.5 text-gold-600" aria-hidden />}
				<span className="eyebrow text-gold-700">{showApp ? `${appTitle(app)} suggests` : "For your approval"}</span>
				{list.length > 1 && (
					<span className="ml-auto inline-flex items-center gap-1 text-micro text-ink-600 tabular-nums">
						<button type="button" aria-label="Previous suggestion" disabled={index === 0} onClick={() => onIndex(index - 1)} className="p-0.5 rounded hover:bg-ink-100 disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
						{index + 1} / {list.length}
						<button type="button" aria-label="Next suggestion" disabled={index >= list.length - 1} onClick={() => onIndex(index + 1)} className="p-0.5 rounded hover:bg-ink-100 disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
					</span>
				)}
			</div>
			<div className="px-3 pb-3 pt-1 space-y-1.5">
				<div className="text-body font-semibold text-ink-900">{humanId(p.id)}</div>
				<dl className="grid gap-1 text-caption">
					{p.hypothesis && (
						<div>
							<dt className="inline font-medium text-ink-700">Try: </dt>
							<dd className={cn("inline text-ink-800", !full && "line-clamp-3")}>{p.hypothesis}</dd>
							{p.hypothesis.length > 220 && (
								<button type="button" onClick={() => setFull((v) => !v)} className="block text-micro text-ink-600 hover:text-ink-900 underline decoration-dotted">{full ? "Less" : "Read all"}</button>
							)}
						</div>
					)}
					<div><dt className="inline font-medium text-ink-700">Cost: </dt><dd className="inline text-ink-800">{p.est_runs ? `about ${p.est_runs} runs` : "not estimated"}{loop ? ` of ${loopLabel("", loop)}` : ""}</dd></div>
					{done && <div><dt className="inline font-medium text-ink-700">Done when: </dt><dd className="inline text-ink-800">{done}</dd></div>}
				</dl>
				{missing && <div className="text-micro text-ember-700">This suggestion doesn&apos;t say {missing} — ask in chat to set it up.</div>}
				<div className="flex items-center gap-2 pt-1">
					<Button size="sm" variant="secondary" onClick={() => onDone(p.id)} disabled={busy}>Not now</Button>
					<Button size="sm" variant="accent" onClick={goAhead} disabled={busy || !!missing}>
						{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Go ahead
					</Button>
					{showApp && (
						<Link to={`/studio/apps/${encodeURIComponent(app)}?suggestion=${encodeURIComponent(p.id)}`}
							className="ml-auto text-micro text-ink-600 hover:text-ink-900 hover:underline">See it on the map</Link>
					)}
				</div>
			</div>
		</section>
	);
}

