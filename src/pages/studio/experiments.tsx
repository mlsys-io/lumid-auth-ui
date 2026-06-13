// /studio/experiments — cross-app experiments (Workstream F).
//
// Experiments are inherently cross-app ("which hypotheses are winning
// anywhere?"), so they get a top-level destination; the per-app native
// tab (app-experiments) stays as the drill-in. Cards reuse the same
// ExperimentCard the per-app panel renders, plus an app chip + chat
// affordance with structured grounding.

import { useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { me, type MeExperiment } from "@/api/me";
import IndexList, { type IndexRow } from "@/components/studio/IndexList";
import { askExperiment } from "@/lib/grounded-asks";
import { appTitle } from "@/components/workflow/AppCard";
import { type ToneKey } from "@/lib/tones";
import { cn } from "@/lib/utils";

type Row = MeExperiment & { app: string };

export default function StudioExperiments() {
	const [rows, setRows] = useState<Row[] | null>(null);
	const [filter, setFilter] = useState<"all" | "decided" | "running">("all");

	useEffect(() => {
		me.experimentsAll().then((r) => setRows((r.experiments || []) as Row[])).catch(() => setRows([]));
	}, []);

	const filtered = useMemo(() => {
		if (!rows) return [];
		if (filter === "decided") return rows.filter((r) => r.criteria_met);
		if (filter === "running") return rows.filter((r) => !r.criteria_met && r.n_results > 0);
		return rows;
	}, [rows, filter]);

	// One row per experiment, grouped by app — clicking opens the grounded
	// chat (the hypothesis + variant comparison live in the conversation).
	const indexRows: IndexRow[] = filtered.map((e) => {
		const tone: ToneKey = e.criteria_met ? "ok" : e.n_results > 0 ? "running" : "idle";
		const statusLabel = e.criteria_met ? (e.verdict || "decided") : e.n_results > 0 ? `${e.n_results} results` : "pending";
		return {
			id: `${e.app}:${e.id}`,
			title: e.id,
			icon: FlaskConical,
			tone, statusLabel,
			meta: e.hypothesis,
			section: appTitle(e.app),
			ask: askExperiment(e.app, `${e.app}:${e.id}`, e.id),
		} as IndexRow;
	});

	const toolbar = (
		<div className="flex items-center gap-1">
			{(["all", "decided", "running"] as const).map((f) => (
				<button
					key={f}
					onClick={() => setFilter(f)}
					className={cn(
						"px-2.5 py-1 text-[11px] rounded-full border transition-colors",
						filter === f
							? "border-foreground/25 bg-muted text-foreground"
							: "border-border bg-card text-muted-foreground hover:bg-muted",
					)}
				>
					{f}
				</button>
			))}
		</div>
	);

	return (
		<IndexList
			title="Experiments"
			rows={indexRows}
			search={indexRows.length > 6}
			searchPlaceholder="Search experiments…"
			toolbar={toolbar}
			empty="Apps declare experiments (hypothesis × variants × a metric); results accumulate as workflows run. Ask what experiments could help your apps."
		/>
	);
}
