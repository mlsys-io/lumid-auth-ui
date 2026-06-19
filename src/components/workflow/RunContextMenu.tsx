// RunContextMenu — #17. The right-click control menu for a run/branch node (in
// the lineage tree) OR a casebook case row. One menu, two target kinds.
//
// Items (8):
//   • branch out          — RUNTIME (me.launchRun: from_run_ts + branch_label)
//   • compare with…       — wired: toggles this run into the parent's 2-run compare
//   • re-run from here     — RUNTIME (me.launchRun: from_run_ts)
//   • run variant          — RUNTIME (me.launchRun: from_run_ts + variant)
//   • view data           — wired: parent opens CaseContentViewer / run data
//   • view trajectory log  — wired: parent opens TrajectoryLogView at this ts
//   • explain score        — wired: parent opens the provenance view
//   • pin / annotate       — wired: parent's annotate hook (chat-grounded)
//   • promote / discard     — RUNTIME (me.promoteRun / me.discardRun)
//
// RUNTIME items render even when the backend isn't ready: a 404/501 (MeApiError)
// is caught and shown as a "runtime coming" toast, and the item is visually
// marked pending after a failed attempt — it never crashes the menu.

import { useState } from "react";
import {
	GitBranch, GitCompare, RefreshCw, FlaskConical, FileJson, MessageSquare,
	Info, Pin, ArrowUpCircle, XCircle, Loader2, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";

// What the menu was opened on. A run node has a ts; a case row has caseId/label
// (case targets hide the run-only runtime ops).
export interface RunMenuTarget {
	kind: "run" | "case";
	ts?: string;          // run dir-id (run targets)
	caseId?: string;      // case id (case targets)
	label: string;        // display label for the header
}

// Callbacks the host wires to its existing focus states / chat bus. All optional
// — an item hides if its callback is absent (so the same menu works on surfaces
// that can't service every action).
export interface RunMenuActions {
	focusRun?: (ts: string) => void;            // plain focus (also onNodeClick)
	viewData?: (t: RunMenuTarget) => void;      // → CaseContentViewer / run data
	viewLog?: (ts?: string) => void;            // → TrajectoryLogView
	explainScore?: (t: RunMenuTarget) => void;  // → provenance / CaseContentViewer
	annotate?: (t: RunMenuTarget) => void;      // pin/annotate (chat-grounded)
	// runtime op context (the app/loop the menu acts within)
	app: string;
	loop: string;
}

type RowProps = {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	onClick: () => void;
	tone?: "default" | "gold" | "sky" | "danger";
	pending?: boolean;
	busy?: boolean;
};
function Row({ icon: Icon, label, onClick, tone = "default", pending, busy }: RowProps) {
	const toneCls =
		tone === "gold" ? "text-gold-700 hover:bg-gold-50"
			: tone === "sky" ? "text-sky-700 hover:bg-sky-50"
				: tone === "danger" ? "text-rose-600 hover:bg-rose-50"
					: "text-slate-700 hover:bg-slate-50";
	return (
		<button
			onClick={onClick}
			disabled={busy}
			className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-60 ${toneCls}`}
		>
			{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />}
			<span className="flex-1">{label}</span>
			{pending && <Clock className="w-3 h-3 text-slate-300 flex-shrink-0" />}
		</button>
	);
}

export default function RunContextMenu({
	x, y, target, actions, selectedForCompare, onToggleCompare, onClose, onAfterRuntimeOp,
}: {
	x: number; y: number;
	target: RunMenuTarget;
	actions: RunMenuActions;
	selectedForCompare: string[];
	onToggleCompare: (ts: string) => void;
	onClose: () => void;
	onAfterRuntimeOp?: () => void;
}) {
	// Per-item pending flag — set when a runtime op 404/501s so the item shows it
	// won't work yet. Keyed by op name.
	const [pending, setPending] = useState<Record<string, boolean>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const isRun = target.kind === "run" && !!target.ts;

	// Run a runtime op; on a not-ready backend, toast + mark pending (no crash).
	const runtimeOp = async (name: string, fn: () => Promise<unknown>, okMsg: string) => {
		setBusy(name);
		try {
			await fn();
			toast.success(okMsg);
			onAfterRuntimeOp?.();
			onClose();
		} catch (e) {
			if (e instanceof MeApiError && (e.status === 404 || e.status === 501)) {
				setPending((p) => ({ ...p, [name]: true }));
				toast("Runtime coming — this action isn't wired on the backend yet.");
			} else {
				toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
			}
		} finally { setBusy(null); }
	};

	const wired = (fn?: () => void) => () => { fn?.(); onClose(); };

	return (
		<div
			className="fixed z-[80] min-w-[208px] rounded-lg border border-slate-200 bg-white shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
			style={{ left: x, top: y }}
			onClick={(e) => e.stopPropagation()}
		>
			<div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400 truncate">{target.label}</div>

			{/* RUNTIME — branch out (run targets only) */}
			{isRun && (
				<Row icon={GitBranch} label="Branch out" tone="gold" busy={busy === "branch"} pending={pending["branch"]}
					onClick={() => runtimeOp("branch", () => me.launchRun(actions.app, actions.loop, { from_run_ts: target.ts, branch_label: `branch of ${target.label}` }), "Branch queued — exploring from here.")} />
			)}

			{/* WIRED — compare with… (run targets only) */}
			{isRun && (
				<Row icon={GitCompare} tone="sky"
					label={selectedForCompare.includes(target.ts!) ? "Remove from compare" : selectedForCompare.length >= 2 ? "Compare with… (replaces oldest)" : "Compare with…"}
					onClick={() => { onToggleCompare(target.ts!); onClose(); }} />
			)}

			{/* RUNTIME — re-run from here + run variant (run targets only) */}
			{isRun && (
				<Row icon={RefreshCw} label="Re-run from here" busy={busy === "rerun"} pending={pending["rerun"]}
					onClick={() => runtimeOp("rerun", () => me.launchRun(actions.app, actions.loop, { from_run_ts: target.ts }), "Re-running from this point…")} />
			)}
			{isRun && (
				<Row icon={FlaskConical} label="Run variant…" busy={busy === "variant"} pending={pending["variant"]}
					onClick={() => {
						// A variant needs a config override; keep it generic — let the user
						// describe it in chat, which composes the variant. If annotate/chat
						// isn't wired, fall through to a no-op variant launch so the runtime
						// contract is still exercised.
						if (actions.annotate) { actions.annotate({ ...target }); onClose(); return; }
						runtimeOp("variant", () => me.launchRun(actions.app, actions.loop, { from_run_ts: target.ts, variant: {} }), "Variant queued…");
					}} />
			)}

			<div className="my-1 border-t border-slate-100" />

			{/* WIRED — inspection */}
			{actions.viewData && (
				<Row icon={FileJson} label="View data" onClick={wired(() => actions.viewData!(target))} />
			)}
			{isRun && actions.viewLog && (
				<Row icon={MessageSquare} label="View trajectory log" onClick={wired(() => actions.viewLog!(target.ts))} />
			)}
			{actions.explainScore && (
				<Row icon={Info} label="Explain score" onClick={wired(() => actions.explainScore!(target))} />
			)}
			{actions.annotate && (
				<Row icon={Pin} label="Pin / annotate" onClick={wired(() => actions.annotate!(target))} />
			)}

			{/* RUNTIME — promote / discard (run targets only) */}
			{isRun && (
				<>
					<div className="my-1 border-t border-slate-100" />
					<Row icon={ArrowUpCircle} label="Promote" tone="gold" busy={busy === "promote"} pending={pending["promote"]}
						onClick={() => runtimeOp("promote", () => me.promoteRun(actions.app, target.ts!), "Promoted — kept this branch's learning.")} />
					<Row icon={XCircle} label="Discard" tone="danger" busy={busy === "discard"} pending={pending["discard"]}
						onClick={() => runtimeOp("discard", () => me.discardRun(actions.app, target.ts!), "Discarded — dropped this branch's learning.")} />
				</>
			)}
		</div>
	);
}
