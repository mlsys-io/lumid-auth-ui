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
					return <div key={i} className="text-micro font-mono text-ink-700 truncate" title={pretty}>{pretty}</div>;
				})}
				{file.truncated && <div className="text-nano text-ink-600 italic">…truncated (showing first rows of {humanBytes(file.bytes)})</div>}
			</div>
		);
	}
	return (
		<>
			<pre className="text-micro font-mono text-ink-700 whitespace-pre-wrap max-h-72 overflow-auto">{text.slice(0, 8000)}</pre>
			{file.truncated && <div className="text-nano text-ink-600 italic mt-1">…truncated (showing first 64 KB of {humanBytes(file.bytes)})</div>}
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

	if (groups === null) return <div className="h-16 rounded-lg bg-ink-100 animate-pulse" />;
	if (groups.length === 0) return (
		<div className="text-xs text-ink-600 leading-relaxed">
			No static casebook is bundled with this workflow — it reads <span className="font-medium text-ink-700">live / external data</span> (e.g. market feeds, your mailbox, a warehouse). Its goal metrics are scored on each run's outputs; open the <span className="font-medium text-ink-700">Runs</span> tab to inspect what each run saw.
		</div>
	);

	return (
		<div className="space-y-3">
			{groups.map((g) => (
				<div key={g.group}>
					<div className="text-micro font-medium text-ink-600 flex items-center gap-1.5 mb-1">
						<Database className="w-3 h-3 text-ink-600" />{g.label}
					</div>
					<ul className="space-y-0.5">
						{g.files.map((f) => {
							const Icon = kindIcon(f.kind);
							const open = openPath === f.path;
							return (
								<li key={f.path} className="rounded-lg border border-ink-200/70 bg-card overflow-hidden">
									<button
										type="button"
										onClick={() => openFile(f.path)}
										className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-ink-50 transition-colors"
									>
										<ChevronRight className={`w-3 h-3 text-ink-600 transition-transform ${open ? "rotate-90" : ""}`} />
										<Icon className="w-3.5 h-3.5 text-ink-600 flex-shrink-0" />
										<span className="text-caption text-ink-700 font-mono truncate flex-1">{f.name}</span>
										<span className="text-nano text-ink-600 flex-shrink-0">{humanBytes(f.bytes)}</span>
									</button>
									{open && (
										<div className="border-t border-ink-100 px-2.5 py-2 bg-ink-50/40">
											{loadingFile && !file ? (
												<div className="flex items-center gap-2 text-micro text-ink-600"><Loader2 className="w-3.5 h-3.5 animate-spin" />reading…</div>
											) : file ? (
												<FileBody file={file} />
											) : (
												<div className="text-micro text-ink-600 italic">Couldn't read this file.</div>
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
