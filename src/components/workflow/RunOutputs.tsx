// RunOutputs — the run page's third column: what this run produced. Novix
// shows workspace files as cards ("Final deliverables"); Lumid shows the files
// a run produced the same way — a sidecar file, a whole document the run
// returned inline (an mlsys run's design), and everything it returned as
// results.json — each one click to save. Then its own sentence, short named
// results, the memories it learned, the fleet jobs it started; and says so
// plainly when there is nothing.

import { useState } from "react";
import { Download, FileJson, FileText } from "lucide-react";
import type { MeCycleDetail } from "@/api/me";
import { runFiles, runOutputs, type RunFile } from "@/lib/run-answer";
import RunChildren from "@/components/workflow/RunChildren";
import { cn } from "@/lib/utils";

const MIME: Record<RunFile["type"], string> = { json: "application/json", md: "text/markdown", txt: "text/plain" };

function fmtBytes(n: number): string {
	return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function save(f: RunFile, prefix: string) {
	const url = URL.createObjectURL(new Blob([f.content], { type: MIME[f.type] }));
	const a = document.createElement("a");
	a.href = url; a.download = prefix ? `${prefix}-${f.name}` : f.name;
	document.body.appendChild(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function FileCard({ f, prefix }: { f: RunFile; prefix: string }) {
	const [open, setOpen] = useState(false);
	const Icon = f.type === "json" ? FileJson : FileText;
	return (
		<li className={cn("rounded-lg border bg-card transition-colors", open ? "border-ink-300" : "border-ink-200 hover:border-ink-300")}>
			<div className="flex items-center gap-2 px-2.5 py-2 min-w-0">
				<Icon className="w-4 h-4 text-ink-500 flex-shrink-0" aria-hidden />
				<button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left" title="Show what's in it">
					<div className="text-caption font-medium text-ink-900 truncate font-mono">{f.name}</div>
					<div className="text-micro text-ink-600 truncate">{f.label} · {fmtBytes(f.bytes)}</div>
				</button>
				<button type="button" onClick={() => save(f, prefix)} aria-label={`Download ${f.name}`} title={`Download ${f.name}`}
					className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-600 hover:text-ink-900 hover:bg-ink-100 flex-shrink-0">
					<Download className="w-3.5 h-3.5" />
				</button>
			</div>
			{open && (
				<pre className="mx-2.5 mb-2 max-h-64 overflow-auto rounded-md bg-ink-50 border border-ink-100 p-2 text-nano font-mono text-ink-800 whitespace-pre-wrap break-words">{f.content.length > 20_000 ? `${f.content.slice(0, 20_000)}\n…` : f.content}</pre>
			)}
		</li>
	);
}

export default function RunOutputs({ detail, onFullOutput }: { detail: MeCycleDetail | null; onFullOutput?: () => void }) {
	const o = runOutputs(detail);
	const files = runFiles(detail);
	const jobs = detail?.compute_jobs ?? [];
	const nothing = !files.length && !o.text && !o.fields.length && !o.memories.length && !jobs.length;
	// Saved names carry the run, so two runs' results.json don't collide.
	const prefix = detail ? `${detail.loop || "run"}-${detail.ts || ""}`.replace(/[^\w.-]+/g, "_").replace(/-$/, "") : "";
	return (
		<aside aria-label="What this run produced" className="space-y-2.5 min-w-0">
			<h3 className="text-micro uppercase tracking-wide font-semibold text-ink-600">What it produced</h3>
			{!detail ? (
				<div className="h-16 lumen-skeleton rounded-lg" />
			) : nothing ? (
				<p className="text-caption text-ink-600">This run saved no files or results of its own beyond the answer above.</p>
			) : (
				<>
					{files.length > 0 && (
						<ul aria-label="Files" className="space-y-1.5">
							{files.map((f) => <FileCard key={f.name} f={f} prefix={prefix} />)}
						</ul>
					)}
					{o.text && <p className="text-caption text-ink-800 leading-snug">{o.text}</p>}
					{o.fields.length > 0 && (
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
							{o.fields.map((f) => (
								<div key={f.label} className="contents">
									<dt className="text-ink-600">{f.label}</dt>
									<dd className="text-ink-900 break-words">{f.value}</dd>
								</div>
							))}
						</dl>
					)}
					{o.memories.length > 0 && (
						<div>
							<div className="text-micro text-ink-600 mb-0.5">Learned</div>
							<ul className="text-caption text-ink-800 list-disc pl-4 space-y-0.5">{o.memories.map((m) => <li key={m}>{m}</li>)}</ul>
						</div>
					)}
					<RunChildren jobs={jobs} />
				</>
			)}
			{detail && onFullOutput && (
				<button type="button" onClick={onFullOutput} className="text-micro text-ink-700 hover:text-ink-900 underline decoration-dotted">Full output</button>
			)}
		</aside>
	);
}
