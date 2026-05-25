// N8nEditor — embed n8n's editor inside Studio (W2).
//
// v1 ships the iframe + a top bar with hint copy. SSO bridge (so the
// user doesn't sign into n8n separately) is a follow-up patch on the
// flowmesh-n8n fork — until then, the first time the user opens this
// dialog they'll see n8n's own login screen. Once they sign in, the
// session cookie persists at the /n8n/ path scope and subsequent
// opens go straight to the editor.
//
// The iframe URL is path-relative so it works through whatever proxy
// is in front of Studio (lum.id nginx serves /n8n/* through to the
// flowmesh-n8n container; see infra/compose/lumid_landing_readdy/
// nginx.conf for the rules).

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Info } from "lucide-react";

interface Props {
	onClose: () => void;
	/** Pre-fill an n8n workflow id to open directly (W2 follow-up). */
	workflowId?: string;
}

export function N8nEditor({ workflowId }: Props) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [loaded, setLoaded] = useState(false);
	const src = workflowId
		? `/n8n/workflow/${encodeURIComponent(workflowId)}`
		: "/n8n/workflow/new";

	useEffect(() => {
		const t = setTimeout(() => setLoaded(true), 3000);
		return () => clearTimeout(t);
	}, []);

	return (
		<div className="space-y-3">
			<div className="rounded-lg bg-emerald-50/60 border border-emerald-200/70 px-3 py-2 text-xs text-emerald-900 flex items-start gap-2">
				<Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
				<div>
					<div className="font-medium mb-0.5">Visual editor — opt-in for now</div>
					<div className="leading-relaxed">
						First time? Sign into n8n with the same email you use here. Studio will remember it for next time. We&apos;re wiring the auto-sign-in bridge in a follow-up.
					</div>
				</div>
			</div>

			<div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 relative" style={{ height: "60vh" }}>
				{!loaded && (
					<div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
						Loading n8n editor…
					</div>
				)}
				<iframe
					ref={iframeRef}
					src={src}
					title="n8n workflow editor"
					className="w-full h-full"
					onLoad={() => setLoaded(true)}
					sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
				/>
			</div>

			<div className="flex items-center justify-between text-xs text-slate-500">
				<span>Open in full window to debug auth issues:</span>
				<a
					href={src}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 underline"
				>
					Open in new tab <ExternalLink className="w-3 h-3" />
				</a>
			</div>
		</div>
	);
}

export default N8nEditor;
