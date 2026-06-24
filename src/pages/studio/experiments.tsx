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
	//
	// Forks inherit the parent app's experiments[], so the same experiment id
	// (e.g. "ai_minds") recurs across every fork you've installed — producing
	// rows that read identically apart from the faint app section header.
	// Disambiguate: when an id appears under more than one app, show the app
	// inline in the title ("ai_minds · my-fork") so forks read distinctly.
	const idCounts = new Map<string, number>();
	for (const e of filtered) idCounts.set(e.id, (idCounts.get(e.id) ?? 0) + 1);
	const indexRows: IndexRow[] = filtered.map((e) => {
		const tone: ToneKey = e.criteria_met ? "ok" : e.n_results > 0 ? "running" : "idle";
		const statusLabel = e.criteria_met ? (e.verdict || "decided") : e.n_results > 0 ? `${e.n_results} results` : "pending";
		const ambiguous = (idCounts.get(e.id) ?? 0) > 1;
		return {
			id: `${e.app}:${e.id}`,
			title: ambiguous ? `${e.id} · ${appTitle(e.app)}` : e.id,
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
			empty="Agents declare experiments (hypothesis × variants × a metric); results accumulate as workflows run. Ask what experiments could help your agents."
		/>
	);
}
