// ExperimentSpend — the experiment panel's "what did it cost, was it worth
// it, and can the cheap step be trusted?" block, under the evidence grid:
//
//   Results for what it cost   (ProgressPerSpend)
//   Does Simulator predict Sandbox?   (StepAgreement)
//   Budget: 38 of 168 GPU-min used · …   (SpendLine)
//
// Generic: reads the experiment's ledger rows and the app's /me/usage.
// Renders nothing until some result has landed.

import { useCallback, useEffect, useState } from "react";
import { me, type MeExperiment, type MeExperimentRow } from "@/api/me";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { humanId, versionsOf } from "@/lib/research-map";
import ProgressPerSpend from "./ProgressPerSpend";
import SpendLine from "./SpendLine";
import { DiscardedList } from "./DiscardResults";
import StepAgreement from "./StepAgreement";

export function useExperimentRows(app: string, id: string): MeExperimentRow[] | null {
	const [rows, setRows] = useState<MeExperimentRow[] | null>(null);
	const load = useCallback(() => {
		let live = true;
		me.experiment(app, id).then((d) => { if (live) setRows(d.results || []); }).catch(() => { if (live) setRows((r) => r ?? []); });
		return () => { live = false; };
	}, [app, id]);
	useEffect(() => load(), [load]);
	useStudioRefetch(["experiments", "runs"], () => { load(); });
	return rows;
}

export default function ExperimentSpend({ app, e, steps, rows: given }: {
	app: string;
	e: MeExperiment;
	steps: EvidenceStepSpec[];
	/** Pass rows you already read; otherwise they are read here. */
	rows?: MeExperimentRow[] | null;
}) {
	const own = useExperimentRows(app, e.id);
	const rows = given === undefined ? own : given;
	const labels = new Map(versionsOf(e).map((v) => [v.id, v.label]));
	const label = (v: string) => labels.get(v) || humanId(v);
	const metric = e.metric?.name || e.metric_name || "";
	const hib = !(e.higher_is_better === false || e.metric?.higher_is_better === false);
	if (!rows || !rows.length) return <SpendLine app={app} className="pt-1" />;
	return (
		<div className="space-y-5" data-testid="experiment-spend">
			{metric && <ProgressPerSpend steps={steps} rows={rows} metric={metric} higherIsBetter={hib} label={label} />}
			<StepAgreement steps={steps} rows={rows} label={label} />
			<SpendLine app={app} rows={rows} />
			<DiscardedList app={app} experiment={e.id} rows={rows} label={label} />
		</div>
	);
}
