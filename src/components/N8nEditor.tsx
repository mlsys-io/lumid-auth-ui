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
import { ExternalLink, Info, ArrowRightCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";

interface Props {
	onClose: () => void;
	/** Pre-fill an n8n workflow id to open directly (W2 follow-up). */
	workflowId?: string;
}

export function N8nEditor({ workflowId }: Props) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [loaded, setLoaded] = useState(false);
	const [promoteId, setPromoteId] = useState("");
	const [promoting, setPromoting] = useState(false);
	const src = workflowId
		? `/n8n/workflow/${encodeURIComponent(workflowId)}`
		: "/n8n/workflow/new";

	useEffect(() => {
		const t = setTimeout(() => setLoaded(true), 3000);
		return () => clearTimeout(t);
	}, []);

	const promoteToScheduled = async () => {
		const id = promoteId.trim();
		if (!id) {
			toast.info("Paste the n8n workflow id (visible in the editor URL) first.");
			return;
		}
		setPromoting(true);
		try {
			const r = await fetch("/api/v1/me/workflows/import-from-n8n", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ n8n_id: id }),
			});
			if (!r.ok) throw new Error(`status ${r.status}`);
			const body = await r.json();
			if (body.ret_code !== 0) throw new Error(body.message || "promote failed");
			toast.success(`Promoted to draft "${body.data.draft_slug}".`);
			if (body.data.unsupported_nodes?.length > 0) {
				toast.info(`${body.data.unsupported_nodes.length} node(s) need manual mapping in the YAML.`);
			}
		} catch (e) {
			toast.error(`Promote failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setPromoting(false);
		}
	};

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

			<div className="flex items-center gap-3 text-xs text-slate-500 border-t border-slate-100 pt-3">
				<input
					value={promoteId}
					onChange={(e) => setPromoteId(e.target.value)}
					placeholder="paste n8n workflow id to promote"
					className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400/30 font-mono"
				/>
				<button
					onClick={promoteToScheduled}
					disabled={promoting || !promoteId.trim()}
					title="Translate this n8n workflow into a scheduled xpio workflow (best-effort)."
					className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-emerald-700 hover:bg-emerald-50 border border-emerald-200 disabled:opacity-40 transition-colors"
				>
					{promoting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightCircle className="w-3 h-3" />}
					Promote to scheduled
				</button>
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
