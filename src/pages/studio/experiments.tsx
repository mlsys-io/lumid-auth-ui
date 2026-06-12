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
import { ExperimentCard } from "@/components/experiments/ExperimentsPanel";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSection } from "@/components/ui/page-section";
import PageHints from "@/components/PageHints";
import AskAbout from "@/components/AskAbout";
import { cn } from "@/lib/utils";

type Row = MeExperiment & { app: string };

export default function StudioExperiments() {
	const [rows, setRows] = useState<Row[] | null>(null);
	const [filter, setFilter] = useState<"all" | "decided" | "running">("all");

	useEffect(() => {
		me.experimentsAll().then((r) => setRows((r.experiments || []) as Row[])).catch(() => setRows([]));
	}, []);

	const filtered = useMemo(() => {
		if (!rows) return null;
		if (filter === "decided") return rows.filter((r) => r.criteria_met);
		if (filter === "running") return rows.filter((r) => !r.criteria_met && r.n_results > 0);
		return rows;
	}, [rows, filter]);

	return (
		<div className="space-y-5">
			<PageHints prompts={[
				"Which experiments have a winning variant?",
				"Summarize what my experiments learned this week",
			]} />

			<PageSection
				title={`Experiments (${rows?.length ?? "…"})`}
				aside={
					<div className="flex items-center gap-1">
						{(["all", "decided", "running"] as const).map((f) => (
							<button
								key={f}
								onClick={() => setFilter(f)}
								className={cn(
									"px-2 py-0.5 text-[11px] rounded-full border transition-colors",
									filter === f
										? "border-violet-300 bg-violet-50 text-violet-800"
										: "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
								)}
							>
								{f}
							</button>
						))}
					</div>
				}
			>
				{filtered === null ? (
					<div className="space-y-2">
						<div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
						<div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
					</div>
				) : filtered.length === 0 ? (
					<EmptyState
						icon={FlaskConical}
						title="No experiments yet"
						body="Apps declare experiments (hypothesis × variants × a metric) in their manifests; results accumulate as workflows run. Decided experiments show their verdict here."
						actionLabel="Ask what experiments could help my apps"
						ask="Look at my installed apps and suggest experiments (hypothesis + variants + metric) that would improve them."
					/>
				) : (
					<ul className="space-y-3">
						{filtered.map((e) => (
							<li key={`${e.app}:${e.id}`} className="relative">
								<ExperimentCard app={e.app} e={e} showApp />
								<div className="absolute top-3 right-3">
									<AskAbout
										prompt={`Explain the "${e.id}" experiment in ${e.app}: the hypothesis, how the variants compare so far, and whether I should adopt the winner.`}
										context={{ app: e.app, selection: { kind: "experiment", id: `${e.app}:${e.id}`, label: e.id } }}
										label="Ask"
									/>
								</div>
							</li>
						))}
					</ul>
				)}
			</PageSection>
		</div>
	);
}
