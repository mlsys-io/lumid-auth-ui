// ArtifactCard — inline render of a saved artifact in the chat thread.
//
// When the agent calls save_artifact (e.g. after "plot it"), the tool result
// carries only {id, kind, title} — the content lives server-side. This card
// fetches the full artifact by id (same endpoint the side panel uses) and
// renders it with ArtifactView, so a chart/table/vega appears RIGHT HERE in
// the conversation instead of only in the side drawer. Falls back to a quiet
// "saved to artifacts" note if the fetch fails or the id is missing.

import { useEffect, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { ArtifactView, type ArtifactKind } from '../ArtifactView';

type SavedArtifact = {
	id: string;
	kind: ArtifactKind;
	title: string;
	content: string;
	language?: string;
};

async function fetchArtifact(id: string): Promise<SavedArtifact | null> {
	try {
		const r = await fetch('/api/v1/me/artifacts/' + encodeURIComponent(id), { credentials: 'include' });
		if (!r.ok) return null;
		const j = await r.json();
		const a = j?.data;
		if (!a || typeof a.content !== 'string') return null;
		return a as SavedArtifact;
	} catch {
		return null;
	}
}

export function ArtifactCard({ id, title }: { id: string; title?: string }) {
	const [art, setArt] = useState<SavedArtifact | null>(null);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		let live = true;
		setArt(null);
		setMissing(false);
		fetchArtifact(id).then((a) => {
			if (!live) return;
			if (a) setArt(a);
			else setMissing(true);
		});
		return () => { live = false; };
	}, [id]);

	if (missing) {
		return (
			<div className="max-w-md rounded-xl border border-border bg-card shadow-sm px-3 py-2 text-[12px] text-muted-foreground">
				Saved to artifacts{title ? ` — “${title}”` : ''}. Open the Artifacts panel to view it.
			</div>
		);
	}
	if (!art) {
		return (
			<div className="max-w-md rounded-xl border border-border bg-card shadow-sm px-3 py-2 text-[12px] text-muted-foreground flex items-center gap-2">
				<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading artifact…
			</div>
		);
	}

	return (
		<div className="max-w-lg rounded-xl border border-border bg-card shadow-sm overflow-hidden">
			<div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
				<span className="text-[11px] font-medium text-foreground/70 truncate flex-1">{art.title || title || 'Artifact'}</span>
				<a
					href="/studio"
					title="Open in Artifacts panel"
					className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
				>
					<ExternalLink className="w-3.5 h-3.5" />
				</a>
			</div>
			<div className="px-3 pb-3">
				<ArtifactView kind={art.kind} content={art.content} title={art.title} language={art.language} />
			</div>
		</div>
	);
}
