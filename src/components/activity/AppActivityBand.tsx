// AppActivityBand — the top of an app's home: what this app is running now and
// which of its workflows are failing, so a run is always seen next to the app
// that owns it. Renders NOTHING when nothing is running or failing — a healthy
// app's page stays the app's page. "All activity" opens /studio/runs?app=.

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { groupActivity } from "@/lib/activity";
import { ActivityView, NeedsFixingRow } from "./ActivityView";
import { useRunsFeed } from "./hooks";

const DAYS = 7;

export default function AppActivityBand({ app, failingOnly = false }: { app: string; failingOnly?: boolean }) {
	const { runs, asOf, truncated } = useRunsFeed(DAYS);
	if (!runs) return null;
	const act = groupActivity(runs, { app });
	if ((failingOnly || act.running.length === 0) && act.failing.length === 0) return null;
	if (failingOnly) {
		// The app's home: one line per broken workflow, above the app's own page.
		return (
			<section aria-label="Needs fixing" className="mb-3 space-y-1.5">
				<div className="flex items-baseline gap-2">
					<h2 className="eyebrow text-brick-700">Needs fixing · {act.failing.length}</h2>
					<Link to={`/studio/runs?app=${encodeURIComponent(app)}`} className="ml-auto inline-flex items-center gap-1 text-micro text-ink-700 hover:text-ink-900 hover:underline">
						All activity <ArrowRight className="w-3 h-3" />
					</Link>
				</div>
				{act.failing.map((wf) => <NeedsFixingRow key={wf.key} wf={wf} showApp={false} span={`in the last ${DAYS} days`} dense />)}
			</section>
		);
	}
	return (
		<div className="mb-5 space-y-2">
			<ActivityView runs={runs} app={app} days={DAYS} compact asOf={asOf} truncated={truncated} skipRunning={failingOnly} />
			<Link
				to={`/studio/runs?app=${encodeURIComponent(app)}`}
				className="inline-flex items-center gap-1 text-meta text-ink-700 hover:text-ink-900 hover:underline"
			>
				All activity for this app <ArrowRight className="w-3.5 h-3.5" />
			</Link>
		</div>
	);
}
