// KeyPicker — lets the user say WHICH credential the GPU Rentals app
// acts with on FlowMesh (operator request 2026-06-12: the 403 class of
// bug came from the app deciding implicitly).
//
//   ◉ This session — short-lived bearer minted from the login, scoped
//     to the rental lifecycle. The right default for everyone.
//   ○ Custom key  — a pasted lm_pat_… / rm_pat_… / flm-… key, e.g. to
//     attribute rentals to a specific PAT or drive a self-hosted fleet.
//     Stored only in this browser; sent only to the FlowMesh bridge.

import { useState } from "react";
import { KeyRound, Check } from "lucide-react";
import { getFlowmeshCustomKey, setFlowmeshCustomKey, flowmeshKeyLabel } from "@/api/flowmesh";

export default function KeyPicker() {
	const [custom, setCustom] = useState<string | null>(() => getFlowmeshCustomKey());
	const [draft, setDraft] = useState("");
	const [editing, setEditing] = useState(false);
	const useSession = !custom;

	const pinDraft = () => {
		const k = draft.trim();
		if (!k) return;
		setFlowmeshCustomKey(k);
		setCustom(k);
		setDraft("");
		setEditing(false);
	};
	const clear = () => {
		setFlowmeshCustomKey(null);
		setCustom(null);
		setEditing(false);
	};

	return (
		<div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 space-y-1.5">
			<div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
				<KeyRound className="w-3 h-3" />
				Runs as
				<span className="font-mono text-slate-700">{flowmeshKeyLabel()}</span>
			</div>
			<div className="flex items-center gap-3 text-[11.5px]">
				<label className="inline-flex items-center gap-1.5 cursor-pointer">
					<input type="radio" checked={useSession} onChange={clear} className="accent-emerald-600" />
					<span className="text-slate-700">This session</span>
					<span className="text-slate-400">(recommended)</span>
				</label>
				<label className="inline-flex items-center gap-1.5 cursor-pointer">
					<input
						type="radio"
						checked={!useSession}
						onChange={() => setEditing(true)}
						className="accent-emerald-600"
					/>
					<span className="text-slate-700">Custom key</span>
				</label>
			</div>
			{(editing || (!useSession && !editing)) && (
				<div className="flex items-center gap-1.5">
					{editing ? (
						<>
							<input
								type="password"
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								placeholder="lm_pat_… / flm-…"
								className="flex-1 px-2 py-1 text-[11.5px] font-mono rounded-md border border-slate-200 bg-white focus:outline-none focus:border-emerald-300"
								autoFocus
							/>
							<button
								type="button"
								onClick={pinDraft}
								disabled={!draft.trim()}
								className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-700 transition-colors"
							>
								<Check className="w-3 h-3" />Use
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setEditing(true)}
							className="text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2"
						>
							replace key
						</button>
					)}
				</div>
			)}
			<p className="text-[10px] text-slate-400 leading-relaxed">
				Custom keys stay in this browser and go only to FlowMesh. A key
				needs workflow write access — mint one at lum.id → Tokens with the
				<span className="font-mono"> flowmesh/write</span> scope.
			</p>
		</div>
	);
}
