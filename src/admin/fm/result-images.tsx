// The pictures a run produced, shown in Research Fleet → Your runs.
//
// Each file is fetched with the caller's FlowMesh bearer (api/fm.ts
// resultFileObjectUrl) — results are per-user, so a plain <img src> would 401.
// Words and file paths come from lib/run-images.ts and lib/fleet-result.ts.
//
// The enlarged picture is portaled to document.body: inside the panel, a
// transformed ancestor made `fixed` relative to it, so the overlay stopped at
// the sidebar's edge.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { resultFileObjectUrl } from "../../api/fm";
import type { PicturesContext } from "../../lib/fleet-result";
import { imageFilePath, picturesLabel, type RunImage } from "../../lib/run-images";

/** Show at most this many thumbnails; the rest are counted, not hidden silently. */
const MAX_THUMBS = 24;

export default function ResultImages({ images, context }: { images: RunImage[]; context?: PicturesContext | null }) {
	const shown = images.slice(0, MAX_THUMBS);
	const [urls, setUrls] = useState<Record<string, string | null>>({});
	const [big, setBig] = useState<{ url: string; name: string } | null>(null);

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
			{context && <PicturesCaption context={context} />}
			<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
				{shown.map((img) => {
					const key = `${img.taskId}/${img.path}`;
					const u = urls[key];
					return (
						<button
							key={key}
							type="button"
							onClick={() => u && setBig({ url: u, name: img.name })}
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
			{big && <Lightbox url={big.url} name={big.name} context={context} onClose={() => setBig(null)} />}
		</div>
	);
}

/** The model and prompt that made the pictures, when the result names them. */
function PicturesCaption({ context }: { context: PicturesContext }) {
	return (
		<dl className="mb-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-micro">
			{context.model && (
				<>
					<dt className="text-ink-600">Model</dt>
					<dd className="font-mono text-ink-800">{context.model}</dd>
				</>
			)}
			{context.prompt && (
				<>
					<dt className="text-ink-600">Prompt</dt>
					<dd className="whitespace-pre-wrap text-ink-800">{context.prompt}</dd>
				</>
			)}
		</dl>
	);
}

/** One picture, full screen: a close button, Escape, or a click outside the picture closes it. */
function Lightbox({ url, name, context, onClose }: {
	url: string;
	name: string;
	context?: PicturesContext | null;
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	// The parent re-renders as thumbnails load; keep the latest onClose without
	// re-running the effect (which would steal and restore focus each time).
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useEffect(() => {
		const before = document.activeElement as HTMLElement | null;
		closeRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onCloseRef.current();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			before?.focus?.();
		};
	}, []);

	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-label={name}
			onClick={onClose}
			className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-2 bg-ink-900/80 p-4"
		>
			<button
				ref={closeRef}
				type="button"
				onClick={onClose}
				aria-label="Close picture"
				className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-card px-2.5 py-1.5 text-meta text-ink-800 shadow-e2 hover:bg-ink-50"
			>
				<X className="h-4 w-4" />
				Close
			</button>
			<img
				src={url}
				alt={name}
				onClick={(e) => e.stopPropagation()}
				className="max-h-[calc(100vh-7rem)] max-w-full rounded"
			/>
			{(context?.model || context?.prompt) && (
				<p onClick={(e) => e.stopPropagation()} className="max-w-2xl rounded bg-card px-3 py-1.5 text-center text-micro text-ink-800">
					{[context.prompt, context.model].filter(Boolean).join(" · ")}
				</p>
			)}
		</div>,
		document.body,
	);
}
