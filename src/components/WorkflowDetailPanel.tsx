// WorkflowDetailPanel — inline (right-side master-detail) view of a
// single workflow. Used on /studio/workflows when `?selected=<slug>`
// is set. The standalone /studio/workflows/:slug route redirects here
// so the user keeps their list context (and the chat sidebar) while
// drilling in.
//
// Three Airflow-style tabs: Graph · Runs · Definition. Lifted verbatim
// from the prior workflow-detail.tsx page; the only difference is the
// header carries a close button instead of a Back breadcrumb.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReactFlow, Background, Controls, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Workflow as WorkflowIcon, Play, Pause, X } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError, type MeRunRow } from "@/api/me";
import AirflowGrid, { type GridCell, type GridState } from "@/components/AirflowGrid";
import { setStudioSelection } from "@/components/StudioContext";

type Tab = "graph" | "runs" | "definition";

export default function WorkflowDetailPanel({
	slug,
	onClose,
}: {
	slug: string;
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const [tab, setTab] = useState<Tab>("graph");
	const [definition, setDefinition] = useState<any>(null);
	const [runs, setRuns] = useState<MeRunRow[] | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [enabled, setEnabled] = useState<boolean | null>(null);

	const parts = slug.split(":");
	const isScheduled = parts[0] !== "n8n";
	const app = isScheduled ? parts[0] : undefined;
	const loopName = isScheduled ? parts.slice(1).join(":") : slug;

	useEffect(() => {
		setStudioSelection({
			kind: "workflow",
			id: slug,
			label: slug,
			affordances: ["run_workflow_now", "pause_workflow", "workflow_detail"],
		});
		return () => setStudioSelection(null);
	}, [slug]);

	// Esc closes the panel — natural pair to the × button.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	useEffect(() => {
		// Reset state when slug changes (the user clicked a different row
		// while the panel was already open).
		setDefinition(null);
		setRuns(null);
		setErr(null);
		setTab("graph");

		let stale = false;
		(async () => {
			try {
				const [detail, runsResp, list] = await Promise.all([
					me.workflowDetail(slug),
					me.listRuns({ workflow: slug, limit: 30 }),
					me.listWorkflows(),
				]);
				if (stale) return;
				setDefinition(detail.definition);
				setRuns(runsResp.runs);
				const row = list.workflows.find((w) => w.slug === slug);
				if (row) setEnabled(row.enabled);
			} catch (e) {
				if (!stale) setErr(e instanceof MeApiError ? e.message : String(e));
			}
		})();
		return () => { stale = true; };
	}, [slug]);

	const togglePause = async () => {
		if (!isScheduled || !app) return;
		try {
			await me.patchLoop(app, loopName, { enabled: !enabled });
			setEnabled((v) => (v === null ? null : !v));
			toast.success(enabled ? "Paused" : "Resumed");
		} catch (e) {
			toast.error(e instanceof MeApiError ? e.message : String(e));
		}
	};

	const runNow = async () => {
		if (!isScheduled || !app) {
			toast.info("Run-now for visual workflows lands in W2.");
			return;
		}
		try {
			await me.runLoopNow(app, loopName);
			toast.success("Cycle queued");
			// Reload runs after a beat.
			setTimeout(async () => {
				try {
					const runsResp = await me.listRuns({ workflow: slug, limit: 30 });
					setRuns(runsResp.runs);
				} catch { /* ignore */ }
			}, 1500);
		} catch (e) {
			toast.error(e instanceof MeApiError ? e.message : String(e));
		}
	};

	const stepNames = extractStepNames(definition);

	return (
		<aside
			data-testid="workflow-detail-panel"
			className="xl:sticky xl:top-20 self-start rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col max-h-[calc(100vh-7rem)] overflow-hidden"
		>
			<header className="px-4 pt-3.5 pb-3 border-b border-slate-100 flex-shrink-0">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="text-[15px] font-semibold flex items-center gap-2 truncate">
							<WorkflowIcon className="w-4 h-4 text-emerald-600 flex-shrink-0" />
							<span className="truncate">{loopName}</span>
							<span className="text-xs text-slate-400 font-normal truncate">/ {app || "n8n"}</span>
						</h2>
						<p className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">{slug}</p>
					</div>
					<button
						onClick={onClose}
						title="Close (Esc)"
						className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="flex items-center gap-2 mt-3">
					<button
						onClick={runNow}
						className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all"
					>
						<Play className="w-3 h-3" /> Run now
					</button>
					<button
						onClick={togglePause}
						disabled={enabled === null}
						className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
					>
						<Pause className="w-3 h-3" />
						{enabled === false ? "Resume" : "Pause"}
					</button>
				</div>

				<nav className="flex items-center gap-1 border-b border-slate-200 pb-px mt-3 -mx-4 px-4">
					<TabButton active={tab === "graph"}      onClick={() => setTab("graph")}      label="Graph" />
					<TabButton active={tab === "runs"}       onClick={() => setTab("runs")}       label={`Runs (${runs?.length ?? 0})`} />
					<TabButton active={tab === "definition"} onClick={() => setTab("definition")} label="Definition" />
				</nav>
			</header>

			<div className="flex-1 overflow-y-auto p-4">
				{err && <div className="text-rose-700 text-sm">{err}</div>}
				{!err && tab === "graph" && (
					<GraphView stepNames={stepNames} definition={definition} />
				)}
				{!err && tab === "runs" && (
					<RunsGridView
						slug={slug}
						runs={runs}
						stepNames={stepNames}
						onCellClick={(runId) => navigate(`/studio/runs/${encodeURIComponent(runId)}`)}
					/>
				)}
				{!err && tab === "definition" && (
					<DefinitionView definition={definition} />
				)}
			</div>
		</aside>
	);
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
	return (
		<button
			onClick={onClick}
			className={[
				"px-2.5 py-1.5 text-xs border-b-2 transition-colors -mb-px",
				active
					? "text-slate-900 border-emerald-500 font-medium"
					: "text-slate-500 border-transparent hover:text-slate-800",
			].join(" ")}
		>
			{label}
		</button>
	);
}

// extractStepNames — pulls step labels from either an xpio definition
// (`steps[].id`/`skill` or top-level `skills[]`) or an n8n workflow
// (`nodes[].name`). Best-effort; falls back to a single "run" node.
function extractStepNames(def: any): string[] {
	if (!def || typeof def !== "object") return ["run"];
	if (Array.isArray(def.steps) && def.steps.length > 0) {
		return def.steps.map((s: any, i: number) => s.id || s.skill || `step ${i + 1}`);
	}
	if (Array.isArray(def.skills) && def.skills.length > 0) {
		return def.skills.map((s: any) => String(s));
	}
	if (Array.isArray(def.nodes)) {
		return def.nodes
			.filter((n: any) => !String(n.type || "").includes("trigger"))
			.map((n: any) => n.name || n.id);
	}
	return ["run"];
}

function GraphView({ stepNames, definition }: { stepNames: string[]; definition: any }) {
	const nodes = useMemo(
		() => stepNames.map((s, i) => ({
			id: `s-${i}`,
			position: { x: i * 200, y: 0 },
			data: { label: s },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			style: {
				background: "white",
				border: "1px solid rgb(203 213 225)",
				borderRadius: 10,
				padding: "8px 12px",
				fontSize: 11,
				fontWeight: 500,
				boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
				minWidth: 160,
			},
		})),
		[stepNames],
	);
	const edges = useMemo(
		() => stepNames.slice(1).map((_, i) => ({
			id: `e-${i}`,
			source: `s-${i}`,
			target: `s-${i + 1}`,
			animated: false,
			style: { stroke: "rgb(148 163 184)" },
		})),
		[stepNames],
	);

	return (
		<div className="h-[340px] rounded-xl border border-slate-200 bg-white">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				fitView
				fitViewOptions={{ padding: 0.2 }}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable
			>
				<Background gap={16} color="rgb(226 232 240)" />
				<Controls showInteractive={false} />
			</ReactFlow>
			{!definition && (
				<div className="text-xs text-slate-400 px-3 py-2">Loading definition…</div>
			)}
		</div>
	);
}

function RunsGridView({
	slug,
	runs,
	stepNames,
	onCellClick,
}: {
	slug: string;
	runs: MeRunRow[] | null;
	stepNames: string[];
	onCellClick?: (runId: string, _step: string) => void;
}) {
	if (runs === null) return <div className="text-sm text-slate-500 italic">Loading…</div>;

	const ordered = [...runs].sort((a, b) => a.started_at - b.started_at);
	const columns = ordered.map((r) => r.started_iso || String(r.started_at));
	const colToRun: Record<string, MeRunRow> = {};
	ordered.forEach((r, i) => { colToRun[columns[i]] = r; });

	const cells: Record<string, Record<string, GridCell>> = {};
	for (const step of stepNames) {
		cells[step] = {};
		for (const col of columns) {
			const r = colToRun[col];
			if (!r) continue;
			cells[step][col] = {
				state: mapState(r.state),
				tooltip: `${step} · ${r.started_iso || "?"} · ${r.state}${r.duration_s ? ` · ${r.duration_s.toFixed(1)}s` : ""}${r.reason ? ` · ${r.reason}` : ""}`,
			};
		}
	}

	return (
		<div className="space-y-3">
			<AirflowGrid
				rows={stepNames}
				columns={columns}
				cells={cells}
				onCellClick={(_row, col) => {
					const r = colToRun[col];
					if (r && onCellClick) onCellClick(r.run_id, _row);
				}}
				emptyText="No runs yet for this workflow."
			/>
			<p className="text-xs text-slate-500">
				Last {ordered.length} runs · oldest left · click a cell to drill in.
			</p>
			{slug.startsWith("n8n:") && (
				<p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
					Per-step states for n8n runs land in W4 (today the grid colors every row by run-level state).
				</p>
			)}
		</div>
	);
}

function DefinitionView({ definition }: { definition: any }) {
	if (definition === null) return <div className="text-sm text-slate-500 italic">Loading…</div>;
	return (
		<div className="space-y-2">
			<pre className="rounded-xl border border-slate-200 bg-slate-900 text-slate-100 px-3 py-2.5 text-[11px] leading-relaxed overflow-x-auto">
				{JSON.stringify(definition, null, 2)}
			</pre>
		</div>
	);
}

function mapState(s: string): GridState {
	switch (s) {
		case "succeeded": return "succeeded";
		case "failed":    return "failed";
		case "running":   return "running";
		case "skipped":   return "skipped";
		case "canceled":  return "canceled";
		default:          return "empty";
	}
}
