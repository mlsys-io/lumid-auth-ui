// /studio/workflows/:slug — per-workflow detail (W1).
//
// Three Airflow-style tabs:
//   Graph       — DAG of steps (xyflow) with skill labels.
//   Runs        — Airflow grid (rows = steps, columns = last 30 runs).
//   Definition  — raw YAML/JSON, read-only, with "Open editor" button
//                 (YAML editor for scheduled / n8n iframe for visual; W2).

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ReactFlow, Background, Controls, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Workflow as WorkflowIcon, ArrowLeft, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError, type MeRunRow } from "@/api/me";
import AirflowGrid, { type GridCell, type GridState } from "@/components/AirflowGrid";
import PageHints from "@/components/PageHints";
import { setStudioSelection } from "@/components/StudioContext";

type Tab = "graph" | "runs" | "definition";

export default function StudioWorkflowDetail() {
	const { slug = "" } = useParams<{ slug: string }>();
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

	const load = async () => {
		try {
			const [detail, runsResp, list] = await Promise.all([
				me.workflowDetail(slug),
				me.listRuns({ workflow: slug, limit: 30 }),
				me.listWorkflows(),
			]);
			setDefinition(detail.definition);
			setRuns(runsResp.runs);
			const row = list.workflows.find((w) => w.slug === slug);
			if (row) setEnabled(row.enabled);
		} catch (e) {
			setErr(e instanceof MeApiError ? e.message : String(e));
		}
	};
	useEffect(() => { load(); }, [slug]);

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
			setTimeout(load, 1500);
		} catch (e) {
			toast.error(e instanceof MeApiError ? e.message : String(e));
		}
	};

	if (err) {
		return (
			<div className="space-y-4">
				<BackLink />
				<div className="text-rose-700 text-sm">{err}</div>
			</div>
		);
	}

	const stepNames = extractStepNames(definition);

	return (
		<div className="space-y-4">
			<BackLink />

			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-semibold flex items-center gap-2">
						<WorkflowIcon className="w-5 h-5 text-emerald-600" />
						{loopName}
						<span className="text-xs text-slate-400 font-normal">/ {app || "n8n"}</span>
					</h1>
					<p className="text-sm text-slate-500 mt-0.5">{slug}</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={runNow}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
					>
						<Play className="w-3.5 h-3.5" /> Run now
					</button>
					<button
						onClick={togglePause}
						disabled={enabled === null}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
					>
						<Pause className="w-3.5 h-3.5" />
						{enabled === false ? "Resume" : "Pause"}
					</button>
				</div>
			</header>

			<PageHints prompts={[
				`run ${loopName} now`,
				`show the last 5 runs of ${loopName}`,
				`why did ${loopName} fail?`,
			]} />

			<nav className="flex items-center gap-1 border-b border-slate-200 pb-px">
				<TabButton active={tab === "graph"}      onClick={() => setTab("graph")}      label="Graph" />
				<TabButton active={tab === "runs"}       onClick={() => setTab("runs")}       label={`Runs (${runs?.length ?? 0})`} />
				<TabButton active={tab === "definition"} onClick={() => setTab("definition")} label="Definition" />
			</nav>

			{tab === "graph" && (
				<GraphView stepNames={stepNames} definition={definition} />
			)}
			{tab === "runs" && (
				<RunsGridView slug={slug} runs={runs} stepNames={stepNames} onCellClick={(runId) => navigate(`/studio/runs/${encodeURIComponent(runId)}`)} />
			)}
			{tab === "definition" && (
				<DefinitionView definition={definition} />
			)}
		</div>
	);
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
	return (
		<button
			onClick={onClick}
			className={[
				"px-3 py-1.5 text-sm border-b-2 transition-colors -mb-px",
				active
					? "text-slate-900 border-emerald-500 font-medium"
					: "text-slate-500 border-transparent hover:text-slate-800",
			].join(" ")}
		>
			{label}
		</button>
	);
}

function BackLink() {
	return (
		<Link
			to="/studio/workflows"
			className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 gap-1"
		>
			<ArrowLeft className="w-3.5 h-3.5" />
			Workflows
		</Link>
	);
}

// extractStepNames — pulls step labels from either an xpio definition
// (`steps[].id`/`skill` or top-level `skills[]`) or an n8n workflow
// (`nodes[].name`). Best-effort; falls back to a single "run" node.
function extractStepNames(def: any): string[] {
	if (!def || typeof def !== "object") return ["run"];
	// scheduled
	if (Array.isArray(def.steps) && def.steps.length > 0) {
		return def.steps.map((s: any, i: number) => s.id || s.skill || `step ${i + 1}`);
	}
	if (Array.isArray(def.skills) && def.skills.length > 0) {
		return def.skills.map((s: any) => String(s));
	}
	// visual (n8n)
	if (Array.isArray(def.nodes)) {
		return def.nodes
			.filter((n: any) => !String(n.type || "").includes("trigger"))
			.map((n: any) => n.name || n.id);
	}
	return ["run"];
}

function GraphView({ stepNames, definition }: { stepNames: string[]; definition: any }) {
	// Simple horizontal flow: one node per step, left → right.
	// xpcloud's 5-stage flow (observe → hypothesize → act → analyze →
	// learn) lays out the same way; the runtime enforces sequential
	// execution, and the layout hint is honored visually.
	const nodes = useMemo(
		() => stepNames.map((s, i) => ({
			id: `s-${i}`,
			position: { x: i * 220, y: 0 },
			data: { label: s },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			style: {
				background: "white",
				border: "1px solid rgb(203 213 225)",
				borderRadius: 12,
				padding: "10px 14px",
				fontSize: 12,
				fontWeight: 500,
				boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
				minWidth: 180,
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
		<div className="h-[420px] rounded-xl border border-slate-200 bg-white">
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

	// Newest on the right (matches Airflow's grid view).
	const ordered = [...runs].sort((a, b) => a.started_at - b.started_at);

	// Build cells: row = step name, col = run id. v1 — since per-step
	// state isn't yet surfaced through the aggregator, we propagate the
	// run-level state across all step rows. Future: read step_log.json
	// in /me/runs/<id> and color per-step independently.
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
				Showing last {ordered.length} runs · oldest left, newest right · click a cell to drill in.
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
			<p className="text-xs text-slate-500">
				Read-only view. The YAML editor + n8n iframe editor land in W2.
			</p>
			<pre className="rounded-xl border border-slate-200 bg-slate-900 text-slate-100 px-4 py-3 text-[12px] leading-relaxed overflow-x-auto">
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
