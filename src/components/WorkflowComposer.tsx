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

import { useState } from "react";
import { X, MessageSquare, GitBranch, ExternalLink } from "lucide-react";
import N8nEditor from "@/components/N8nEditor";

type Mode = "describe" | "visual";

interface Props {
	open: boolean;
	onClose: () => void;
}

export function WorkflowComposer({ open, onClose }: Props) {
	const [mode, setMode] = useState<Mode>("describe");
	const [intent, setIntent] = useState("");

	if (!open) return null;

	const askChatToCompose = () => {
		const prompt = intent.trim() || "Build me a workflow that drafts replies to important emails twice a day.";
		// Dispatch through the existing studio:ask event the chat
		// sidebar already listens for (W6 pattern). The agent will
		// invoke compose_workflow, stage the draft, and reply with
		// a review link.
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: {
				prompt: `Use compose_workflow to draft a workflow for this intent: "${prompt}"`,
				autosend: true,
			},
		}));
		onClose();
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
					{mode === "describe" ? (
						<DescribeForm intent={intent} setIntent={setIntent} onSubmit={askChatToCompose} />
					) : (
						<N8nEditor onClose={onClose} />
					)}
				</div>
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

function DescribeForm({ intent, setIntent, onSubmit }: { intent: string; setIntent: (s: string) => void; onSubmit: () => void }) {
	const samples = [
		"Watch my Slack channels every hour and draft replies to anything important.",
		"Summarize my unread emails into a morning brief at 8am.",
		"Track Polymarket BTC price-range events and alert me when a position becomes attractive.",
		"Score consulting case answers I paste in against the MBB framework.",
	];
	return (
		<div className="space-y-3">
			<label className="block">
				<div className="text-sm font-medium text-slate-800 mb-1.5">What should the workflow do?</div>
				<textarea
					value={intent}
					onChange={(e) => setIntent(e.target.value)}
					placeholder="In plain English. Be specific about when it should run and what it should produce."
					rows={4}
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
