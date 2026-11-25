// The pictures a run produced, shown in Research Fleet → Your runs.
//
// Each file is fetched with the caller's FlowMesh bearer (api/fm.ts
// resultFileObjectUrl) — results are per-user, so a plain <img src> would 401.
// Words and file paths come from lib/run-images.ts.

import { useEffect, useState } from "react";
import { resultFileObjectUrl } from "../../api/fm";
import { imageFilePath, picturesLabel, type RunImage } from "../../lib/run-images";

/** Show at most this many thumbnails; the rest are counted, not hidden silently. */
const MAX_THUMBS = 24;

export default function ResultImages({ images }: { images: RunImage[] }) {
	const shown = images.slice(0, MAX_THUMBS);
	const [urls, setUrls] = useState<Record<string, string | null>>({});
	const [big, setBig] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		const made: string[] = [];
		for (const img of shown) {
			const key = `${img.taskId}/${img.path}`;
			resultFileObjectUrl(imageFilePath(img))
				.then((u) => {
					made.push(u);
					if (live) setUrls((m) => ({ ...m, [key]: u }));
					else URL.revokeObjectURL(u);
				})
				.catch(() => live && setUrls((m) => ({ ...m, [key]: null })));
		}
		return () => {
			live = false;
			made.forEach((u) => URL.revokeObjectURL(u));
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shown.map((i) => `${i.taskId}/${i.path}`).join("|")]);

	if (images.length === 0) return null;
	return (
		<div className="mb-2">
			<div className="mb-1 text-micro text-ink-600">
				{picturesLabel(images.length)}
				{images.length > shown.length && ` · showing the first ${shown.length}`}
			</div>
			<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
				{shown.map((img) => {
					const key = `${img.taskId}/${img.path}`;
					const u = urls[key];
					return (
						<button
							key={key}
							type="button"
							onClick={() => u && setBig(u)}
							className="aspect-square overflow-hidden rounded border border-ink-200 bg-card"
							title={img.name}
						>
							{u ? (
								<img src={u} alt={img.name} className="h-full w-full object-cover" />
							) : (
								<span className="flex h-full items-center justify-center p-1 text-nano text-ink-600">
									{u === null ? "Couldn't load" : "Loading…"}
								</span>
							)}
						</button>
					);
				})}
			</div>
			{big && (
				<div
					role="dialog"
					aria-label="Picture"
					onClick={() => setBig(null)}
					className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4"
				>
					<img src={big} alt="" className="max-h-full max-w-full rounded" />
				</div>
			)}
		</div>
	);
}
