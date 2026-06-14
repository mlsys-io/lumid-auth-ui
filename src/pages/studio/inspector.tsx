// Phase S3-B / Workstream C — cycle inspector page.
//
// Surfaces a single cycle's iteration record honestly:
//   - the cycle OUTCOME (ran / no_change / awaiting_review / no_setup),
//     including no_change skips and failures shown as-is;
//   - observe evidence + the gate decision (summary.observe_gate);
//   - a human REVIEW QUEUE (summary.review_queue) of held items with
//     approve / edit / revamp controls (wired via me.replyReview, which
//     rides the existing inbox/draft approve path + the backend's
//     step_instructions reply for "revamp");
//   - spot-wise Compound OFFERS (summary.offers);
//   - the step-by-step drill-down (input/output, prompt audit).
//
// All the summary.* fields are OPTIONAL — old cycles won't carry them,
// so each block renders only when present.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
	ChevronLeft, CheckCircle2, AlertCircle, ChevronDown, ChevronRight,
	Loader2, MinusCircle, Clock, Eye, Lightbulb, Wand2, Workflow, Pencil, FlaskConical,
} from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '@/api/client';
import { me, MeApiError } from '@/api/me';
import LoopOrbit, { LOOP_STAGES } from '@/components/workflow/LoopOrbit';

// Compact cycle-dir id (20260602T010000Z) → readable.
function prettyTs(ts?: string): string {
	if (!ts) return '';
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
	if (!m) return ts;
	const [, y, mo, d, h, mi] = m;
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${months[+mo - 1]} ${+d}, ${y} · ${h}:${mi}`;
}

function humanizeLoopName(loop?: string): string {
	if (!loop) return '';
	return loop.charAt(0).toUpperCase() + loop.slice(1).replace(/_/g, ' ');
}

export type Step = {
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

// summary.* shape from the cycle/journal contract. All optional.
export type Outcome = 'ran' | 'no_change' | 'awaiting_review' | 'no_setup';

export interface ReviewItem {
	step_id: string;
	skill_id?: string;
	stage?: string;
	kind: 'skill' | 'memory';
	planned_kwargs?: Record<string, unknown>;
	outbox_ref: string;
}

export interface CompoundOffer {
	id?: string;
	trigger?: { kind: 'pattern' | 'principle'; key: string; count: number };
	kind: 'knowledge' | 'skill' | 'workflow' | 'experiment';
	experiment_id?: string;
	title: string;
	detail?: string;
	action?: { type: string; spec?: unknown; schedule?: string };
}

export interface ObserveGate {
	evaluated: boolean;
	passed: boolean;
	reason: string;
}

export interface CycleSummary {
	outcome?: Outcome;
	review_queue?: ReviewItem[];
	offers?: CompoundOffer[];
	observe_gate?: ObserveGate;
	[k: string]: unknown;
}

const OUTCOME_META: Record<Outcome, { label: string; icon: typeof CheckCircle2; cls: string }> = {
	ran:             { label: 'Ran',             icon: CheckCircle2, cls: 'border-amber-200 bg-amber-50 text-amber-800' },
	no_change:       { label: 'No change',       icon: MinusCircle,  cls: 'border-slate-200 bg-slate-50 text-slate-600' },
	awaiting_review: { label: 'Awaiting review', icon: Clock,        cls: 'border-amber-200 bg-amber-50 text-amber-800' },
	no_setup:        { label: 'Not set up',      icon: AlertCircle,  cls: 'border-rose-200 bg-rose-50 text-rose-800' },
};

export default function CycleInspector() {
	const { app, loop, ts } = useParams<{ app: string; loop: string; ts: string }>();
	const [data, setData] = useState<{ summary: CycleSummary; steps: Step[] } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	const load = useCallback(() => {
		if (!app || !loop || !ts) return;
		apiClient.get(`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}`)
			.then((r: { data: { data: { summary: CycleSummary; steps: Step[] } } }) => setData(r.data.data))
			.catch((e) => setError(e?.message || 'Failed to load run'));
	}, [app, loop, ts]);

	useEffect(() => { load(); }, [load]);

	if (error) return <div className="text-rose-700 text-sm">{error}</div>;
	if (!data) return <div className="text-sm text-slate-500 italic">Loading run…</div>;

	const summary = data.summary || {};
	const outcome = summary.outcome;
	const reviewQueue = Array.isArray(summary.review_queue) ? summary.review_queue : [];
	const offers = Array.isArray(summary.offers) ? summary.offers : [];
	const gate = summary.observe_gate;

	// Group steps by their canonical stage so the cycle reads as a story
	// (observe → … → learn) rather than a flat technical step list.
	const byStage: Record<string, Step[]> = {};
	for (const s of data.steps) {
		const k = (s.stage || "other").toLowerCase();
		(byStage[k] ||= []).push(s);
	}

	const renderStep = (s: Step) => {
		const open = expanded[s.step_id];
		const Icon = s.ok ? CheckCircle2 : AlertCircle;
		return (
			<li key={s.step_id} className="rounded-lg border border-slate-200/80 bg-white overflow-hidden">
				<button
					onClick={() => setExpanded((m) => ({ ...m, [s.step_id]: !m[s.step_id] }))}
					className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-slate-50"
				>
					<Icon className={s.ok ? 'w-4 h-4 mt-0.5 text-amber-600 flex-shrink-0' : 'w-4 h-4 mt-0.5 text-rose-600 flex-shrink-0'} />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium text-slate-800">{s.skill || s.step_id}</span>
							{s.duration_s != null && <span className="text-[10px] text-slate-400 tabular-nums">{s.duration_s.toFixed(1)}s</span>}
						</div>
						{s.output_summary && <div className={open ? "text-xs text-slate-600 mt-0.5" : "text-xs text-slate-600 mt-0.5 line-clamp-2"}>{s.output_summary}</div>}
					</div>
					{(open ? <ChevronDown className="w-3.5 h-3.5 text-slate-300 flex-shrink-0 mt-1" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0 mt-1" />)}
				</button>
				{open && (
					<div className="px-3 pb-3 pl-9 space-y-3">
						{s.error && (
							<div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 whitespace-pre-wrap font-mono">{s.error}</div>
						)}
						{s.prompt_preview && (
							<div>
								<div className="text-[10px] tracking-wide text-slate-400 mb-1">Prompt {s.prompt_sha && <span className="font-mono">· {s.prompt_sha.slice(0, 12)}</span>}</div>
								<pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 rounded p-2 border border-slate-200">{s.prompt_preview}</pre>
							</div>
						)}
						<div>
							<div className="text-[10px] tracking-wide text-slate-400 mb-1">Output</div>
							<pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 rounded p-2 border border-slate-200 max-h-80 overflow-auto">{JSON.stringify(s.output, null, 2)}</pre>
						</div>
					</div>
				)}
			</li>
		);
	};

	return (
		<div className="space-y-4 max-w-3xl">
			<Link
				to={app && loop ? `/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(loop)}` : "/studio/apps"}
				className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 gap-1"
			>
				<ChevronLeft className="w-4 h-4" /> Back to workflow
			</Link>

			<header className="flex items-start justify-between gap-3">
				<div>
					<h1 className="text-lg font-semibold text-slate-900">{humanizeLoopName(loop)}</h1>
					<div className="text-xs text-slate-500 mt-0.5">{app} · {prettyTs(ts)}</div>
				</div>
				{outcome && <OutcomePill outcome={outcome} />}
			</header>

			{/* Visual map of the loop this cycle walked. */}
			<LoopOrbit mode="idle" caption="What this run did, stage by stage" />

			{/* Stage-grouped narrative */}
			<div className="space-y-3">
				{LOOP_STAGES.map((stage) => {
					const steps = byStage[stage.key] || [];
					const showGate = stage.key === "observe" && gate;
					const showReview = stage.key === "act" && reviewQueue.length > 0;
					const showOffers = stage.key === "learn" && offers.length > 0;
					if (steps.length === 0 && !showGate && !showReview && !showOffers) return null;
					const Icon = stage.Icon;
					return (
						<section key={stage.key} className="rounded-xl border border-slate-200 bg-white/60 p-3">
							<div className="flex items-center gap-2 mb-2">
								<div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Icon className="w-3.5 h-3.5" /></div>
								<h3 className="text-[13px] font-semibold text-slate-800">{stage.label}</h3>
							</div>
							{showGate && <div className="mb-2"><ObserveGatePanel gate={gate!} /></div>}
							{steps.length > 0 && <ul className="space-y-1.5">{steps.map(renderStep)}</ul>}
							{showReview && app && loop && ts && (
								<div className="mt-2"><ReviewQueue app={app} loop={loop} ts={ts} items={reviewQueue} onActed={load} /></div>
							)}
							{showOffers && <div className="mt-2"><OffersPanel offers={offers} app={app} loop={loop} ts={ts} /></div>}
						</section>
					);
				})}

				{/* Any steps without a declared stage. */}
				{(byStage["other"]?.length ?? 0) > 0 && (
					<section className="rounded-xl border border-slate-200 bg-white/60 p-3">
						<h3 className="text-[13px] font-semibold text-slate-800 mb-2">Other steps</h3>
						<ul className="space-y-1.5">{byStage["other"].map(renderStep)}</ul>
					</section>
				)}

				{data.steps.length === 0 && !gate && reviewQueue.length === 0 && offers.length === 0 && (
					<div className="text-sm text-slate-500 italic">No artifacts recorded for this run.</div>
				)}
			</div>

			{/* Raw summary — for the curious, collapsed. */}
			<details className="rounded-lg border border-slate-200 bg-white p-3 group">
				<summary className="text-[11px] font-medium tracking-wide text-slate-400 cursor-pointer select-none">Raw summary</summary>
				<pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed mt-2 max-h-96 overflow-auto">{JSON.stringify(summary, null, 2)}</pre>
			</details>
		</div>
	);
}

// ── Outcome pill ───────────────────────────────────────────────────

export function OutcomePill({ outcome }: { outcome: Outcome }) {
	const meta = OUTCOME_META[outcome] ?? OUTCOME_META.ran;
	const Icon = meta.icon;
	return (
		<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${meta.cls}`}>
			<Icon className="w-3.5 h-3.5" />
			{meta.label}
		</span>
	);
}

// ── Observe evidence + gate decision ───────────────────────────────

export function ObserveGatePanel({ gate }: { gate: ObserveGate }) {
	const cls = !gate.evaluated
		? 'border-slate-200 bg-slate-50 text-slate-600'
		: gate.passed
			? 'border-amber-200 bg-amber-50 text-amber-800'
			: 'border-amber-200 bg-amber-50 text-amber-800';
	return (
		<section className={`rounded-lg border px-3 py-2.5 ${cls}`}>
			<div className="flex items-center gap-2 text-xs font-medium">
				<Eye className="w-4 h-4" />
				Observe gate
				<span className="ml-1 text-[10px] uppercase tracking-wide opacity-80">
					{!gate.evaluated ? 'not evaluated' : gate.passed ? 'passed — proceeding' : 'held — did not proceed'}
				</span>
			</div>
			{gate.reason && <div className="text-xs mt-1 opacity-90 leading-snug">{gate.reason}</div>}
		</section>
	);
}

// ── Review queue (human checkpoint) ────────────────────────────────

export function ReviewQueue({
	app, loop, ts, items, onActed,
}: {
	app: string; loop: string; ts: string; items: ReviewItem[]; onActed: () => void;
}) {
	return (
		<section className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
			<div className="flex items-center gap-2 mb-2">
				<Clock className="w-4 h-4 text-amber-700" />
				<h2 className="text-sm font-medium text-amber-900">Awaiting your approval</h2>
				<span className="text-[11px] text-amber-700">{items.length} held</span>
			</div>
			<ul className="space-y-2">
				{items.map((it) => (
					<ReviewRow
						key={it.outbox_ref || it.step_id}
						app={app}
						loop={loop}
						ts={ts}
						item={it}
						onActed={onActed}
					/>
				))}
			</ul>
		</section>
	);
}

type ReviewBusy = 'approve' | 'edit' | 'revamp' | null;

function ReviewRow({
	app, loop, ts, item, onActed,
}: {
	app: string; loop: string; ts: string; item: ReviewItem; onActed: () => void;
}) {
	const [busy, setBusy] = useState<ReviewBusy>(null);
	const [done, setDone] = useState<string | null>(null);
	// "edit" — editable planned_kwargs JSON. "revamp" — free-text
	// step_instructions for the next run.
	const [mode, setMode] = useState<null | 'edit' | 'revamp'>(null);
	const [editText, setEditText] = useState(() =>
		JSON.stringify(item.planned_kwargs ?? {}, null, 2));
	const [instr, setInstr] = useState('');

	const reply = async (
		decision: 'approve' | 'edit' | 'revamp',
		extra: { planned_kwargs?: Record<string, unknown>; step_instructions?: string } = {},
	) => {
		setBusy(decision);
		try {
			await me.replyReview(app, loop, ts, {
				outbox_ref: item.outbox_ref,
				step_id: item.step_id,
				decision,
				...extra,
			});
			const label = decision === 'approve' ? 'Approved' : decision === 'edit' ? 'Approved with edits' : 'Sent revamp instruction';
			toast.success(label);
			setDone(label);
			setMode(null);
			onActed();
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	};

	const approveEdit = () => {
		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(editText || '{}');
		} catch {
			toast.error('Edited inputs are not valid JSON');
			return;
		}
		reply('edit', { planned_kwargs: parsed });
	};

	const sendRevamp = () => {
		if (!instr.trim()) {
			toast.error('Add an instruction for the next run');
			return;
		}
		reply('revamp', { step_instructions: instr.trim() });
	};

	return (
		<li className="rounded-lg border border-amber-200/70 bg-white p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="font-mono text-sm font-medium text-slate-900">{item.step_id}</span>
						{item.skill_id && <span className="text-xs text-slate-500">{item.skill_id}</span>}
						<span className="text-[10px] uppercase tracking-wide rounded-full px-1.5 py-px border border-slate-200 bg-slate-50 text-slate-500">
							{item.kind}
						</span>
						{item.stage && <span className="text-[10px] tracking-wide text-slate-400">{item.stage}</span>}
					</div>
					{item.planned_kwargs && Object.keys(item.planned_kwargs).length > 0 && mode !== 'edit' && (
						<pre className="text-[11px] text-slate-600 font-mono mt-1.5 bg-slate-50 rounded p-2 border border-slate-100 max-h-32 overflow-auto whitespace-pre-wrap">
							{JSON.stringify(item.planned_kwargs, null, 2)}
						</pre>
					)}
				</div>
				{done ? (
					<span className="shrink-0 inline-flex items-center gap-1 text-xs text-amber-700">
						<CheckCircle2 className="w-3.5 h-3.5" /> {done}
					</span>
				) : (
					<div className="shrink-0 inline-flex items-center gap-1.5">
						<button
							onClick={() => reply('approve')}
							disabled={!!busy}
							className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
						>
							{busy === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
							Approve
						</button>
						<button
							onClick={() => setMode(mode === 'edit' ? null : 'edit')}
							disabled={!!busy}
							className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
						>
							<Pencil className="w-3 h-3" /> Edit
						</button>
						<button
							onClick={() => setMode(mode === 'revamp' ? null : 'revamp')}
							disabled={!!busy}
							className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
							title="Adjust the next run with a free-text instruction"
						>
							Revamp
						</button>
					</div>
				)}
			</div>

			{mode === 'edit' && !done && (
				<div className="mt-2 space-y-2">
					<div className="text-[10px] tracking-wide text-slate-400">Edit the inputs, then approve with edits.</div>
					<textarea
						value={editText}
						onChange={(e) => setEditText(e.target.value)}
						className="w-full text-xs border border-slate-300 rounded p-2 font-mono"
						rows={6}
					/>
					<div className="flex justify-end gap-2">
						<button
							onClick={() => setMode(null)}
							className="px-3 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50"
						>Cancel</button>
						<button
							onClick={approveEdit}
							disabled={!!busy}
							className="px-3 py-1 text-xs rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
						>
							{busy === 'edit' ? 'Saving…' : 'Approve with edits'}
						</button>
					</div>
				</div>
			)}

			{mode === 'revamp' && !done && (
				<div className="mt-2 space-y-2">
					<div className="text-[10px] tracking-wide text-slate-400">Tell your AI how to adjust the next run of this step.</div>
					<textarea
						value={instr}
						onChange={(e) => setInstr(e.target.value)}
						placeholder="e.g. tighten the latency budget to 150ms and skip the heavy reranker."
						className="w-full text-sm border border-slate-300 rounded p-2 font-sans"
						rows={3}
					/>
					<div className="flex justify-end gap-2">
						<button
							onClick={() => setMode(null)}
							className="px-3 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50"
						>Cancel</button>
						<button
							onClick={sendRevamp}
							disabled={!!busy}
							className="px-3 py-1 text-xs rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
						>
							{busy === 'revamp' ? 'Sending…' : 'Send instruction'}
						</button>
					</div>
				</div>
			)}
		</li>
	);
}

// ── Spot-wise Compound offers ──────────────────────────────────────

const OFFER_KIND_META: Record<CompoundOffer['kind'], { label: string; icon: typeof Lightbulb; tone: string; iconTone: string }> = {
	knowledge: { label: 'extra knowledge', icon: Lightbulb, tone: 'border-amber-200 bg-amber-50/40',    iconTone: 'bg-amber-100 text-amber-700' },
	skill:     { label: 'a skill',         icon: Wand2,     tone: 'border-amber-200 bg-amber-50/40', iconTone: 'bg-amber-100 text-amber-700' },
	workflow:  { label: 'a workflow',      icon: Workflow,  tone: 'border-indigo-200 bg-indigo-50/40',   iconTone: 'bg-indigo-100 text-indigo-700' },
	experiment:{ label: 'an experiment verdict', icon: FlaskConical, tone: 'border-violet-200 bg-violet-50/40', iconTone: 'bg-violet-100 text-violet-700' },
};

export function OffersPanel({ offers, app, loop, ts }: {
	offers: CompoundOffer[];
	/** When the run context is known, offers gain Adopt / Dismiss —
	 *  persisted as cycle feedback (kind adopt_offer|dismiss_offer) the
	 *  engine's feedback rules can consume. */
	app?: string;
	loop?: string;
	ts?: string;
}) {
	const [acted, setActed] = useState<Record<string, "adopted" | "dismissed">>({});
	const act = async (o: CompoundOffer, idx: number, kind: "adopt_offer" | "dismiss_offer") => {
		if (!app || !loop || !ts) return;
		const key = o.id || String(idx);
		try {
			await me.cycleFeedback({ app, loop, cycle_ts: ts, output_id: o.id || `offer-${idx}`, kind, note: o.title });
			setActed((m) => ({ ...m, [key]: kind === "adopt_offer" ? "adopted" : "dismissed" }));
		} catch { /* leave actionable */ }
	};
	return (
		<section className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3">
			<div className="flex items-center gap-2 mb-2">
				<Lightbulb className="w-4 h-4 text-indigo-700" />
				<h2 className="text-sm font-medium text-indigo-900">Compound offers</h2>
				<span className="text-[11px] text-indigo-700">recalled at this spot</span>
			</div>
			<ul className="space-y-2">
				{offers.map((o, i) => {
					const meta = OFFER_KIND_META[o.kind] ?? OFFER_KIND_META.knowledge;
					const Icon = meta.icon;
					return (
						<li key={o.id || i} className={`rounded-lg border px-3 py-2.5 flex items-start gap-2.5 ${meta.tone}`}>
							<div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.iconTone}`}>
								<Icon className="w-3.5 h-3.5" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5 flex-wrap">
									<span className="text-[13px] font-medium text-slate-900 leading-tight">{o.title}</span>
									<span className="text-[9px] uppercase tracking-wide rounded-full px-1.5 py-px border border-indigo-100 bg-indigo-50 text-indigo-700">
										offer · {meta.label}
									</span>
								</div>
								{o.trigger && (
									<div className="text-[10px] text-slate-500 mt-0.5">
										from {o.trigger.kind} <span className="font-mono">{o.trigger.key}</span>
										{o.trigger.count > 1 && <> · seen ×{o.trigger.count}</>}
									</div>
								)}
								{o.detail && <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">{o.detail}</div>}
								{o.action?.schedule && (
									<div className="text-[10px] text-indigo-700 mt-1 inline-flex items-center gap-1">
										<ChevronRight className="w-3 h-3" />
										{o.action.type} <span className="font-mono">· {o.action.schedule}</span>
									</div>
								)}
								{app && loop && ts && (
									<div className="mt-1.5 flex items-center gap-1.5">
										{acted[o.id || String(i)] ? (
											<span className="text-[10px] font-medium text-slate-500">
												{acted[o.id || String(i)] === "adopted" ? "✓ adopted — feeds the next run's feedback rules" : "dismissed"}
											</span>
										) : (
											<>
												<button onClick={() => act(o, i, "adopt_offer")}
													className="px-2 py-0.5 text-[10px] font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
													Adopt
												</button>
												<button onClick={() => act(o, i, "dismiss_offer")}
													className="px-2 py-0.5 text-[10px] font-medium rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
													Dismiss
												</button>
											</>
										)}
									</div>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
