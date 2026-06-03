// WorkflowComposer — the "+ New workflow" showcase.
//
// Tuned for ONE flawless case: spinning up a crypto momentum TRADING BOT.
// Four beats: Describe → Assemble (watch the AI build the bot live) →
// Review & tune → Install + first run. The assemble + review render the rich
// trading spec the backend's compose_workflow trading branch returns (steps
// across the observe→…→learn pipeline, a risk officer, schedule, goal).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Loader2, Check, Shield, Sparkles, Play, TrendingUp, Clock } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import LoopOrbit, { type LoopStageKey } from "@/components/workflow/LoopOrbit";

type Step = { id: string; stage: string; skill: string; why?: string };
interface DraftedState {
	slug: string;
	intent: string;
	skills: string[];
	skill_summaries?: Array<{ name: string; display_name?: string; summary?: string; why?: string }>;
	for_app?: string;
	kind?: string;
	steps?: Step[];
	schedule?: string;
	schedule_human?: string;
	goal?: { primary?: string; tracked?: string[] };
	risk_agent?: string;
	mode?: string;
}

interface Props { open: boolean; onClose: () => void }

const TRADING_INTENT =
	"Momentum crypto trading bot, paper mode: every 12 hours sense the market, propose a sized entry with a stop, backtest it, run it past a risk officer, and journal the result.";

const SCHEDULES = [
	{ label: "Every 12 hours", cron: "0 */12 * * *" },
	{ label: "Daily · 8am", cron: "0 8 * * *" },
	{ label: "Hourly", cron: "0 * * * *" },
	{ label: "On demand", cron: "@trigger" },
];

type Wizard = "describe" | "assembling" | "review" | "installed";

export function WorkflowComposer({ open, onClose }: Props) {
	const navigate = useNavigate();
	const [step, setStep] = useState<Wizard>("describe");
	const [intent, setIntent] = useState<string>(TRADING_INTENT);
	const [drafted, setDrafted] = useState<DraftedState | null>(null);
	const [revealed, setRevealed] = useState(0);  // staged assemble reveal
	const [schedule, setSchedule] = useState("0 */12 * * *");
	const [installing, setInstalling] = useState(false);
	const timers = useRef<number[]>([]);

	// Reset to a clean slate each time the modal opens.
	useEffect(() => {
		if (open) { setStep("describe"); setIntent(TRADING_INTENT); setDrafted(null); setRevealed(0); }
		return () => { timers.current.forEach(clearTimeout); timers.current = []; };
	}, [open]);

	// The chat agent runs compose_workflow and fires studio:composed with the
	// (rich) draft. Switch into the assemble reveal.
	useEffect(() => {
		const onComposed = (e: Event) => {
			const d = (e as CustomEvent<DraftedState>).detail;
			if (!d || !d.slug) return;
			setDrafted(d);
			if (d.schedule) setSchedule(d.schedule);
			setStep("assembling");
		};
		window.addEventListener("studio:composed", onComposed as EventListener);
		return () => window.removeEventListener("studio:composed", onComposed as EventListener);
	}, []);

	// Staged reveal: skills/steps appear one-by-one, then advance to review.
	useEffect(() => {
		if (step !== "assembling" || !drafted) return;
		const n = (drafted.steps || drafted.skills || []).length;
		timers.current.forEach(clearTimeout); timers.current = [];
		for (let i = 1; i <= n; i++) timers.current.push(window.setTimeout(() => setRevealed(i), 480 * i));
		timers.current.push(window.setTimeout(() => setStep("review"), 480 * n + 700));
		return () => { timers.current.forEach(clearTimeout); timers.current = []; };
	}, [step, drafted]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !installing) onClose(); };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, installing, onClose]);

	if (!open) return null;

	const compose = async () => {
		const text = intent.trim() || TRADING_INTENT;
		setStep("assembling"); setRevealed(0); setDrafted(null);
		try {
			// Direct compose — instant + deterministic (no chat LLM wait).
			const r = await me.composeWorkflow(text) as unknown as DraftedState & { draft_slug?: string; skills_picked?: string[] };
			const d: DraftedState = {
				slug: String(r.draft_slug || r.slug || ""),
				intent: text,
				skills: Array.isArray(r.skills_picked) ? r.skills_picked : (r.skills || []),
				skill_summaries: r.skill_summaries,
				for_app: r.for_app, kind: r.kind, steps: r.steps,
				schedule: r.schedule, schedule_human: r.schedule_human,
				goal: r.goal, risk_agent: r.risk_agent, mode: r.mode,
			};
			setDrafted(d);
			if (d.schedule) setSchedule(d.schedule);
			// the assembling reveal kicks off via the effect watching `drafted`
		} catch (e) {
			toast.error(`Compose failed: ${e instanceof MeApiError ? e.message : String(e)}`);
			setStep("describe");
		}
	};

	const installAndRun = async () => {
		if (!drafted) return;
		setInstalling(true);
		const app = drafted.slug.replace(/-draft$/, "");
		try {
			await me.installApp(drafted.slug, "local");
			toast.success("Installing your trading bot…");
			setStep("installed");
			// Install is async (~8s to stage the app). Hold the success screen
			// long enough for the app to exist, then land on its dashboard.
			// Best-effort: set the chosen schedule + kick the first paper run
			// once the app is live (after install completes).
			window.setTimeout(() => { me.patchLoop(app, app, { schedule }).catch(() => {}); }, 9000);
			window.setTimeout(() => { me.runLoopNow(app, app).catch(() => {}); }, 9500);
			window.setTimeout(() => {
				onClose();
				navigate(`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(app)}`);
			}, 8000);
		} catch (e) {
			toast.error(`Install failed: ${e instanceof MeApiError ? e.message : String(e)}`);
			setInstalling(false);
		}
	};

	const steps = drafted?.steps || [];
	const activeStage: LoopStageKey | null =
		step === "assembling" && steps[revealed - 1] ? (steps[revealed - 1].stage as LoopStageKey) : null;

	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !installing && onClose()} />
			<div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col">
				<header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
					<div>
						<h2 className="font-semibold text-slate-900">New workflow</h2>
						<p className="text-xs text-slate-500">Describe it — your AI assembles, schedules, and runs it.</p>
					</div>
					<button onClick={() => !installing && onClose()} className="p-1.5 text-slate-400 hover:text-slate-700 rounded"><X className="w-4 h-4" /></button>
				</header>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{step === "describe" && <Describe intent={intent} setIntent={setIntent} onGo={compose} />}
					{step === "assembling" && <Assemble drafted={drafted} steps={steps} revealed={revealed} activeStage={activeStage} />}
					{step === "review" && drafted && (
						<Review drafted={drafted} schedule={schedule} setSchedule={setSchedule} installing={installing} onInstall={installAndRun} onBack={() => setStep("describe")} />
					)}
					{step === "installed" && <Installed slug={drafted?.slug.replace(/-draft$/, "") || ""} />}
				</div>
			</div>
		</div>
	);
}

function Describe({ intent, setIntent, onGo }: { intent: string; setIntent: (s: string) => void; onGo: () => void }) {
	return (
		<div className="space-y-4">
			{/* The showcase starter */}
			<button onClick={() => { setIntent(TRADING_INTENT); setTimeout(onGo, 250); }}
				className="w-full text-left rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 hover:shadow-md hover:shadow-emerald-100 transition-all active:scale-[0.99]">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><TrendingUp className="w-5 h-5" /></div>
					<div>
						<div className="text-sm font-semibold text-slate-900">Crypto momentum trader</div>
						<div className="text-[12px] text-slate-500">A paper bot that senses the market, proposes risk-checked trades every 12h, and learns from each.</div>
					</div>
				</div>
			</button>

			<div className="relative">
				<div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
				<div className="relative flex justify-center"><span className="px-3 bg-white text-[10px] uppercase tracking-wider text-slate-400">or describe your own</span></div>
			</div>

			<textarea value={intent} onChange={(e) => setIntent(e.target.value)} rows={3}
				placeholder="In plain English — what should it do, and how often?"
				className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-4 focus:ring-emerald-400/15 focus:border-emerald-400 resize-y" />
			<div className="flex justify-end">
				<button onClick={onGo} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 active:scale-95 transition-all shadow-sm shadow-emerald-200">
					<Sparkles className="w-3.5 h-3.5" />Assemble it
				</button>
			</div>
		</div>
	);
}

const STAGE_OF = (s: Step) => s.stage;
function Assemble({ drafted, steps, revealed, activeStage }: { drafted: DraftedState | null; steps: Step[]; revealed: number; activeStage: LoopStageKey | null }) {
	return (
		<div className="space-y-4">
			<div className="text-center">
				<div className="inline-flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-4 h-4 animate-spin text-emerald-500" />Assembling your bot…</div>
			</div>
			<LoopOrbit mode="running" pulse={activeStage} caption={activeStage ? `Wiring the ${activeStage} stage…` : "Matching skills to the pipeline"} />
			<div className="space-y-1.5">
				{steps.slice(0, Math.max(revealed, 0)).map((s, i) => (
					<div key={s.id} className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 animate-in fade-in slide-in-from-left-2 duration-300">
						<span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.id === "risk_gate" ? "bg-amber-500" : "bg-emerald-500"}`} />
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span className="text-[13px] font-medium text-slate-800">{(drafted?.skill_summaries?.find((x) => x.name === s.skill)?.display_name) || s.skill}</span>
								<span className="text-[9px] uppercase tracking-wide rounded-full px-1.5 py-px border border-slate-200 text-slate-500">{STAGE_OF(s)}</span>
								{s.id === "risk_gate" && <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700"><Shield className="w-3 h-3" />risk officer</span>}
							</div>
							{s.why && <div className="text-[11px] text-slate-500 mt-0.5">{s.why}</div>}
						</div>
						<Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
					</div>
				))}
				{revealed < steps.length && <div className="text-[11px] text-slate-300 pl-3">…</div>}
			</div>
		</div>
	);
}

function Review({ drafted, schedule, setSchedule, installing, onInstall, onBack }: {
	drafted: DraftedState; schedule: string; setSchedule: (s: string) => void; installing: boolean; onInstall: () => void; onBack: () => void;
}) {
	const steps = drafted.steps || [];
	return (
		<div className="space-y-4">
			<div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex items-start gap-2">
				<Check className="w-3.5 h-3.5 mt-0.5" />
				<div><span className="font-medium">Bot assembled.</span> {steps.length} steps across the observe→learn loop{drafted.mode === "paper" ? " · paper mode" : ""}. Review + install.</div>
			</div>

			{drafted.goal?.primary && (
				<div className="rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-white p-3">
					<div className="text-[10px] uppercase tracking-wide text-emerald-700/70 font-semibold">Goal</div>
					<div className="text-[13px] text-slate-800 font-medium">{drafted.goal.primary}</div>
					{drafted.goal.tracked && <div className="text-[10px] text-slate-400 mt-1">tracks {drafted.goal.tracked.join(" · ")}</div>}
				</div>
			)}

			<LoopOrbit mode="idle" pulse={null} caption="observe → hypothesize → act → analyze → learn" />

			<div className="space-y-1.5">
				{steps.map((s) => (
					<div key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
						<span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.id === "risk_gate" ? "bg-amber-500" : "bg-emerald-400"}`} />
						<span className="text-[12px] text-slate-700 flex-1 truncate">{(drafted.skill_summaries?.find((x) => x.name === s.skill)?.display_name) || s.skill}</span>
						{s.id === "risk_gate" && <Shield className="w-3 h-3 text-amber-600" />}
						<span className="text-[9px] uppercase tracking-wide text-slate-400">{s.stage}</span>
					</div>
				))}
			</div>

			{/* Schedule picker */}
			<div>
				<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" />Schedule</div>
				<div className="flex flex-wrap gap-1.5">
					{SCHEDULES.map((s) => (
						<button key={s.cron} onClick={() => setSchedule(s.cron)}
							className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${schedule === s.cron ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"}`}>
							{s.label}
						</button>
					))}
				</div>
			</div>

			<div className="pt-1 flex justify-between items-center">
				<button onClick={onBack} disabled={installing} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
				<button onClick={onInstall} disabled={installing}
					className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 active:scale-95 transition-all shadow-sm shadow-emerald-200 disabled:opacity-60">
					{installing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Installing…</> : <><Play className="w-3.5 h-3.5" />Install &amp; run</>}
				</button>
			</div>
		</div>
	);
}

function Installed({ slug }: { slug: string }) {
	return (
		<div className="py-10 text-center space-y-3">
			<div className="inline-flex w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 items-center justify-center animate-in zoom-in duration-300"><Check className="w-7 h-7" /></div>
			<div className="text-sm font-medium text-slate-900">{slug} is live — running its first cycle.</div>
			<div className="text-xs text-slate-500">Taking you to its dashboard…</div>
		</div>
	);
}

export default WorkflowComposer;
