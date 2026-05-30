// WorkflowComposer — the "+ New workflow" entry point (W2).
//
// Two paths:
//   - "Describe what you want" — chat-driven. Opens StudioChat with a
//     pre-filled prompt that triggers the `compose_workflow` tool;
//     the agent drafts an xpcloud.yaml in the tenant draft dir and
//     replies with a link to review.
//   - "Design visually" — opens N8nEditor (iframe). Lands in W2 as
//     opt-in: the user signs into n8n once; the SSO bridge to mint
//     the n8n session from the lum.id session is a follow-up.

import { useEffect, useState } from "react";
import { X, MessageSquare, GitBranch, ExternalLink, Check, Loader2, Mail, Calendar, MessagesSquare, Sun, Search, FileText } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import N8nEditor from "@/components/N8nEditor";

// Templates — the 6 most-common Personal AI intents. Each maps to an
// intent string the compose_workflow chat tool can run. The icon is
// for visual scanning; the intent is what gets sent.
const TEMPLATES: Array<{
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	desc: string;
	intent: string;
	tone: string;
}> = [
	{
		icon: Sun, title: "Daily brief", tone: "amber",
		desc: "Wake-up summary of email + calendar + anything you watch.",
		intent: "Every morning at 7am, summarize my unread email + today's calendar + any flagged news into a single brief I can scan in 30 seconds.",
	},
	{
		icon: Mail, title: "Email triage", tone: "indigo",
		desc: "AI reads your inbox hourly and drafts replies to the obvious ones.",
		intent: "Every hour during work hours, read my Gmail inbox, identify the 3-5 most important threads, and draft replies to anything that has a clear answer. Keep the drafts in my inbox queue for review before sending.",
	},
	{
		icon: Calendar, title: "Meeting prep", tone: "violet",
		desc: "Briefing notes 30 min before each meeting.",
		intent: "30 minutes before any meeting on my calendar, prepare a brief: who's attending, recent email/Slack context with each person, and any docs we've shared. Drop it in my inbox.",
	},
	{
		icon: MessagesSquare, title: "Slack summary", tone: "emerald",
		desc: "Twice a day, recap what was missed across channels.",
		intent: "Twice a day (lunch and end of day), summarize unread messages across my Slack channels into a one-paragraph digest. Flag anything that asks me a question directly.",
	},
	{
		icon: Search, title: "Web research", tone: "sky",
		desc: "Track a topic; surface new sources weekly.",
		intent: "Every Monday morning, search the web + arxiv for new content about: [TOPIC]. Produce a one-page brief with the 5 most relevant new sources, summaries, and why each matters.",
	},
	{
		icon: FileText, title: "Doc synthesis", tone: "rose",
		desc: "Read a PDF or set of docs; produce structured notes.",
		intent: "When I drop a PDF in a watched folder, extract the key points, claims with evidence, and open questions. Write notes back to my knowledge bank tagged by source.",
	},
];

type Mode = "describe" | "visual";

interface Props {
	open: boolean;
	onClose: () => void;
}

// LocalStorage keys for composer persistence so users don't lose
// their intent if they accidentally close the modal.
const LS_INTENT = "studio:composer:intent:v1";
const LS_DRAFT = "studio:composer:draft:v1";

interface DraftedState {
	slug: string;
	intent: string;
	skills: string[];
	skill_summaries?: Array<{ name: string; display_name?: string; summary?: string; why?: string }>;
	for_app?: string;
}

export function WorkflowComposer({ open, onClose }: Props) {
	const [mode, setMode] = useState<Mode>("describe");
	const [intent, setIntent] = useState<string>(() => {
		try { return localStorage.getItem(LS_INTENT) || ""; } catch { return ""; }
	});
	const [drafted, setDrafted] = useState<DraftedState | null>(() => {
		try {
			const raw = localStorage.getItem(LS_DRAFT);
			return raw ? JSON.parse(raw) as DraftedState : null;
		} catch { return null; }
	});
	const [installing, setInstalling] = useState(false);

	// Persist intent + drafted across modal opens.
	useEffect(() => {
		try { localStorage.setItem(LS_INTENT, intent); } catch { /* ignore */ }
	}, [intent]);
	useEffect(() => {
		try {
			if (drafted) localStorage.setItem(LS_DRAFT, JSON.stringify(drafted));
			else localStorage.removeItem(LS_DRAFT);
		} catch { /* ignore */ }
	}, [drafted]);

	// Listen for compose_workflow tool results from the chat agent.
	// StudioChat fires a 'studio:composed' event after a successful
	// tool call so the composer can switch into "review" mode.
	useEffect(() => {
		const onComposed = (e: Event) => {
			const ce = e as CustomEvent<DraftedState>;
			if (!ce.detail || !ce.detail.slug) return;
			setDrafted(ce.detail);
		};
		window.addEventListener("studio:composed", onComposed as EventListener);
		return () => window.removeEventListener("studio:composed", onComposed as EventListener);
	}, []);

	// Esc closes the modal — standard modal affordance the user
	// expects but wasn't wired. Cancels installing-in-progress is
	// not graceful, so we ignore Esc while installing.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !installing) onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, installing, onClose]);

	if (!open) return null;

	const askChatToCompose = () => {
		const prompt = intent.trim() || "Build me a workflow that drafts replies to important emails twice a day.";
		// Dispatch through the existing studio:ask event the chat
		// sidebar already listens for. The agent will invoke
		// compose_workflow, stage the draft, and (post-W5) fire
		// 'studio:composed' so we switch to review mode.
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: {
				prompt: `Use compose_workflow to draft a workflow for this intent: "${prompt}". After the tool succeeds, dispatch a window event named "studio:composed" with the draft result so the composer modal can show it.`,
				autosend: true,
			},
		}));
		// Don't close — let the user see the chat run + come back
		// to the composer to install when the draft is ready.
	};

	const installDraft = async () => {
		if (!drafted) return;
		setInstalling(true);
		try {
			// The draft was staged at ~/.tenants/<sub>/.xp/apps/<slug>/.
			// app_install accepts a tenant draft slug to "promote" it
			// into a normal install. The intent-driven install path
			// reuses the existing /me/apps endpoint.
			const r = await me.installApp(drafted.slug, "local");
			toast.success(`Installing ${drafted.slug}…`);
			// Poll the intent briefly; if still pending after 8s, just
			// close — the scheduler will pick it up on the next tick.
			let i = 0;
			while (i < 8) {
				await new Promise((res) => setTimeout(res, 1000));
				try {
					const intent = await me.getIntent(r.intent_id);
					if (intent.status === "completed") {
						toast.success(`Installed — find it in your Workflows.`);
						break;
					}
				} catch { /* ignore */ }
				i++;
			}
			setDrafted(null);
			localStorage.removeItem(LS_DRAFT);
			localStorage.removeItem(LS_INTENT);
			onClose();
		} catch (e) {
			toast.error(`Install failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setInstalling(false);
		}
	};

	const discardDraft = () => {
		setDrafted(null);
		localStorage.removeItem(LS_DRAFT);
	};

	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
			<div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
				<header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
					<div>
						<h2 className="font-semibold text-slate-900">New workflow</h2>
						<p className="text-xs text-slate-500">Tell your AI what to do — or design a DAG visually.</p>
					</div>
					<button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded">
						<X className="w-4 h-4" />
					</button>
				</header>

				<nav className="flex gap-1 px-5 pt-3 border-b border-slate-100">
					<TabButton active={mode === "describe"} onClick={() => setMode("describe")} icon={MessageSquare} label="Describe what you want" />
					<TabButton active={mode === "visual"} onClick={() => setMode("visual")} icon={GitBranch} label="Design visually" />
				</nav>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{drafted ? (
						<DraftedReview
							drafted={drafted}
							installing={installing}
							onInstall={installDraft}
							onDiscard={discardDraft}
						/>
					) : mode === "describe" ? (
						<DescribeForm intent={intent} setIntent={setIntent} onSubmit={askChatToCompose} />
					) : (
						<N8nEditor onClose={onClose} />
					)}
				</div>
			</div>
		</div>
	);
}

function DraftedReview({
	drafted, installing, onInstall, onDiscard,
}: {
	drafted: DraftedState;
	installing: boolean;
	onInstall: () => void;
	onDiscard: () => void;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex items-start gap-2">
				<Check className="w-3.5 h-3.5 mt-0.5" />
				<div>
					<div className="font-medium">Draft ready</div>
					<div className="leading-relaxed">
						Your AI staged a workflow for &ldquo;{drafted.intent}&rdquo;. Review the picked skills below, then install.
					</div>
				</div>
			</div>

			<div className="space-y-1">
				<div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Slug</div>
				<div className="font-mono text-sm text-slate-800">{drafted.slug}</div>
			</div>

			<div className="space-y-2">
				<div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Skills picked ({drafted.skills.length})</div>
				<div className="space-y-1.5">
					{(drafted.skill_summaries || drafted.skills.map((s) => ({ name: s }))).map((s) => (
						<div key={s.name} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
							<div className="font-medium text-slate-900">{s.display_name || s.name}</div>
							{s.summary && <div className="text-xs text-slate-600 mt-0.5">{s.summary}</div>}
							{s.why && <div className="text-xs text-emerald-700 mt-1 italic">&ldquo;{s.why}&rdquo;</div>}
						</div>
					))}
				</div>
			</div>

			<div className="pt-2 flex justify-between">
				<button
					onClick={onDiscard}
					disabled={installing}
					className="text-xs text-slate-500 hover:text-rose-600 transition-colors"
				>
					Discard draft
				</button>
				<button
					onClick={onInstall}
					disabled={installing}
					className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 active:scale-95 transition-all shadow-sm shadow-emerald-200 disabled:opacity-60"
				>
					{installing ? (
						<>
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
							Installing…
						</>
					) : (
						<>
							<Check className="w-3.5 h-3.5" />
							Install this workflow
						</>
					)}
				</button>
			</div>
		</div>
	);
}

function TabButton({
	active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
	return (
		<button
			onClick={onClick}
			className={[
				"px-3 py-2 text-sm rounded-t-lg flex items-center gap-2 border-b-2 -mb-px transition-colors",
				active ? "text-slate-900 border-emerald-500 font-medium" : "text-slate-500 border-transparent hover:text-slate-800",
			].join(" ")}
		>
			<Icon className="w-3.5 h-3.5" />
			{label}
		</button>
	);
}

function TemplateCard({ t, onPick }: { t: typeof TEMPLATES[0]; onPick: () => void }) {
	const Icon = t.icon;
	const accents: Record<string, { bg: string; iconBg: string; iconText: string }> = {
		amber:   { bg: "hover:bg-amber-50/60   hover:border-amber-200",   iconBg: "bg-amber-100",   iconText: "text-amber-700" },
		indigo:  { bg: "hover:bg-indigo-50/60  hover:border-indigo-200",  iconBg: "bg-indigo-100",  iconText: "text-indigo-700" },
		violet:  { bg: "hover:bg-violet-50/60  hover:border-violet-200",  iconBg: "bg-violet-100",  iconText: "text-violet-700" },
		emerald: { bg: "hover:bg-emerald-50/60 hover:border-emerald-200", iconBg: "bg-emerald-100", iconText: "text-emerald-700" },
		sky:     { bg: "hover:bg-sky-50/60     hover:border-sky-200",     iconBg: "bg-sky-100",     iconText: "text-sky-700" },
		rose:    { bg: "hover:bg-rose-50/60    hover:border-rose-200",    iconBg: "bg-rose-100",    iconText: "text-rose-700" },
	};
	const a = accents[t.tone] || accents.emerald;
	return (
		<button
			onClick={onPick}
			className={[
				"text-left p-3 rounded-xl border border-slate-200/70 bg-white transition-all active:scale-[0.98]",
				a.bg,
			].join(" ")}
		>
			<div className={["w-8 h-8 rounded-lg flex items-center justify-center mb-2", a.iconBg, a.iconText].join(" ")}>
				<Icon className="w-4 h-4" />
			</div>
			<div className="text-sm font-semibold text-slate-900">{t.title}</div>
			<div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{t.desc}</div>
		</button>
	);
}

function DescribeForm({ intent, setIntent, onSubmit }: { intent: string; setIntent: (s: string) => void; onSubmit: () => void }) {
	const samples = [
		"Watch my Slack channels every hour and draft replies to anything important.",
		"Track Polymarket BTC price-range events and alert me when a position becomes attractive.",
		"Score consulting case answers I paste in against the MBB framework.",
	];
	const pickTemplate = (t: typeof TEMPLATES[0]) => {
		setIntent(t.intent);
		// Auto-submit after a short delay so the user sees the textarea
		// filled in. Avoids the "did anything happen?" moment.
		setTimeout(onSubmit, 300);
	};
	return (
		<div className="space-y-4">
			{/* Templates grid — most users pick from here. Removes the
			    "blank canvas" problem; one click + you're drafting. */}
			<div>
				<div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Templates</div>
				<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
					{TEMPLATES.map((t) => <TemplateCard key={t.title} t={t} onPick={() => pickTemplate(t)} />)}
				</div>
			</div>

			<div className="relative">
				<div className="absolute inset-0 flex items-center" aria-hidden="true">
					<div className="w-full border-t border-slate-200" />
				</div>
				<div className="relative flex justify-center">
					<span className="px-3 bg-white text-[10px] uppercase tracking-wider text-slate-400">or describe your own</span>
				</div>
			</div>

			<label className="block">
				<textarea
					value={intent}
					onChange={(e) => setIntent(e.target.value)}
					placeholder="In plain English. Be specific about when it should run and what it should produce."
					rows={3}
					className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-4 focus:ring-emerald-400/15 focus:border-emerald-400 resize-y"
				/>
			</label>
			<div className="space-y-1.5">
				<div className="text-xs text-slate-500">Or pick a sample to get started:</div>
				{samples.map((s) => (
					<button
						key={s}
						onClick={() => setIntent(s)}
						className="block w-full text-left px-3 py-1.5 text-xs rounded-lg bg-white border border-slate-200/70 text-slate-600 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-900 transition-colors"
					>
						<span className="opacity-60 mr-1">›</span>
						{s}
					</button>
				))}
			</div>
			<div className="pt-2 flex justify-end">
				<button
					onClick={onSubmit}
					className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 active:scale-95 transition-all shadow-sm shadow-emerald-200"
				>
					<MessageSquare className="w-3.5 h-3.5" />
					Ask AI to draft this workflow
					<ExternalLink className="w-3 h-3 opacity-70" />
				</button>
			</div>
		</div>
	);
}

export default WorkflowComposer;
