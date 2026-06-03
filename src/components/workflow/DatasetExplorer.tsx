// DatasetExplorer — peek the data an app's loops actually run against.
//
// auto-sysresearch benchmarks against queries.jsonl + schema.sql; mbb-ai works
// labeled Case_*.json casebooks. This lists those files (GET /me/apps/:app/
// datasets) and lets you open one (GET …/dataset-file) to see real rows —
// so the loop's inputs aren't a black box. Read-only, capped at 64 KB/file.

import { useEffect, useState } from "react";
import { Database, FileText, FileJson, Table, Loader2, ChevronRight } from "lucide-react";
import { me, type MeDatasetGroup, type MeDatasetFile } from "@/api/me";

function kindIcon(kind: string) {
	if (kind === "jsonl" || kind === "json") return FileJson;
	if (kind === "csv") return Table;
	return FileText;
}
function humanBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Render the file body by kind: jsonl → first rows pretty-printed; everything
// else → monospace text. Capped lines so a big file doesn't blow the panel.
function FileBody({ file }: { file: MeDatasetFile }) {
	const text = file.content || "";
	if (file.kind === "jsonl") {
		const rows = text.split("\n").filter(Boolean).slice(0, 20);
		return (
			<div className="space-y-1">
				{rows.map((r, i) => {
					let pretty = r;
					try { pretty = JSON.stringify(JSON.parse(r)); } catch { /* keep raw */ }
					return <div key={i} className="text-[11px] font-mono text-slate-700 truncate" title={pretty}>{pretty}</div>;
				})}
				{file.truncated && <div className="text-[10px] text-slate-400 italic">…truncated (showing first rows of {humanBytes(file.bytes)})</div>}
			</div>
		);
	}
	return (
		<>
			<pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap max-h-72 overflow-auto">{text.slice(0, 8000)}</pre>
			{file.truncated && <div className="text-[10px] text-slate-400 italic mt-1">…truncated (showing first 64 KB of {humanBytes(file.bytes)})</div>}
		</>
	);
}

export default function DatasetExplorer({ app }: { app: string }) {
	const [groups, setGroups] = useState<MeDatasetGroup[] | null>(null);
	const [openPath, setOpenPath] = useState<string | null>(null);
	const [file, setFile] = useState<MeDatasetFile | null>(null);
	const [loadingFile, setLoadingFile] = useState(false);

	useEffect(() => {
		let live = true;
		me.appDatasets(app)
			.then((r) => { if (live) setGroups(r.datasets || []); })
			.catch(() => { if (live) setGroups([]); });
		return () => { live = false; };
	}, [app]);

	const openFile = (path: string) => {
		if (openPath === path) { setOpenPath(null); setFile(null); return; }
		setOpenPath(path); setFile(null); setLoadingFile(true);
		me.appDatasetFile(app, path)
			.then((f) => { setFile(f); setLoadingFile(false); })
			.catch(() => setLoadingFile(false));
	};

	if (groups === null) return <div className="h-16 rounded-lg bg-slate-100 animate-pulse" />;
	if (groups.length === 0) return <div className="text-xs text-slate-400 italic">No bundled datasets found for this app.</div>;

	return (
		<div className="space-y-3">
			{groups.map((g) => (
				<div key={g.group}>
					<div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5 mb-1">
						<Database className="w-3 h-3 text-slate-400" />{g.label}
					</div>
					<ul className="space-y-0.5">
						{g.files.map((f) => {
							const Icon = kindIcon(f.kind);
							const open = openPath === f.path;
							return (
								<li key={f.path} className="rounded-lg border border-slate-200/70 bg-white overflow-hidden">
									<button
										type="button"
										onClick={() => openFile(f.path)}
										className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50 transition-colors"
									>
										<ChevronRight className={`w-3 h-3 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
										<Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
										<span className="text-[12px] text-slate-700 font-mono truncate flex-1">{f.name}</span>
										<span className="text-[10px] text-slate-400 flex-shrink-0">{humanBytes(f.bytes)}</span>
									</button>
									{open && (
										<div className="border-t border-slate-100 px-2.5 py-2 bg-slate-50/40">
											{loadingFile && !file ? (
												<div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" />reading…</div>
											) : file ? (
												<FileBody file={file} />
											) : (
												<div className="text-[11px] text-slate-400 italic">Couldn't read this file.</div>
											)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</div>
	);
}
