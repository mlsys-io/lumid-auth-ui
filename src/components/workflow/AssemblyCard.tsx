// AssemblyCard — the workflow being assembled, INLINE in the chat, drawn as a
// clear three-stage procedure: SEARCH xp.io → MATCH skills → VERIFY.
//
// Replaces the old "+ New workflow" modal. When the agent finishes
// compose_workflow, the rich draft (+ a real assembly_trace from live xp.io)
// is attached to its message and this card plays the build right in the
// transcript — no dialog. Everything it shows is real:
//   1. SEARCH  — the catalog endpoint + scorer + the hits it returned (or an
//                honest "nothing specialised in the public catalog" note).
//   2. MATCH   — each pipeline skill resolved to the repo + path + blob SHA it
//                actually lives at on xp.io (fork parent first, then imports —
//                the runtime's own order). Unresolved skills are flagged
//                local-only, not faked.
//   3. VERIFY  — a checklist computed from the probes: parent published,
//                imports published, N/total skills resolved, risk officer
//                wired, pipeline shape complete.
// The 5-stage LoopOrbit fills in as skills wire; install runs the first cycle.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	Loader2, Check, Shield, Search, Play, TrendingUp, Clock, Package,
	GitBranch, AlertTriangle, X as XIcon, ArrowRight, CircleCheck,
} from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import LoopOrbit, { type LoopStageKey } from "@/components/workflow/LoopOrbit";

export type AssemblyStep = {
	id: string;
	stage: string;
	skill: string;
	why?: string;
	query?: string;
	source?: string;
	score?: number;
	// Live resolution against xp.io.
	resolved?: boolean;
	resolved_repo?: string;   // "<owner>/<repo>"
	resolved_path?: string;   // "skills/foo.py"
	resolved_sha?: string;    // short
	resolved_note?: string;
};
type VerifyRow = { check: string; detail: string; status: "pass" | "warn" | "fail" };
export type AssemblyTrace = {
	search?: { endpoint?: string; query?: string; scorer?: string; note?: string; hits?: Array<{ name?: string; score?: number; matched?: string[] }> };
	resolved_from?: Array<{ repo: string; owner: string; published: boolean; skill_count: number }>;
	verify?: VerifyRow[];
};
export type ComposedDraft = {
	slug: string;
	intent?: string;
	skills?: string[];
	skill_summaries?: Array<{ name: string; display_name?: string; summary?: string; why?: string; source?: string; score?: number; query?: string }>;
	steps?: AssemblyStep[];
	schedule?: string;
	schedule_human?: string;
	goal?: { primary?: string; tracked?: string[] };
	risk_agent?: string;
	mode?: string;
	for_app?: string;
	kind?: string;
	assembly_trace?: AssemblyTrace;
};

const SCHEDULES = [
	{ label: "Every 12 hours", cron: "0 */12 * * *" },
	{ label: "Daily · 8am", cron: "0 8 * * *" },
	{ label: "Hourly", cron: "0 * * * *" },
	{ label: "On demand", cron: "@trigger" },
];

// Deliberate timing — the point is to SEE the procedure, not race it.
const SEARCH_MS = 1700;   // stage 1 "searching the catalog" dwell
const MATCH_SEARCH_MS = 560;  // per-skill "looking it up" dwell
const MATCH_GAP_MS = 480;     // gap after a match before the next
type Phase = "search" | "matching" | "done";

const repoShort = (full?: string) => (full ? full.split("/").pop() || full : "");

export default function AssemblyCard({ draft }: { draft: ComposedDraft }) {
	const navigate = useNavigate();
	const steps = useMemo(() => draft.steps || [], [draft.steps]);
	const trace = draft.assembly_trace;
	const hasPipeline = steps.length > 0;

	const [phase, setPhase] = useState<Phase>(hasPipeline ? "search" : "done");
	const [cursor, setCursor] = useState(0);          // step being matched
	const [sub, setSub] = useState<"searching" | "matched">("searching");
	const [schedule, setSchedule] = useState(draft.schedule || "0 */12 * * *");
	const [installing, setInstalling] = useState(false);
	const [installed, setInstalled] = useState(false);
	const timers = useRef<number[]>([]);
	const rootRef = useRef<HTMLDivElement>(null);

	const arm = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
	useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = []; }, []);

	// On mount, bring the card's TOP into view ONCE so the reveal plays in
	// place (Search → Match → Verify, top-down). After this the user is no
	// longer pinned to the transcript bottom, so the chat's stream auto-scroll
	// stops yanking them down — the card animates without the "jumping".
	useEffect(() => {
		const t = window.setTimeout(() => {
			rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		}, 60);
		return () => clearTimeout(t);
	}, []);

	// Stage 1 — search dwell, then begin matching.
	useEffect(() => {
		if (phase !== "search") return;
		arm(() => { setPhase("matching"); setCursor(0); setSub("searching"); }, SEARCH_MS);
		return () => { timers.current.forEach(clearTimeout); timers.current = []; };
	}, [phase]);

	// Stage 2 — per-skill search→match→advance.
	useEffect(() => {
		if (phase !== "matching") return;
		if (sub === "searching") {
			arm(() => setSub("matched"), MATCH_SEARCH_MS);
		} else {
			arm(() => {
				if (cursor + 1 >= steps.length) setPhase("done");
				else { setCursor((c) => c + 1); setSub("searching"); }
			}, MATCH_GAP_MS);
		}
		return () => { timers.current.forEach(clearTimeout); timers.current = []; };
	}, [phase, sub, cursor, steps.length]);

	const sumOf = (skill: string) => draft.skill_summaries?.find((x) => x.name === skill);
	const labelOf = (s: AssemblyStep) => sumOf(s.skill)?.display_name || s.skill;
	const done = phase === "done";
	const activeStage: LoopStageKey | null = phase === "matching" && steps[cursor] ? (steps[cursor].stage as LoopStageKey) : null;

	const install = async () => {
		setInstalling(true);
		const app = draft.slug.replace(/-draft$/, "");
		try {
			await me.installApp(draft.slug, "local");
			toast.success("Installing your workflow…");
			setInstalled(true);
			window.setTimeout(() => { me.patchLoop(app, app, { schedule }).catch(() => {}); }, 9000);
			window.setTimeout(() => { me.runLoopNow(app, app).catch(() => {}); }, 9500);
			window.setTimeout(() => { navigate(`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(app)}`); }, 8200);
		} catch (e) {
			toast.error(`Install failed: ${e instanceof MeApiError ? e.message : String(e)}`);
			setInstalling(false);
		}
	};

	if (installed) {
		return (
			<div className="mt-2 w-full rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-4 py-5 text-center space-y-2 animate-in fade-in zoom-in-95 duration-300">
				<div className="inline-flex w-11 h-11 rounded-2xl bg-amber-100 text-amber-600 items-center justify-center"><Check className="w-6 h-6" /></div>
				<div className="text-sm font-medium text-slate-900">{draft.slug.replace(/-draft$/, "")} is live — running its first cycle.</div>
				<div className="text-xs text-slate-500">Taking you to its dashboard…</div>
			</div>
		);
	}

	// Stage index for the stepper: 0 search · 1 match · 2 verify.
	const stageIdx = phase === "search" ? 0 : phase === "matching" ? 1 : 2;

	return (
		<div ref={rootRef} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300">
			{/* Header */}
			<div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 bg-gradient-to-r from-amber-50/70 to-white">
				<div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
					{draft.kind === "trading" ? <TrendingUp className="w-4 h-4" /> : <Package className="w-4 h-4" />}
				</div>
				<div className="min-w-0 flex-1">
					<div className="text-[13px] font-semibold text-slate-900 leading-tight">
						{done ? "Workflow assembled" : "Assembling your workflow"}
					</div>
					<div className="text-[11px] text-slate-500 truncate">
						resolved live from the xp.io knowledge graph
					</div>
				</div>
			</div>

			{/* The procedure, drawn: 1 Search → 2 Match → 3 Verify */}
			<Stepper idx={stageIdx} />

			<div className="px-4 pb-3 space-y-3">
				{/* ── Stage 1 · SEARCH ───────────────────────────── */}
				<SearchPanel trace={trace} active={phase === "search"} query={draft.intent} />

				{/* The 5-stage loop fills as skills wire in */}
				<LoopOrbit
					mode={done ? "idle" : "running"}
					pulse={activeStage}
					caption={done ? "observe → hypothesize → act → analyze → learn" : (activeStage ? `wiring the ${activeStage} stage…` : "matching skills to the pipeline")}
				/>

				{/* ── Stage 2 · MATCH ────────────────────────────── */}
				{hasPipeline && phase !== "search" && (
					<div className="space-y-1.5">
						<SectionLabel n={2} text="Match skills · resolved from xp.io" />
						{steps.map((s, i) => {
							const visible = done || i <= cursor;
							if (!visible) return null;
							const searching = phase === "matching" && i === cursor && sub === "searching";
							return (
								<div key={s.id} className="animate-in fade-in slide-in-from-left-1 duration-200">
									{searching
										? <SearchingRow query={s.query || `${s.stage} skill`} />
										: <MatchedRow s={s} label={labelOf(s)} />}
								</div>
							);
						})}
					</div>
				)}

				{/* ── Stage 3 · VERIFY ───────────────────────────── */}
				{done && trace?.verify && trace.verify.length > 0 && (
					<div className="space-y-1.5 animate-in fade-in duration-300">
						<SectionLabel n={3} text="Verify" />
						<div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
							{trace.verify.map((v, i) => <VerifyRowView key={i} v={v} />)}
						</div>
					</div>
				)}

				{/* Review surface — goal, risk, schedule, install */}
				{done && (
					<div className="space-y-3 pt-1 animate-in fade-in duration-300">
						{draft.goal?.primary && (
							<div className="rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50/80 to-white px-3 py-2">
								<div className="text-[10px] uppercase tracking-wide text-amber-700/70 font-semibold">Goal</div>
								<div className="text-[12.5px] text-slate-800 font-medium">{draft.goal.primary}</div>
								{draft.goal.tracked && <div className="text-[10px] text-slate-400 mt-0.5">tracks {draft.goal.tracked.join(" · ")}</div>}
							</div>
						)}
						<div>
							<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" />Schedule</div>
							<div className="flex flex-wrap gap-1.5">
								{SCHEDULES.map((s) => (
									<button key={s.cron} onClick={() => setSchedule(s.cron)}
										className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${schedule === s.cron ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-600 border-slate-200 hover:border-amber-300"}`}>
										{s.label}
									</button>
								))}
							</div>
						</div>
						<div className="flex justify-end pt-0.5">
							<button onClick={install} disabled={installing}
								className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 text-white hover:from-amber-400 hover:to-amber-500 active:scale-95 transition-all shadow-sm shadow-amber-200 disabled:opacity-60">
								{installing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Installing…</> : <><Play className="w-3.5 h-3.5" />Install &amp; run</>}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

// Stepper — draws the three-stage procedure as a progress rail.
function Stepper({ idx }: { idx: number }) {
	const stages = [
		{ icon: Search, label: "Search" },
		{ icon: GitBranch, label: "Match" },
		{ icon: CircleCheck, label: "Verify" },
	];
	return (
		<div className="px-4 py-2.5 flex items-center gap-1 border-b border-slate-100 bg-slate-50/40">
			{stages.map((s, i) => {
				const Icon = s.icon;
				const state = i < idx ? "done" : i === idx ? "active" : "todo";
				return (
					<div key={s.label} className="flex items-center gap-1 flex-1 last:flex-none">
						<div className={[
							"flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors",
							state === "done" ? "text-amber-700" : state === "active" ? "text-amber-700 bg-amber-100" : "text-slate-400",
						].join(" ")}>
							<span className={[
								"w-4 h-4 rounded-full flex items-center justify-center text-[9px]",
								state === "todo" ? "bg-slate-200 text-slate-500" : "bg-amber-500 text-white",
							].join(" ")}>
								{state === "done" ? <Check className="w-2.5 h-2.5" /> : i + 1}
							</span>
							<span className="hidden sm:inline">{s.label}</span>
							<Icon className="w-3 h-3 sm:hidden" />
						</div>
						{i < stages.length - 1 && (
							<div className={["flex-1 h-px mx-0.5", i < idx ? "bg-amber-300" : "bg-slate-200"].join(" ")} />
						)}
					</div>
				);
			})}
		</div>
	);
}

function SectionLabel({ n, text }: { n: number; text: string }) {
	return (
		<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
			<span className="w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[8px] not-italic">{n}</span>
			{text}
		</div>
	);
}

// Stage 1 panel — the real catalog query + scorer + hits (or honest note).
function SearchPanel({ trace, active, query }: { trace?: AssemblyTrace; active: boolean; query?: string }) {
	const s = trace?.search;
	const hits = s?.hits || [];
	return (
		<div className="space-y-1.5">
			<SectionLabel n={1} text="Search the xp.io skill catalog" />
			<div className={["rounded-xl border px-3 py-2 transition-colors", active ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"].join(" ")}>
				<div className="flex items-center gap-1.5 text-[11px]">
					{active ? <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" /> : <Search className="w-3.5 h-3.5 text-slate-400" />}
					<code className="text-[10.5px] text-slate-500">{s?.endpoint || "xp.io · /api/v1/skills/suggest"}</code>
					{s?.scorer && <span className="text-[9px] rounded-full px-1.5 py-px bg-slate-100 border border-slate-200 text-slate-500">{s.scorer}</span>}
				</div>
				<div className="text-[12.5px] text-slate-700 mt-1 truncate">“{s?.query || query || "…"}”</div>
				{hits.length > 0 ? (
					<div className="flex flex-wrap gap-1 mt-1.5">
						{hits.map((h, i) => (
							<span key={i} className="text-[10px] rounded-full px-1.5 py-px bg-white border border-slate-200 text-slate-600">
								{h.name}{typeof h.score === "number" ? ` · ${h.score}` : ""}
							</span>
						))}
					</div>
				) : s?.note ? (
					<div className="text-[11px] text-slate-500 mt-1.5 leading-snug">{s.note}</div>
				) : null}
			</div>
		</div>
	);
}

// Per-skill "looking it up" beat.
function SearchingRow({ query }: { query: string }) {
	return (
		<div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2">
			<Search className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 animate-pulse" />
			<div className="min-w-0 flex-1">
				<div className="text-[11px] text-amber-700/80">resolving against fork parent → imports</div>
				<div className="text-[12.5px] text-slate-700 font-medium truncate">“{query}”</div>
			</div>
			<div className="flex gap-0.5 flex-shrink-0">
				<span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.3s]" />
				<span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.15s]" />
				<span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce" />
			</div>
		</div>
	);
}

// Matched row — the REAL resolution: skill → repo/path @sha, or local-only.
function MatchedRow({ s, label }: { s: AssemblyStep; label: string }) {
	const isRisk = s.id === "risk_gate";
	const resolved = s.resolved !== false && !!s.resolved_repo;
	const repo = repoShort(s.resolved_repo) || s.source;
	return (
		<div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
			<span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRisk ? "bg-amber-500" : resolved ? "bg-amber-500" : "bg-slate-300"}`} />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5 flex-wrap">
					<span className="text-[13px] font-medium text-slate-800">{label}</span>
					<span className="text-[9px] uppercase tracking-wide rounded-full px-1.5 py-px border border-slate-200 text-slate-500">{s.stage}</span>
					{isRisk && <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-700"><Shield className="w-3 h-3" />risk officer</span>}
				</div>
				{/* Provenance — the "drawing" of where it came from */}
				<div className="flex items-center gap-1 mt-1 text-[10.5px] min-w-0">
					{resolved ? (
						<>
							<span className="inline-flex items-center gap-0.5 rounded px-1.5 py-px bg-amber-50 border border-amber-200 text-amber-700 flex-shrink-0">
								<Package className="w-2.5 h-2.5" />{repo}
							</span>
							<ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
							<code className="text-slate-500 truncate">{s.resolved_path}</code>
							{s.resolved_sha && <span className="text-slate-300 flex-shrink-0">@{s.resolved_sha}</span>}
						</>
					) : (
						<span className="inline-flex items-center gap-1 text-amber-600">
							<AlertTriangle className="w-3 h-3" />
							local-only — ships with the {repo || "fork"} (not separately published)
						</span>
					)}
				</div>
				{s.why && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{s.why}</div>}
			</div>
			{resolved
				? <Check className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
				: <span className="w-3.5 flex-shrink-0" />}
		</div>
	);
}

function VerifyRowView({ v }: { v: VerifyRow }) {
	const tone = v.status === "pass"
		? { Icon: Check, c: "text-amber-600", bg: "bg-amber-50" }
		: v.status === "warn"
			? { Icon: AlertTriangle, c: "text-amber-600", bg: "bg-amber-50" }
			: { Icon: XIcon, c: "text-rose-600", bg: "bg-rose-50" };
	const Icon = tone.Icon;
	return (
		<div className="flex items-start gap-2.5 px-3 py-2 bg-white">
			<span className={`mt-0.5 w-4 h-4 rounded-full ${tone.bg} ${tone.c} flex items-center justify-center flex-shrink-0`}>
				<Icon className="w-2.5 h-2.5" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="text-[12px] font-medium text-slate-800">{v.check}</div>
				<div className="text-[11px] text-slate-500 leading-snug">{v.detail}</div>
			</div>
		</div>
	);
}
