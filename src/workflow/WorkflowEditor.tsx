// WorkflowEditor — one editor, whichever dialect the document turns out to be.
//
// The dialect is decided by the BYTES, never by a column beside them. The Java
// backend stores every workflow as an opaque `definition_json` LONGTEXT it
// never parses, which is what lets several formats share one table with no
// schema change — and is exactly why a `format` column would be a liability:
// it can drift from the content, and then two clients disagree about what a
// row holds. See detect.ts.
//
// Per-dialect behaviour lives behind a small table (`ADAPTERS`) rather than
// branching through the component: parse, edit, capabilities, registry and
// palette. Adding a dialect is a row, not a rewrite.
//
// One shape decision worth stating: a FlowMesh single-task document is NOT a
// graph — thirteen of the fifteen kinds are one task — so the canvas steps
// aside and the spec form gets the room, with the graph reduced to a header
// strip. Drawing one box with two stubs as though it were a DAG is a canvas
// performing rather than working.

import { useCallback, useMemo, useRef, useState } from "react";
import { Code2, LayoutGrid, Plus, Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import WorkflowCanvas from "./WorkflowCanvas";
import { NodeInspector } from "./inspector/NodeInspector";
import { WorkflowDoc } from "./doc";
import { detectFormat } from "./detect";
import { parseLumilake, LUMILAKE_CAPABILITIES, LUMILAKE_OPS, type HaloPlan } from "./adapters/lumilake";
import { applyLumilakeEdit } from "./adapters/lumilake.edit";
import { parseFlowMesh, isFormFirst, FLOWMESH_CAPABILITIES, FLOWMESH_KINDS } from "./adapters/flowmesh";
import { applyFlowMeshEdit } from "./adapters/flowmesh.edit";
import { parseXpio, XPIO_CAPABILITIES } from "./adapters/xpio";
import { applyXpioEdit } from "./adapters/xpio.edit";
import { LUMILAKE_REGISTRY } from "./registry/lumilake";
import { FLOWMESH_REGISTRY } from "./registry/flowmesh";
import { XPIO_REGISTRY } from "./registry/xpio";
import type { NodeRegistry } from "./registry/types";
import type { WfCapabilities, WfEdit, WfEditResult, WfNodeKind, WfOverlay, WorkflowGraph } from "./model";
import { emptyGraph } from "./model";

interface Adapter {
	label: string;
	parse: (text: string, plan?: HaloPlan) => WorkflowGraph;
	apply: (doc: WorkflowDoc, graph: WorkflowGraph, edit: WfEdit) => WfEditResult;
	capabilities: WfCapabilities;
	registry: NodeRegistry;
	/** What the Add menu offers, and how a palette entry becomes a node kind. */
	palette: readonly string[];
	kindOf: (paletteEntry: string) => WfNodeKind;
	labelOf: (paletteEntry: string) => string;
	summaryOf: (paletteEntry: string) => string;
}

const ADAPTERS: Partial<Record<string, Adapter>> = {
	lumilake: {
		label: "Lumilake",
		parse: parseLumilake,
		apply: applyLumilakeEdit,
		capabilities: LUMILAKE_CAPABILITIES,
		registry: LUMILAKE_REGISTRY,
		palette: LUMILAKE_OPS,
		kindOf: (op) => ({ family: "lumilake-op", op }),
		labelOf: (op) => LUMILAKE_REGISTRY[op]?.label ?? op,
		summaryOf: (op) => LUMILAKE_REGISTRY[op]?.summary ?? op,
	},
	flowmesh: {
		label: "FlowMesh",
		parse: (text) => parseFlowMesh(text),
		apply: applyFlowMeshEdit,
		capabilities: FLOWMESH_CAPABILITIES,
		registry: FLOWMESH_REGISTRY,
		palette: FLOWMESH_KINDS,
		kindOf: (kind) => ({ family: "flowmesh-task", taskType: kind }),
		labelOf: (kind) => FLOWMESH_REGISTRY[kind]?.label ?? kind,
		summaryOf: (kind) => FLOWMESH_REGISTRY[kind]?.summary ?? kind,
	},
	xpio: {
		label: "xpio loop",
		parse: (text) => parseXpio(text),
		apply: applyXpioEdit,
		capabilities: XPIO_CAPABILITIES,
		registry: XPIO_REGISTRY,
		// One entry, because a loop has one kind of thing you add: a step.
		palette: ["step"],
		kindOf: () => ({ family: "xpio-step", stage: "observe" }),
		labelOf: () => "Step",
		summaryOf: () => "One skill call, appended to steps[].",
	},
};

interface Props {
	value: string;
	onChange?: (text: string) => void;
	plan?: HaloPlan;
	overlay?: WfOverlay;
	readOnly?: boolean;
	height?: number | string;
	resourceOptions?: Partial<Record<string, string[]>>;
}

export default function WorkflowEditor({
	value, onChange, plan, overlay, readOnly, height = "100%", resourceOptions,
}: Props) {
	const docRef = useRef<WorkflowDoc>(WorkflowDoc.parse(value));
	const [text, setText] = useState(value);
	const [selected, setSelected] = useState<string | null>(null);
	const [showYaml, setShowYaml] = useState(false);
	const [, forceRender] = useState(0);

	const doc = docRef.current;
	const locked = !doc.editable;
	const editable = !readOnly && !locked;

	const detected = useMemo(() => detectFormat(text), [text]);
	const adapter = ADAPTERS[detected.format];

	const graph = useMemo(
		() => (adapter ? adapter.parse(text, plan) : emptyGraph("lumilake")),
		[adapter, text, plan],
	);
	const selectedNode = selected ? graph.nodes.find((n) => n.id === selected) : undefined;
	// A single FlowMesh task: the form is the product, the graph is a garnish.
	const formFirst = isFormFirst(graph);

	const sync = useCallback(() => {
		const next = docRef.current.toString();
		setText(next);
		onChange?.(next);
		forceRender((n) => n + 1);
	}, [onChange]);

	const runEdit = useCallback((edit: WfEdit) => {
		if (!adapter) return;
		const r = adapter.apply(docRef.current, graph, edit);
		if (!r.ok) {
			// A refusal is information: the adapter is saying what this dialect's
			// contract does not permit.
			toast.info(r.reason);
			return;
		}
		sync();
		if (edit.t === "removeNode" && selected === edit.id) setSelected(null);
		if (edit.t === "renameNode") setSelected(edit.to);
	}, [adapter, graph, selected, sync]);

	// Selecting a node in form-first mode is implicit: there is only one.
	const inspected = selectedNode ?? (formFirst ? graph.nodes.find((n) => !n.synthetic) : undefined);

	if (!adapter) {
		return (
			<UnknownDialect
				text={text}
				why={detected.why}
				readOnly={!editable}
				onChange={(t) => { docRef.current = WorkflowDoc.parse(t); setText(t); onChange?.(t); }}
				height={height}
			/>
		);
	}

	const btn = "flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent";
	const errorCount = graph.diagnostics.filter((d) => d.level === "error").length;

	return (
		<div className="flex h-full min-h-0 flex-col" style={{ height }}>
			<div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
				<AddMenu
					disabled={!editable}
					adapter={adapter}
					onPick={(entry) => runEdit({
						t: "addNode",
						id: "",
						kind: adapter.kindOf(entry),
						after: selected ?? graph.nodes.filter((n) => !n.synthetic).slice(-1)[0]?.id,
					})}
				/>
				<span className="mx-1 h-4 w-px bg-slate-200" />
				<button type="button" className={btn} disabled={!doc.canUndo} onClick={() => { doc.undo(); sync(); }} title="Undo">
					<Undo2 size={13} /> Undo
				</button>
				<button type="button" className={btn} disabled={!doc.canRedo} onClick={() => { doc.redo(); sync(); }} title="Redo">
					<Redo2 size={13} /> Redo
				</button>
				<span className="mx-1 h-4 w-px bg-slate-200" />
				<button type="button" className={btn} onClick={() => setShowYaml((v) => !v)} title="Toggle the YAML pane">
					{showYaml ? <LayoutGrid size={13} /> : <Code2 size={13} />} {showYaml ? "Canvas" : "YAML"}
				</button>
				<div className="ml-auto flex items-center gap-2 text-[10px] text-slate-400">
					<span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500" title={detected.why}>
						{adapter.label}
					</span>
					{errorCount > 0 && <span className="text-rose-600">{errorCount} problem{errorCount === 1 ? "" : "s"}</span>}
					<span>{graph.nodes.filter((n) => !n.synthetic).length} node{graph.nodes.filter((n) => !n.synthetic).length === 1 ? "" : "s"}</span>
				</div>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="flex min-w-0 flex-1 flex-col">
					{showYaml ? (
						<textarea
							value={text}
							readOnly={!editable}
							spellCheck={false}
							onChange={(e) => {
								// A free-form retype replaces the document; undo history
								// restarts, which is honest — we cannot describe it as a patch.
								docRef.current = WorkflowDoc.parse(e.target.value);
								setText(e.target.value);
								onChange?.(e.target.value);
							}}
							className="h-full w-full resize-none border-0 bg-[#FCFCFD] p-3 font-mono text-[11px] leading-relaxed text-slate-700 focus:outline-none"
						/>
					) : (
						<WorkflowCanvas
							graph={graph}
							overlay={overlay}
							mode={editable && !formFirst ? "edit" : "view"}
							// Form-first: the canvas becomes a header strip showing what
							// goes in and what comes out, and the form gets the room.
							height={formFirst ? 150 : "100%"}
							density={formFirst ? "compact" : "comfortable"}
							chrome={formFirst ? { minimap: false, controls: false, diagnostics: true } : undefined}
							className={formFirst
								? "w-full shrink-0 border-b border-slate-200 bg-[#FCFCFD]"
								: "h-full w-full bg-[#FCFCFD]"}
							selection={selected}
							onSelectionChange={setSelected}
							onEdit={runEdit}
							canConnect={adapter.capabilities.rewire && !formFirst}
						/>
					)}
					{formFirst && !showYaml && inspected && (
						<div className="min-h-0 flex-1 overflow-y-auto bg-white">
							<NodeInspector
								node={inspected}
								registry={adapter.registry}
								layout="full"
								readOnly={!editable}
								lockReason={locked ? doc.lock?.detail : undefined}
								resourceOptions={resourceOptions}
								onChangeParam={(path, v) => runEdit({ t: "setParam", node: inspected.id, key: path, value: v })}
								onRename={(to) => runEdit({ t: "renameNode", id: inspected.id, to })}
							/>
						</div>
					)}
				</div>

				{!formFirst && selectedNode && (
					<NodeInspector
						node={selectedNode}
						registry={adapter.registry}
						readOnly={!editable}
						lockReason={locked ? doc.lock?.detail : undefined}
						resourceOptions={resourceOptions}
						onClose={() => setSelected(null)}
						onChangeParam={(path, v) => runEdit({ t: "setParam", node: selectedNode.id, key: path, value: v })}
						onRename={(to) => runEdit({ t: "renameNode", id: selectedNode.id, to })}
					/>
				)}
			</div>
		</div>
	);
}

/**
 * A document we cannot classify still gets shown. Failing soft into raw text
 * beats an error page: `definition_json` has no schema discipline, so an
 * unrecognised row is an ordinary occurrence rather than a fault.
 */
function UnknownDialect({
	text, why, readOnly, onChange, height,
}: { text: string; why: string; readOnly?: boolean; onChange: (t: string) => void; height: number | string }) {
	return (
		<div className="flex h-full min-h-0 flex-col" style={{ height }}>
			<div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
				Not a workflow dialect this editor knows, so it is shown as plain text. {why}
			</div>
			<textarea
				value={text}
				readOnly={readOnly}
				spellCheck={false}
				onChange={(e) => onChange(e.target.value)}
				className="min-h-0 flex-1 resize-none border-0 bg-[#FCFCFD] p-3 font-mono text-[11px] leading-relaxed text-slate-700 focus:outline-none"
			/>
		</div>
	);
}

function AddMenu({
	disabled, adapter, onPick,
}: { disabled?: boolean; adapter: Adapter; onPick: (entry: string) => void }) {
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState("");
	const hits = adapter.palette.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
	return (
		<div className="relative">
			<button
				type="button"
				disabled={disabled}
				onClick={() => setOpen((v) => !v)}
				className="flex h-7 items-center gap-1 rounded-lg bg-slate-900 px-2 text-[11px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
			>
				<Plus size={13} /> Add
			</button>
			{open && !disabled && (
				<>
					<div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
					<div className="absolute left-0 top-8 z-20 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
						<input
							autoFocus
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder={`Search ${adapter.label}…`}
							className="mb-1 h-7 w-full rounded-md border border-slate-200 px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-[rgb(176_143_69)]"
						/>
						<div className="max-h-64 overflow-y-auto">
							{hits.map((entry) => (
								<button
									key={entry}
									type="button"
									onClick={() => { onPick(entry); setOpen(false); setQ(""); }}
									className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-slate-50"
								>
									<span className="text-[11px] text-slate-900">{adapter.labelOf(entry)}</span>
									<span className="line-clamp-1 text-[10px] text-slate-400">{adapter.summaryOf(entry)}</span>
								</button>
							))}
							{!hits.length && <p className="px-2 py-2 text-[11px] text-slate-400">Nothing matches "{q}".</p>}
						</div>
					</div>
				</>
			)}
		</div>
	);
}
