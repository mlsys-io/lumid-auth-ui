// ApprovalCard — "For your approval": what an app suggests trying next, with
// what it will try, what it costs and when it is done, and two answers —
// Go ahead (adds the experiment through the existing experiments route; it runs nothing) or
// Not now (hidden for this session). Shared by the app's Research map and the
// Inbox's "Needs you", so a suggestion reads and acts the same in both.
// Kept out of ResearchMap.tsx so the Inbox does not load the map's graph code.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, MessagesSquare, Sparkles } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import { criteriaInWords, humanId, proposalCheck, type Proposal } from "@/lib/research-map";
import { loopLabel } from "@/lib/workflow-names";
import { appTitle } from "@/components/workflow/AppCard";
import { StrandAvatar } from "@/components/illustrations/StrandAvatar";
import { cn } from "@/lib/utils";
import { measuredBy } from "@/lib/measure";

const NOT_NOW = (app: string) => `research_not_now_v1:${app}`;
// Snoozed suggestions come back on their own: {id: until (ms)} in this browser.
const SNOOZE = (app: string) => `research_snooze_v1:${app}`;
function readSnoozed(app: string): Record<string, number> {
	try { return JSON.parse(localStorage.getItem(SNOOZE(app)) || "{}"); } catch { return {}; }
}
export function snooze(app: string, id: string, ms: number): void {
	try {
		const now = Date.now();
		const keep = Object.fromEntries(Object.entries(readSnoozed(app)).filter(([, until]) => until > now));
		localStorage.setItem(SNOOZE(app), JSON.stringify({ ...keep, [id]: now + ms }));
	} catch { /* private mode: falls back to this visit only */ }
}
/** Hidden suggestions: put off for this visit, or snoozed and not yet due. */
export function readNotNow(app: string): string[] {
	let off: string[] = [];
	try { off = JSON.parse(sessionStorage.getItem(NOT_NOW(app)) || "[]"); } catch { /* none */ }
	const now = Date.now();
	return [...new Set([...off, ...Object.entries(readSnoozed(app)).filter(([, until]) => until > now).map(([id]) => id)])];
}

export function writeNotNow(app: string, ids: string[]): void {
	try { sessionStorage.setItem(NOT_NOW(app), JSON.stringify(ids)); } catch { /* private mode */ }
}

export default function ApprovalCard({ app, list, index, onIndex, onDone, showApp = false, folded = false, onUnfold }: {
	app: string; list: Proposal[]; index: number; onIndex: (i: number) => void; onDone: (id: string) => void;
	/** Name the app and link to its map — for places outside the app (the Inbox). */
	showApp?: boolean;
	/** Only the header row (something else has the reader's attention). */
	folded?: boolean; onUnfold?: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [full, setFull] = useState(false);
	// Edit before Go ahead (round 9 "control"): which versions to run and how
	// many results each needs. null = as suggested.
	const [editing, setEditing] = useState(false);
	const [keep, setKeep] = useState<string[] | null>(null);
	const [need, setNeed] = useState<number | null>(null);
	const p = list[index];
	useEffect(() => { setEditing(false); setKeep(null); setNeed(null); }, [p?.id]);
	if (!p) return null;
	const loop = p.dispatch_loop || p.dispatch?.loop;
	const metric = p.metric || (p.metric_name ? { name: p.metric_name } : undefined);
	const done = criteriaInWords(p.success_criteria);
	const check = proposalCheck(p);
	const missing = !loop ? "which workflow runs it" : !metric ? "what it measures" : "";
	const allArms = (p.arms || []).map((a) => ({ id: String(a.id ?? ""), description: typeof a.description === "string" ? a.description : undefined })).filter((a) => a.id);
	const arms = keep ? (p.arms || []).filter((a) => keep.includes(String(a.id))) : p.arms;
	const perVersion = need ?? p.min_samples;
	const edited = keep !== null || need !== null;
	// The cost follows the edit: versions × results each, when both are known.
	const estRuns = edited && perVersion && (arms?.length ?? 0) > 0 ? perVersion * (arms?.length ?? 0) : p.est_runs;
	const tooFew = allArms.length > 0 && (arms?.length ?? 0) < 2;
	const goAhead = async () => {
		if (!loop || !metric) return;
		setBusy(true);
		try {
			await me.upsertExperiment(app, {
				id: p.id, loop, metric, dataset_id: p.dataset_id, kind: p.kind, hypothesis: p.hypothesis,
				success_criteria: p.success_criteria, min_samples: perVersion, arms,
			});
			// Go ahead adds the experiment; it runs nothing (a separate press does).
			toast.success(`Added ‘${humanId(p.id)}’ to ${loopLabel("", loop)}. Run its versions when you're ready.`);
			onDone(p.id);
		} catch (e) {
			toast.error(`Couldn't add it: ${e instanceof MeApiError ? e.message : String(e)}`, {
				action: { label: "Ask about it", onClick: () => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: `Start the suggested experiment ${p.id} for me — it failed from the map.`, context: { app } } })) },
			});
		} finally { setBusy(false); }
	};
	// Discuss and research before deciding: the chat reads the app's recent
	// results and related experiments, then lays out the case — it starts nothing.
	const helpDecide = () => window.dispatchEvent(new CustomEvent("studio:ask", { detail: {
		prompt: `Help me decide on the suggested experiment "${humanId(p.id)}" in ${appTitle(app)}. `
			+ `First look at the app's recent results and its related experiments. Then tell me: what it would test and why now; `
			+ `the evidence for and against; what it costs (${p.est_runs ? `about ${p.est_runs} runs` : "not estimated"}${loop ? ` of ${loopLabel("", loop)}` : ""}); `
			+ `what we'd learn whether it works or not; and your recommendation — go ahead, snooze, or not now. Don't start anything.`,
		context: { app },
	} }));
	return (
		<section aria-label="For your approval" className="overflow-hidden rounded-xl border border-ink-200 bg-card shadow-e3 animate-lumen-rise">
			{folded ? (
				// Folded: one row — what it is, which one, and the way back.
				<div className="flex items-center gap-2 px-3 py-2">
					<Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-gold-600" aria-hidden />
					<span className="eyebrow flex-shrink-0 text-gold-700">Suggested</span>
					<button type="button" onClick={onUnfold} title="Show this suggestion"
						className="min-w-0 truncate text-left text-meta font-medium text-ink-900 hover:underline">{humanId(p.id)}</button>
					{list.length > 1 && <span className="flex-shrink-0 font-mono text-micro tabular-nums text-ink-600">{index + 1}/{list.length}</span>}
					<button type="button" onClick={onUnfold} className="ml-auto flex-shrink-0 text-micro text-ink-600 hover:text-ink-900">Show</button>
				</div>
			) : <>
			<div className="flex items-center gap-2 border-b border-ink-100 px-4 py-2.5">
				{showApp ? <StrandAvatar slug={app} size={18} /> : <Sparkles className="w-3.5 h-3.5 text-gold-600" aria-hidden />}
				<span className="eyebrow text-gold-700">{showApp ? `${appTitle(app)} suggests` : "For your approval"}</span>
				<span className="eyebrow text-ink-600">· suggested</span>
				{showApp && (
					<Link to={`/studio/apps/${encodeURIComponent(app)}?suggestion=${encodeURIComponent(p.id)}`}
						className="ml-auto text-micro text-ink-600 hover:text-ink-900 hover:underline">See it on the map</Link>
				)}
				{list.length > 1 && (
					<span className={cn("inline-flex items-center gap-1.5 font-mono text-micro text-ink-600 tabular-nums", !showApp && "ml-auto")}>
						<button type="button" aria-label="Previous suggestion" disabled={index === 0} onClick={() => onIndex(index - 1)} className="p-0.5 rounded hover:bg-ink-100 disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
						{index + 1} / {list.length}
						<button type="button" aria-label="Next suggestion" disabled={index >= list.length - 1} onClick={() => onIndex(index + 1)} className="p-0.5 rounded hover:bg-ink-100 disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
					</span>
				)}
			</div>
			<div key={p.id} className="space-y-2 px-4 pb-3 pt-3 animate-lumen-rise">
				<div className="text-title font-semibold text-ink-900">{humanId(p.id)}</div>
				<dl className="grid gap-1.5 text-meta leading-relaxed">
					{p.hypothesis && (
						<div>
							<dt className="inline font-semibold text-plum-700">Try: </dt>
							<dd className={cn("inline text-ink-800", !full && "line-clamp-3")}>{p.hypothesis}</dd>
							{p.hypothesis.length > 220 && (
								<button type="button" onClick={() => setFull((v) => !v)} className="block text-micro text-ink-600 hover:text-ink-900 underline decoration-dotted">{full ? "Less" : "Read all"}</button>
							)}
						</div>
					)}
					{p.instrument && (
						<div><dt className="inline font-semibold text-plum-700">Measured by: </dt><dd className="inline text-ink-800">{(measuredBy(p.instrument) ?? "").replace(/^Measured by /, "")}</dd></div>
					)}
					<div className="flex flex-wrap items-baseline gap-x-1">
						<dt className="inline font-semibold text-plum-700">Cost: </dt>
						<dd className="inline text-ink-800">{estRuns ? `about ${estRuns} runs` : "not estimated"}{loop ? ` of ${loopLabel("", loop)}` : ""}{edited ? " (edited)" : ""}</dd>
						{(allArms.length > 0 || p.min_samples) && (
							<button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing}
								className="ml-auto text-micro text-ink-700 underline decoration-dotted hover:text-ink-900">{editing ? "Done editing" : "Edit what it runs"}</button>
						)}
					</div>
					{editing && (
						<div className="space-y-2 rounded-lg border border-ink-200 bg-muted/30 px-2.5 py-2 text-caption">
							{allArms.length > 0 && (
								<fieldset className="space-y-1">
									<legend className="text-micro font-medium text-ink-700">Versions to run</legend>
									{allArms.map((a) => {
										const on = keep ? keep.includes(a.id) : true;
										return (
											<label key={a.id} className="flex items-start gap-2">
												<input type="checkbox" checked={on} className="mt-0.5 accent-plum-700"
													onChange={() => setKeep((k) => { const cur = k ?? allArms.map((x) => x.id); return on ? cur.filter((x) => x !== a.id) : [...cur, a.id]; })} />
												<span className="min-w-0"><span className="font-medium text-ink-900">{humanId(a.id)}</span>{a.description && <span className="text-ink-600"> — {a.description}</span>}</span>
											</label>
										);
									})}
									{tooFew && <p className="text-micro text-ember-700">Keep at least two versions, or there is nothing to compare.</p>}
								</fieldset>
							)}
							<label className="flex items-center gap-2">
								<span className="text-micro font-medium text-ink-700">Results needed per version</span>
								<input type="number" min={1} max={500} value={perVersion ?? ""} placeholder="as suggested"
									onChange={(e) => { const n = Math.round(Number(e.target.value)); setNeed(Number.isFinite(n) && n > 0 ? Math.min(500, n) : null); }}
									className="h-7 w-20 rounded-md border border-ink-200 bg-card px-2 text-caption tabular-nums text-ink-900" />
							</label>
							{edited && <button type="button" onClick={() => { setKeep(null); setNeed(null); }} className="text-micro text-ink-600 underline hover:text-ink-900">Back to as suggested</button>}
						</div>
					)}
					{done && <div><dt className="inline font-semibold text-plum-700">Done when: </dt><dd className="inline text-ink-800">{done}</dd></div>}
					{/* Said only when there is something to say: "not checked yet" is noise here. */}
					{check && check.tone !== "idle" && (
						<div title={check.why}>
							<dt className="inline font-semibold text-plum-700">Will it record results? </dt>
							<dd className={cn("inline", check.tone === "ok" ? "text-gold-700" : check.tone === "failing" ? "text-brick-700" : "text-ink-600")}>{check.text}</dd>
						</div>
					)}
				</dl>
				{missing && <div className="text-micro text-ember-700">This suggestion doesn&apos;t say {missing} — ask in chat to set it up.</div>}
			</div>
			{/* Three answers across the foot: put it off (snooze), think it through
			    (the chat looks at the evidence with you), or start it. */}
			<div className="grid grid-cols-3 gap-2 border-t border-ink-100 bg-muted/30 px-3 py-2.5">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button type="button" disabled={busy}
							className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-card text-meta font-medium text-ink-700 transition-colors hover:border-ink-300 hover:bg-muted/60 disabled:opacity-50">
							<AlarmClock className="h-3.5 w-3.5" aria-hidden /> Snooze <ChevronDown className="h-3 w-3 text-ink-500" aria-hidden />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-48">
						<DropdownMenuItem onSelect={() => onDone(p.id)}>Not now <span className="ml-auto text-micro text-ink-600">this visit</span></DropdownMenuItem>
						<DropdownMenuItem onSelect={() => { snooze(app, p.id, 24 * 3600_000); onDone(p.id); toast(`Snoozed "${humanId(p.id)}" until tomorrow.`); }}>Until tomorrow</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => { snooze(app, p.id, 7 * 24 * 3600_000); onDone(p.id); toast(`Snoozed "${humanId(p.id)}" for a week.`); }}>For a week</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<button type="button" onClick={helpDecide} title="The chat looks at the evidence with you: what it would test, for and against, cost, and what you'd learn"
					className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-plum-200 bg-plum-50 text-meta font-medium text-plum-800 transition-colors hover:bg-plum-100">
					<MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Help me decide
				</button>
				<button type="button" onClick={goAhead} disabled={busy || !!missing || tooFew}
					className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gold-300 bg-gold-50 text-meta font-medium text-gold-800 transition-colors hover:bg-gold-100 disabled:opacity-50">
					{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" aria-hidden />} Go ahead
				</button>
			</div>
			</>}
		</section>
	);
}

