// LumilakeEditor — canvas + inspector over one Lumilake document.
//
// The whole point of the architecture, in one component: there is exactly ONE
// store, the WorkflowDoc. The canvas and the inspector both render a
// projection of it, and both report intent; nothing owns a second copy of the
// graph that could drift. That is why undo can be a ring of text snapshots and
// why the YAML pane is not a separate representation but the same one.
//
// Lumilake first because it is the only dialect that is genuinely an editable
// DAG *and* already has a working submit path — so the loop closes here:
// edit -> optimize_workflow (HALO badges land on your own graph) ->
// run_lumilake_job -> the run overlay lights the same nodes.

import { useCallback, useMemo, useRef, useState } from "react";
import { Plus, Redo2, Undo2, Code2, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import WorkflowCanvas from "./WorkflowCanvas";
import { NodeInspector } from "./inspector/NodeInspector";
import { WorkflowDoc } from "./doc";
import { parseLumilake, LUMILAKE_CAPABILITIES, LUMILAKE_OPS, type HaloPlan } from "./adapters/lumilake";
import { applyLumilakeEdit } from "./adapters/lumilake.edit";
import { LUMILAKE_REGISTRY } from "./registry/lumilake";
import type { WfEdit, WfOverlay } from "./model";

interface Props {
	/** The initial document text. Owned from here on. */
	value: string;
	onChange?: (text: string) => void;
	plan?: HaloPlan;
	overlay?: WfOverlay;
	readOnly?: boolean;
	height?: number | string;
	/** Models etc. for `resource` fields, when the caller can resolve them. */
	resourceOptions?: Partial<Record<string, string[]>>;
}

export default function LumilakeEditor({
	value, onChange, plan, overlay, readOnly, height = "100%", resourceOptions,
}: Props) {
	// The document is held in a ref and mirrored into state as text: the ref is
	// the mutable object, the string is what makes React re-render. Keeping the
	// graph itself in state would be the second store this design exists to
	// avoid.
	const docRef = useRef<WorkflowDoc>(WorkflowDoc.parse(value));
	const [text, setText] = useState(value);
	const [selected, setSelected] = useState<string | null>(null);
	const [showYaml, setShowYaml] = useState(false);
	const [, forceRender] = useState(0);

	const doc = docRef.current;
	const locked = !doc.editable;
	const editable = !readOnly && !locked;

	const graph = useMemo(() => parseLumilake(text, plan), [text, plan]);
	const selectedNode = selected ? graph.nodes.find((n) => n.id === selected) : undefined;

	const sync = useCallback(() => {
		const next = docRef.current.toString();
		setText(next);
		onChange?.(next);
		forceRender((n) => n + 1);
	}, [onChange]);

	const runEdit = useCallback((edit: WfEdit) => {
		const r = applyLumilakeEdit(docRef.current, graph, edit);
		if (!r.ok) {
			// A refusal is information, not a failure: the adapter is telling the
			// user what this dialect's contract does not allow.
			toast.info(r.reason);
			return;
		}
		sync();
		if (edit.t === "removeNode" && selected === edit.id) setSelected(null);
		if (edit.t === "renameNode") setSelected(edit.to);
	}, [graph, selected, sync]);

	const addOp = (op: string) => runEdit({
		t: "addNode",
		id: "",
		kind: { family: "lumilake-op", op },
		after: selected ?? graph.nodes[graph.nodes.length - 1]?.id,
	});

	const btn = "flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent";

	return (
		<div className="flex h-full min-h-0 flex-col" style={{ height }}>
			<div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
				<AddMenu disabled={!editable} onPick={addOp} />
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
					{graph.diagnostics.some((d) => d.level === "error") && (
						<span className="text-rose-600">
							{graph.diagnostics.filter((d) => d.level === "error").length} problem(s)
						</span>
					)}
					<span>{graph.nodes.length} node{graph.nodes.length === 1 ? "" : "s"}</span>
				</div>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					{showYaml ? (
						<textarea
							value={text}
							readOnly={!editable}
							spellCheck={false}
							onChange={(e) => {
								// Editing the text directly replaces the document. Undo
								// history restarts, which is honest — we cannot describe a
								// free-form retype as a patch.
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
							mode={editable ? "edit" : "view"}
							height="100%"
							className="h-full w-full bg-[#FCFCFD]"
							selection={selected}
							onSelectionChange={setSelected}
							onEdit={runEdit}
							canConnect={LUMILAKE_CAPABILITIES.rewire}
						/>
					)}
				</div>

				{selectedNode && (
					<NodeInspector
						node={selectedNode}
						registry={LUMILAKE_REGISTRY}
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
 * The add menu is a searchable list rather than a permanent left tray of
 * draggable blocks: with a couple of dozen kinds a tray is a scrolling wall,
 * and it costs the canvas its full width for something used a few times a
 * session.
 */
function AddMenu({ disabled, onPick }: { disabled?: boolean; onPick: (op: string) => void }) {
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState("");
	const hits = LUMILAKE_OPS.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
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
					<div className="absolute left-0 top-8 z-20 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
						<input
							autoFocus
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="Search ops…"
							className="mb-1 h-7 w-full rounded-md border border-slate-200 px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-[rgb(176_143_69)]"
						/>
						<div className="max-h-56 overflow-y-auto">
							{hits.map((op) => (
								<button
									key={op}
									type="button"
									onClick={() => { onPick(op); setOpen(false); setQ(""); }}
									className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-slate-50"
								>
									<span className="text-[11px] text-slate-900">{LUMILAKE_REGISTRY[op]?.label ?? op}</span>
									<span className="text-[10px] text-slate-400">{LUMILAKE_REGISTRY[op]?.summary ?? op}</span>
								</button>
							))}
							{!hits.length && <p className="px-2 py-2 text-[11px] text-slate-400">No op matches "{q}".</p>}
						</div>
					</div>
				</>
			)}
		</div>
	);
}
