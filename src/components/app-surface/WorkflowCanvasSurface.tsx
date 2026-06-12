// WorkflowCanvasSurface — the `workflow-canvas` native surface: a full
// observe-mode pipeline canvas for one of the app's workflows, with the
// step inspector. Config: { loop: string, cycle?: "latest" }.
// App identity comes from the /studio/a/:app route.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { me, type LoopDefinition, type MeCycleDetail } from "@/api/me";
import apiClient from "@/api/client";
import WorkflowCanvas, { type CanvasStepRef } from "@/components/workflow/WorkflowCanvas";
import StepInspectorPanel from "@/components/workflow/StepInspectorPanel";
import type { NativeSurfaceProps } from "./native-registry";

export default function WorkflowCanvasSurface({ config }: NativeSurfaceProps) {
	const { app = "" } = useParams();
	const loop = String(config?.loop ?? "");
	const wantLatest = String(config?.cycle ?? "latest") === "latest";
	const [def, setDef] = useState<LoopDefinition | null>(null);
	const [cycle, setCycle] = useState<MeCycleDetail | null>(null);
	const [ts, setTs] = useState<string | undefined>(undefined);
	const [step, setStep] = useState<CanvasStepRef | null>(null);

	useEffect(() => {
		if (!app || !loop) return;
		let live = true;
		me.workflowDetail(`${app}:${loop}`)
			.then((r) => { if (live) setDef((r.definition || null) as LoopDefinition | null); })
			.catch(() => { /* renders the missing-config line below */ });
		if (wantLatest) {
			apiClient.get(`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=1`)
				.then((l: any) => {
					const t = l.data?.data?.cycles?.[0]?.ts;
					if (!t || !live) return;
					setTs(t);
					return apiClient.get(`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(t)}`)
						.then((r: any) => { if (live) setCycle((r.data?.data ?? null) as MeCycleDetail | null); });
				})
				.catch(() => { /* structure-only */ });
		}
		return () => { live = false; };
	}, [app, loop, wantLatest]);

	if (!loop) return <div className="text-sm text-slate-500 italic">workflow-canvas needs a `loop` in its config.</div>;
	if (!def) return <div className="text-sm text-slate-400 italic">Loading pipeline…</div>;
	return (
		<div className="space-y-2">
			<WorkflowCanvas definition={def} cycle={cycle} onStepSelect={setStep} />
			{step && (
				<StepInspectorPanel step={step} app={app} loop={loop} ts={ts} onClose={() => setStep(null)} />
			)}
		</div>
	);
}
