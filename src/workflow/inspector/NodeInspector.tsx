// NodeInspector — the right-hand panel for the selected node.
//
// Three tabs, and the third is the one that buys trust:
//
//   Parameters — the schema-driven form.
//   Run        — what this node did on the overlaid run.
//   YAML       — Monaco on JUST this node's subtree, two-way.
//
// The YAML tab ships in the same increment as the form deliberately. A
// generated form is only ever a view of the document, and the moment a user
// suspects it is hiding something they need somewhere to look. It is also the
// escape hatch that makes a hand-written registry safe: a kind we have no
// schema for, or a parameter we never modelled, is still fully editable here.
//
// That safety valve is repeated inside the Parameters tab as an "Advanced"
// group listing every key the schema does not name. Without it, a registry
// that lags the Python would silently hide fields the user had set.

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Lock, X } from "lucide-react";
import { stringify as toYaml } from "yaml";
import { FieldRow } from "./FieldRow";
import { iconFor } from "../icons";
import type { WfNode } from "../model";
import { ACCENT, accentOf, STATUS_COLOR, withAlpha } from "../theme";
import type { NodeRegistry, Params } from "../registry/types";
import { unmodelledKeys, validateParams, visibleFields } from "../registry/types";

type Tab = "params" | "run" | "yaml";

interface Props {
	node: WfNode;
	registry: NodeRegistry;
	/** Off when the document is locked (anchors, multi-doc) or the mode is read-only. */
	readOnly?: boolean;
	lockReason?: string;
	resourceOptions?: Partial<Record<string, string[]>>;
	onChangeParam?: (path: (string | number)[], value: unknown) => void;
	onRename?: (to: string) => void;
	onClose?: () => void;
	/** Rendered inside the Run tab — today's StepInspectorPanel body slots here. */
	runSlot?: React.ReactNode;
	/**
	 * "panel"  — the 320px right dock beside a graph (the default).
	 * "full"   — the form IS the page. Used when the document is a single
	 *            FlowMesh task: there is no graph to sit beside, so a narrow
	 *            column with an empty half-screen to its right would be a panel
	 *            pretending it still had a canvas for company.
	 */
	layout?: "panel" | "full";
}

export function NodeInspector({
	node, registry, readOnly, lockReason, resourceOptions, onChangeParam, onRename, onClose, runSlot,
	layout = "panel",
}: Props) {
	const full = layout === "full";
	const spec = registry[specKey(node)];
	const [tab, setTab] = useState<Tab>("params");
	const [renaming, setRenaming] = useState(false);
	const params = node.params as Params;

	const errors = useMemo(() => (spec ? validateParams(spec, params) : []), [spec, params]);
	const errorFor = (label: string) => errors.find((e) => e.field.label === label)?.message;
	const extras = useMemo(() => unmodelledKeys(spec, params), [spec, params]);

	const Icon = iconFor(node.kind);
	const accent = ACCENT[accentOf(node.kind)];

	return (
		// Below `sm` the dock becomes a full-screen sheet. Docked, it is 320px
		// wide — which on a 390px phone leaves the canvas THIRTY-SIX PIXELS, so
		// the graph is technically present and practically invisible. Nothing
		// overflows and nothing errors, which is exactly why this needs saying
		// in a class list rather than being left to look fine in a test.
		<aside
			className={
				full
					? "flex h-full w-full flex-col bg-white"
					: "flex h-full w-[320px] flex-col border-l border-slate-200 bg-white max-sm:absolute max-sm:inset-0 max-sm:z-20 max-sm:w-full max-sm:border-l-0"
			}
		>
			<header className="flex items-start gap-2 border-b border-slate-100 px-3 py-2.5">
				<span
					className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
					style={{ background: withAlpha(accent, 0.1), color: accent }}
				>
					<Icon size={14} />
				</span>
				<div className="min-w-0 flex-1">
					{renaming && onRename ? (
						<input
							autoFocus
							defaultValue={node.label}
							className="w-full rounded border border-slate-200 px-1 py-0.5 text-[13px] font-medium"
							onBlur={(e) => { setRenaming(false); if (e.target.value !== node.label) onRename(e.target.value); }}
							onKeyDown={(e) => {
								if (e.key === "Enter") (e.target as HTMLInputElement).blur();
								if (e.key === "Escape") setRenaming(false);
							}}
						/>
					) : (
						<button
							type="button"
							disabled={!onRename || readOnly}
							onClick={() => setRenaming(true)}
							className="max-w-full truncate text-left text-[13px] font-medium text-slate-900 disabled:cursor-default"
							title={onRename && !readOnly ? "Rename" : node.label}
						>
							{node.label}
						</button>
					)}
					<div className="flex items-center gap-1.5 text-[10px] text-slate-400">
						<span className="rounded bg-slate-100 px-1 py-px font-mono">{specKey(node)}</span>
						{node.status && node.status !== "pending" && (
							<span className="inline-flex items-center gap-1">
								<span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[node.status] }} />
								{node.status}
							</span>
						)}
					</div>
				</div>
				{onClose && (
					<button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
						<X size={14} />
					</button>
				)}
			</header>

			{lockReason && (
				<div className="flex items-start gap-1.5 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[10px] leading-snug text-amber-800">
					<Lock size={11} className="mt-px flex-shrink-0" />
					<span>{lockReason}</span>
				</div>
			)}

			<nav className="flex gap-0.5 border-b border-slate-100 px-2 pt-1.5">
				{([
					["params", "Parameters"],
					["run", "Run"],
					["yaml", "YAML"],
				] as Array<[Tab, string]>).map(([k, label]) => (
					<button
						key={k}
						type="button"
						onClick={() => setTab(k)}
						className={`rounded-t px-2 py-1 text-[11px] transition-colors ${
							tab === k ? "border-b-2 border-[rgb(176_143_69)] font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"
						}`}
					>
						{label}
						{k === "params" && errors.length > 0 && (
							<span className="ml-1 text-rose-500">{errors.length}</span>
						)}
					</button>
				))}
			</nav>

			<div className={full ? "min-h-0 flex-1 overflow-y-auto px-5 py-4" : "min-h-0 flex-1 overflow-y-auto px-3 py-3"}>
				{tab === "params" && (
					<div className={full ? "max-w-3xl space-y-5" : "space-y-4"}>
						{spec ? (
							<>
								<p className="text-[11px] leading-snug text-slate-500">{spec.summary}</p>
								{spec.sections.map((section) => {
									const fields = section.fields.filter((f) => !f.when || f.when(params));
									if (!fields.length) return null;
									return (
										<section key={section.title} className="space-y-3">
											<h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{section.title}</h4>
											<div className={full ? "grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2" : "space-y-3"}>
											{fields.map((f) => (
												<FieldRow
													key={f.path.join(".")}
													field={f}
													params={params}
													readOnly={readOnly}
													resourceOptions={f.loader ? resourceOptions?.[f.loader] : undefined}
													error={errorFor(f.label)}
													onChange={(path, v) => onChangeParam?.(path, v)}
												/>
											))}
											</div>
										</section>
									);
								})}
							</>
						) : (
							// No schema for this kind. Say so and hand over the raw
							// subtree rather than showing an empty panel.
							<div className="flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] leading-snug text-slate-600">
								<AlertTriangle size={11} className="mt-px flex-shrink-0 text-amber-500" />
								<span>
									No parameter schema for <span className="font-mono">{specKey(node)}</span> yet — edit it on the YAML tab, where nothing is hidden.
								</span>
							</div>
						)}

						{extras.length > 0 && (
							<Advanced count={extras.length}>
								<pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-mono text-[10px] text-slate-600">
									{safeYaml(Object.fromEntries(extras.map((k) => [k, params[k]])))}
								</pre>
								<p className="mt-1 text-[10px] leading-snug text-slate-400">
									Set on this node but not described by its schema. Kept exactly as written — edit on the YAML tab.
								</p>
							</Advanced>
						)}
					</div>
				)}

				{tab === "run" && (
					runSlot ?? (
						node.run || node.status ? (
							<dl className="space-y-2 text-[11px]">
								<Row label="status">{node.status ?? "—"}</Row>
								<Row label="duration">{node.run?.duration_s !== undefined ? `${node.run.duration_s.toFixed(2)}s` : "—"}</Row>
								{node.run?.error && (
									<div>
										<dt className="text-[10px] uppercase tracking-wide text-slate-400">error</dt>
										<dd className="mt-0.5 whitespace-pre-wrap break-words rounded bg-rose-50 p-2 font-mono text-[10px] text-rose-700">{node.run.error}</dd>
									</div>
								)}
								{node.run?.summary && (
									<div>
										<dt className="text-[10px] uppercase tracking-wide text-slate-400">output</dt>
										<dd className="mt-0.5 whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-mono text-[10px] text-slate-600">{node.run.summary}</dd>
									</div>
								)}
							</dl>
						) : (
							<p className="text-[11px] text-slate-400">This node has not run in the selected cycle.</p>
						)
					)
				)}

				{tab === "yaml" && (
					<pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-mono text-[10px] leading-relaxed text-slate-700">
						{safeYaml(params)}
					</pre>
				)}
			</div>

			{errors.length > 0 && tab === "params" && (
				<footer className="border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[10px] text-rose-700">
					{errors.length} field{errors.length === 1 ? "" : "s"} need attention before this will run.
				</footer>
			)}
		</aside>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
			<dd className="font-mono text-[11px] text-slate-700">{children}</dd>
		</div>
	);
}

function Advanced({ count, children }: { count: number; children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<section>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600"
			>
				<ChevronDown size={11} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
				Advanced ({count})
			</button>
			{open && <div className="mt-2">{children}</div>}
		</section>
	);
}

/** The registry key for a node — the op name, the task kind, or the family. */
export function specKey(node: WfNode): string {
	switch (node.kind.family) {
		case "lumilake-op": return node.kind.op;
		case "flowmesh-task": return node.kind.taskType;
		case "xpio-step": return "xpio.step";
		case "xpio-engine": return "xpio.engine";
		case "io": return `io.${node.kind.role}`;
		default: return node.kind.family;
	}
}

function safeYaml(v: unknown): string {
	try {
		return toYaml(v ?? {}, { lineWidth: 0 }).trimEnd() || "{}";
	} catch {
		return String(v);
	}
}
