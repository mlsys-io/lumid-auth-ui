// BranchDialog — branch with intention (WS-5). The "Branch… / Run attempt"
// action opens this small modal so a branch carries a DIRECTIVE instead of an
// empty config:
//   • free-text "what should this attempt explore?" → the trajectory signal's
//     `note` (the proposer reads it as the exploration directive)
//   • optional config overrides (key=value lines) → the run `variant`
//
// It posts the signal (so the note persists + steers the next proposal) and
// launches the run with the variant in one go. Generic — no per-app config
// schema; the user describes intent in words, overrides are advisory.

import { useState } from "react";
import { createPortal } from "react-dom";
import { GitBranch, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import { postTrajectorySignal } from "@/api/trajectory";
import { cn } from "@/lib/utils";

// Parse "key = value" / "key: value" lines into a config override map. Values
// are coerced to number/boolean when they look like one; else kept as string.
function parseOverrides(text: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = line.match(/^([^:=]+)[:=](.*)$/);
		if (!m) continue;
		const k = m[1].trim();
		const v = m[2].trim();
		if (!k) continue;
		if (/^-?\d+(\.\d+)?$/.test(v)) out[k] = Number(v);
		else if (v === "true" || v === "false") out[k] = v === "true";
		else out[k] = v;
	}
	return out;
}

export default function BranchDialog({ app, loop, fromTs, fromLabel, onClose, onLaunched }: {
	app: string;
	loop: string;
	fromTs?: string;       // the run dir-id to branch from (lineage parent)
	fromLabel: string;     // display label for the source run
	onClose: () => void;
	onLaunched?: () => void;
}) {
	const [note, setNote] = useState("");
	const [overridesText, setOverridesText] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		const directive = note.trim();
		if (!directive) { toast.error("Say what this experiment should explore."); return; }
		const variant = parseOverrides(overridesText);
		setBusy(true);
		try {
			// 1) Persist the intention as a trajectory signal so the proposer
			//    reads the note as its exploration directive.
			await postTrajectorySignal(app, {
				loop,
				action: "branch",
				from_id: fromTs,
				note: directive,
				config: Object.keys(variant).length ? variant : undefined,
			});
			// 2) Launch the run as a branch of the source, carrying the variant.
			await me.launchRun(app, loop, {
				from_run_ts: fromTs,
				branch_label: directive.slice(0, 48),
				variant: Object.keys(variant).length ? variant : undefined,
			});
			toast.success("Experiment queued — exploring your direction.");
			onLaunched?.();
			onClose();
		} catch (e) {
			if (e instanceof MeApiError && (e.status === 404 || e.status === 501)) {
				toast("Runtime coming — branching isn't wired on the backend yet.");
			} else {
				toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
			}
		} finally { setBusy(false); }
	};

	return createPortal(
		<div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/30 backdrop-blur-sm animate-in fade-in duration-150"
			onClick={onClose}>
			<div className="w-[460px] max-w-[92vw] rounded-xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-150"
				onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
					<GitBranch className="w-4 h-4 text-gold-600" />
					<div className="text-sm font-semibold text-slate-900">New attempt</div>
					<span className="text-[11px] text-slate-400 truncate">from {fromLabel}</span>
					<button onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
				</div>
				<div className="p-4 space-y-3">
					<div>
						<label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What should this attempt explore?</label>
						<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
							placeholder="e.g. weight recent earnings more heavily; try a stricter judge rubric…"
							onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
							className="mt-1 w-full text-[13px] text-slate-800 leading-snug rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300 resize-none" />
						<div className="mt-0.5 text-[10px] text-slate-400">The agent reads this as its direction for the next attempt.</div>
					</div>
					<details>
						<summary className="text-[11px] font-medium text-slate-500 cursor-pointer hover:text-slate-700">Config overrides (optional)</summary>
						<textarea value={overridesText} onChange={(e) => setOverridesText(e.target.value)} rows={3}
							placeholder={"one per line, e.g.\ntemperature = 0.3\nmax_candidates = 5"}
							className="mt-1.5 w-full font-mono text-[12px] text-slate-800 leading-snug rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300 resize-none" />
						<div className="mt-0.5 text-[10px] text-slate-400">Becomes the attempt's variant. Numbers / true / false are coerced.</div>
					</details>
				</div>
				<div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100">
					<button onClick={submit} disabled={busy}
						className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50")}>
						{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />} Run attempt
					</button>
					<button onClick={onClose} disabled={busy}
						className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">Cancel</button>
					<span className="ml-auto text-[10px] text-slate-400 hidden sm:inline">⌘↵ to run</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}
