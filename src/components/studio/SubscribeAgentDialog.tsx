// "Subscribe" — the kind=agent marketplace action.
//
// Knowledge agents aren't installed — their published memory bank is
// delta-synced into the caller's knowledge graph (subscribe_bank intent →
// xp_subscribe, cursor-based + idempotent). The dialog takes a target local
// agent id (default: the source repo's name), queues the intent, polls the
// result, and links to the knowledge browser on success.

import { useEffect, useState } from "react";
import { Loader2, Check, BookOpen, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { me, waitForIntent } from "@/api/me";
import {
	Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export function SubscribeAgentDialog({
	sourceSlug, agentLabel, open, onClose,
}: {
	sourceSlug: string;  // owner/name of the kind=agent repo
	agentLabel: string;
	open: boolean;
	onClose: () => void;
}) {
	const defaultTarget = sourceSlug.split("/").pop() || "";
	const [target, setTarget] = useState(defaultTarget);
	const [phase, setPhase] = useState<"form" | "working" | "done">("form");
	const [doneNote, setDoneNote] = useState("");

	useEffect(() => {
		if (open) { setPhase("form"); setTarget(defaultTarget); setDoneNote(""); }
	}, [open, defaultTarget]);

	const submit = async () => {
		setPhase("working");
		try {
			const resp = await me.subscribeBank(sourceSlug, target.trim() || undefined);
			const result = await waitForIntent(resp.intent_id, { timeoutMs: 120_000 });
			const data = (result.result ?? {}) as { error?: string; imported?: number; new?: number; pulled?: number };
			if (data.error) throw new Error(data.error);
			const n = data.imported ?? data.new ?? data.pulled;
			setDoneNote(
				typeof n === "number"
					? `Synced ${n} memorie${n === 1 ? "" : "s"} into "${target.trim() || defaultTarget}".`
					: `Subscribed — memories sync into "${target.trim() || defaultTarget}".`,
			);
			setPhase("done");
		} catch (e) {
			toast.error("Subscribe failed: " + (e instanceof Error ? e.message : String(e)));
			setPhase("form");
		}
	};

	const cli = `lumid xp subscribe --target-agent ${target.trim() || defaultTarget} --source-slug ${sourceSlug}`;

	return (
		<Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[15px]">
						<BookOpen className="w-4 h-4 text-pink-500" /> Subscribe to {agentLabel}
					</DialogTitle>
					<DialogDescription className="text-[12.5px]">
						Knowledge agents aren&apos;t installed — their published memories are
						synced into your knowledge graph. Re-subscribing later pulls only
						what&apos;s new.
					</DialogDescription>
				</DialogHeader>

				{phase === "done" ? (
					<div className="space-y-3">
						<div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-800 flex items-center gap-2">
							<Check className="w-4 h-4 flex-shrink-0" /> {doneNote}
						</div>
						<Link
							to="/studio/knowledge"
							onClick={onClose}
							className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-700 hover:underline"
						>
							Open your knowledge <ArrowRight className="w-3.5 h-3.5" />
						</Link>
					</div>
				) : (
					<div className="space-y-3">
						<label className="block">
							<span className="text-[11.5px] text-slate-500 block mb-1">Sync into local agent</span>
							<input
								type="text" value={target} onChange={(e) => setTarget(e.target.value)}
								className="w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-slate-200 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-pink-400/20 focus:border-pink-400"
							/>
							<span className="text-[10.5px] text-slate-400 mt-1 block">
								New id creates a fresh agent; an existing id merges (idempotent).
							</span>
						</label>
						<button
							onClick={submit}
							disabled={phase === "working" || !target.trim()}
							className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50 transition-all"
						>
							{phase === "working" ? <><Loader2 className="w-4 h-4 animate-spin" /> Syncing…</> : <>Subscribe</>}
						</button>
						<details className="text-[11px] text-slate-400">
							<summary className="cursor-pointer select-none hover:text-slate-600">CLI alternative</summary>
							<pre className="mt-1.5 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-[10.5px] text-slate-600 overflow-x-auto">{cli}</pre>
						</details>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

export default SubscribeAgentDialog;
