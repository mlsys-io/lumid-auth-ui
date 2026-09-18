// ImportDialog — what you are about to lose, before you lose it.
//
// The dialog exists because the alternative is a button that says "Import" and
// silently produces a workflow that is missing a third of the original. Every
// dropped node gets a ghost card with the reason; every caveat is stated in
// plain words, in the dialog, not in a doc nobody opens.
//
// It also refuses to call itself a translation. Two authoritative n8n parsers
// already live server-side and disagree with each other (FlowMesh accepts five
// node types, Lumilake nine); a third in the browser would be the one that
// silently diverges. So the copy says "starting point", the coverage line says
// what the real parser would accept, and running the original is offered as
// the thing to do when fidelity matters.

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Ghost, Info, X } from "lucide-react";
import WorkflowCanvas from "../WorkflowCanvas";
import { parseN8n, scaffoldLumilake, flowmeshCoverage, type N8nDoc } from "./n8n";
import { parseDify, scaffoldFromDify } from "./dify";
import { parseLumilake } from "../adapters/lumilake";
import type { WorkflowGraph } from "../model";

interface Props {
	/** The pasted or uploaded document. */
	text: string;
	format: "n8n" | "dify";
	onCancel: () => void;
	/** Called with the scaffolded Lumilake document when the user commits. */
	onImport: (lumilakeYaml: string) => void;
}

export function ImportDialog({ text, format, onCancel, onImport }: Props) {
	const source: WorkflowGraph = useMemo(
		() => (format === "n8n" ? parseN8n(text) : parseDify(text)),
		[text, format],
	);
	const scaffold = useMemo(
		() => (format === "n8n" ? scaffoldLumilake(source) : scaffoldFromDify(source)),
		[source, format],
	);
	const result = useMemo(() => parseLumilake(scaffold.text), [scaffold.text]);
	const [showYaml, setShowYaml] = useState(false);

	// What FlowMesh's own parser would make of this, if submitted directly —
	// reported rather than reimplemented.
	const coverage = useMemo(() => {
		if (format !== "n8n") return null;
		try {
			return flowmeshCoverage(JSON.parse(text) as N8nDoc);
		} catch {
			return null;
		}
	}, [text, format]);

	const fatal = source.diagnostics.filter((d) => d.level === "error");
	const nothingMapped = scaffold.mapped.length === 0;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6">
			<div className="flex h-full max-h-[760px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
				<header className="flex items-start gap-3 border-b border-slate-100 px-5 py-3.5">
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-medium text-slate-900">
							Import from {format === "n8n" ? "n8n" : "Dify"}
						</h2>
						<p className="mt-0.5 text-[11px] leading-snug text-slate-500">
							This produces a <strong className="font-medium text-slate-700">starting point</strong>, not a translation.
							Topology and prompts come across; expressions, credentials and anything with no equivalent do not.
							{format === "n8n" && " To run the original as it is, submit it with Workflow-Format: n8n and let the server that owns those semantics do the work."}
						</p>
					</div>
					<button type="button" onClick={onCancel} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
						<X size={16} />
					</button>
				</header>

				{fatal.length > 0 && (
					<div className="flex items-start gap-2 border-b border-rose-100 bg-rose-50 px-5 py-2 text-[11px] text-rose-700">
						<AlertTriangle size={12} className="mt-px flex-shrink-0" />
						<div>
							{fatal.slice(0, 2).map((d, i) => <div key={i}>{d.message}</div>)}
							{fatal.length > 2 && <div>and {fatal.length - 2} more.</div>}
						</div>
					</div>
				)}

				<div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-[280px_1fr]">
					{/* LEFT — what is being lost. */}
					<aside className="min-h-0 overflow-y-auto border-r border-slate-100 bg-slate-50/60 px-4 py-3">
						<h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
							{scaffold.dropped.length ? `Not imported (${scaffold.dropped.length})` : "Everything mapped"}
						</h3>

						{scaffold.dropped.length === 0 && (
							<p className="text-[11px] leading-snug text-slate-500">
								Every node in this graph has a Lumilake equivalent. Check the prompts anyway — see the notes below.
							</p>
						)}

						<div className="space-y-2">
							{scaffold.dropped.map((d) => (
								<div key={d.name} className="rounded-lg border border-dashed border-slate-300 bg-white/70 p-2">
									<div className="flex items-center gap-1.5">
										<Ghost size={12} className="flex-shrink-0 text-slate-400" />
										<span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700" title={d.name}>{d.name}</span>
									</div>
									<div className="mt-0.5 truncate font-mono text-[9px] text-slate-400" title={d.type}>{d.type}</div>
									<p className="mt-1 text-[10px] leading-snug text-slate-500">{d.reason}</p>
								</div>
							))}
						</div>

						{scaffold.notes.length > 0 && (
							<>
								<h3 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Before you run it</h3>
								<ul className="space-y-1.5">
									{scaffold.notes.map((n, i) => (
										<li key={i} className="flex items-start gap-1.5 text-[10px] leading-snug text-slate-600">
											<Info size={11} className="mt-px flex-shrink-0 text-amber-500" />
											<span>{n}</span>
										</li>
									))}
								</ul>
							</>
						)}

						{coverage && (
							<>
								<h3 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">If you submit the original</h3>
								<p className="text-[10px] leading-snug text-slate-600">
									FlowMesh's own parser accepts <strong>{coverage.accepted} of {coverage.total}</strong> node types here.
									{coverage.unsupported.length > 0 && (
										<> It has no handler for <span className="font-mono">{coverage.unsupported.slice(0, 3).join(", ")}</span>
											{coverage.unsupported.length > 3 && ` and ${coverage.unsupported.length - 3} more`}.</>
									)}
								</p>
							</>
						)}
					</aside>

					{/* RIGHT — what you would get. */}
					<section className="flex min-h-0 flex-col">
						<div className="flex items-center gap-2 border-b border-slate-100 px-4 py-1.5">
							<span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
								{source.nodes.length} {format === "n8n" ? "n8n" : "Dify"} node{source.nodes.length === 1 ? "" : "s"}
							</span>
							<ArrowRight size={11} className="text-slate-300" />
							<span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
								{scaffold.mapped.length} Lumilake op{scaffold.mapped.length === 1 ? "" : "s"}
							</span>
							<button
								type="button"
								onClick={() => setShowYaml((v) => !v)}
								className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
							>
								{showYaml ? "Canvas" : "YAML"}
							</button>
						</div>
						<div className="min-h-0 flex-1">
							{nothingMapped ? (
								<div className="flex h-full items-center justify-center px-8 text-center text-[12px] leading-relaxed text-slate-500">
									Nothing in this graph maps to a Lumilake op, so there is no workflow to import.
									Every node is listed on the left with the reason.
								</div>
							) : showYaml ? (
								<pre className="h-full overflow-auto bg-[#FCFCFD] p-3 font-mono text-[11px] leading-relaxed text-slate-700">{scaffold.text}</pre>
							) : (
								<WorkflowCanvas graph={result} mode="view" height="100%" className="h-full w-full bg-[#FCFCFD]" />
							)}
						</div>
					</section>
				</div>

				<footer className="flex items-center gap-2 border-t border-slate-100 px-5 py-3">
					<p className="min-w-0 flex-1 text-[10px] leading-snug text-slate-400">
						Importing replaces what is currently in the editor. The original document is not modified.
					</p>
					<button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100">
						Cancel
					</button>
					<button
						type="button"
						disabled={nothingMapped}
						onClick={() => onImport(scaffold.text)}
						className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
					>
						Import {scaffold.mapped.length} op{scaffold.mapped.length === 1 ? "" : "s"}
					</button>
				</footer>
			</div>
		</div>
	);
}
