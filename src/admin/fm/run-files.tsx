// Files — every file a Research Fleet run produced: generated images, result
// files, Lumilake artifacts. Each opens in a new tab or downloads. Served by
// identity to the run's owner only (lib/run-files.ts runFileUrl); the session
// cookie authenticates, so plain links and <img> work.

import { Download, ExternalLink, FileText, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { ME_BASE } from "../../api/me";
import { filesLabel, runFileUrl, type RunFile } from "../../lib/run-files";

export default function RunFiles({ fleetId, files }: { fleetId: string; files: RunFile[] }) {
	if (files.length === 0) return null;
	return (
		<div className="rounded border border-ink-200 bg-card p-2">
			<div className="mb-1 text-micro font-medium text-ink-700">Files · {filesLabel(files.length)}</div>
			<ul className="divide-y divide-ink-100">
				{files.map((f) => {
					const url = runFileUrl(ME_BASE, fleetId, f.path);
					const Icon = f.kind === "image" ? ImageIcon : f.kind === "text" || f.kind === "data" ? FileText : FileIcon;
					return (
						<li key={f.path} className="flex items-center gap-2 py-1 text-micro text-ink-800">
							{f.kind === "image" ? (
								<img src={url} alt={f.name} loading="lazy" className="h-8 w-8 rounded border border-ink-200 object-cover" />
							) : (
								<Icon size={14} className="text-ink-600" />
							)}
							<span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
							<a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-700 hover:text-ink-900">
								<ExternalLink size={12} /> Open
							</a>
							<a href={url} download={f.name} className="inline-flex items-center gap-1 text-ink-700 hover:text-ink-900">
								<Download size={12} /> Download
							</a>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
