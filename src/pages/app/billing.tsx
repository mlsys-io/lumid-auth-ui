// /studio/account/billing — the Runmesh wallet (a verbatim port) beside what
// the account's research actually used.
//
// The wallet alone told a student "$0.00 · approx. 0 hours of RTX 4090" and
// "No usage records" after 56 of 168 GPU-minutes on office RTX 5080s
// (2026-11-28 sweep): research runs on lum.id's own machines and never touches
// that balance. The card below reads identity's GET /me/usage per installed
// app and says device-minutes first; dollars only for real money (model calls
// at list price). Words come from lib/research-usage.ts.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Gauge } from "lucide-react";
import { Billing } from "@/runmesh/pages/user/Billing";
import { me } from "@/api/me";
import { appTitle } from "@/components/workflow/AppCard";
import { NO_RESEARCH_USAGE, OWNED_MACHINES_NOTE, appUsageRows, gpuTodayLine, type AppUsageRow } from "@/lib/research-usage";
import type { MeUsage } from "@/lib/spend";
import { cn } from "@/lib/utils";

/** Apps read per visit (one small GET each). */
const MAX_APPS = 12;

function useResearchUsage(): { rows: AppUsageRow[]; today: string | null } | null {
	const [state, setState] = useState<{ rows: AppUsageRow[]; today: string | null } | null>(null);
	useEffect(() => {
		let live = true;
		(async () => {
			const [apps, account] = await Promise.all([
				me.listApps().then((r) => (r.apps ?? []).map((a) => a.name).filter(Boolean)).catch(() => [] as string[]),
				me.usage().catch(() => null as MeUsage | null),
			]);
			const perApp = await Promise.all(
				apps.slice(0, MAX_APPS).map(async (app) => ({ app, usage: await me.usage(app).catch(() => null) })),
			);
			if (live) setState({ rows: appUsageRows(perApp), today: gpuTodayLine(account) });
		})();
		return () => { live = false; };
	}, []);
	return state;
}

function ResearchUsageCard() {
	const u = useResearchUsage();
	return (
		<section aria-label="What your research used" data-testid="research-usage"
			className="flex flex-col rounded-xl border border-ink-200 bg-card p-6 shadow-e1">
			<h3 className="eyebrow mb-3 text-ink-600">What your research used</h3>
			{u === null ? (
				<div className="space-y-2" role="status" aria-label="Loading">
					<div className="lumen-skeleton h-4 w-3/4 rounded" />
					<div className="lumen-skeleton h-1.5 w-full rounded-full" />
					<div className="lumen-skeleton h-3 w-1/2 rounded" />
				</div>
			) : u.rows.length === 0 ? (
				<p className="text-meta text-ink-600">{NO_RESEARCH_USAGE}</p>
			) : (
				<ul className="space-y-3">
					{u.rows.map((r) => (
						<li key={r.app} className="space-y-1">
							<div className="flex items-baseline justify-between gap-2">
								<span className="truncate text-body font-medium text-ink-900">{appTitle(r.app)}</span>
								<span className="shrink-0 text-micro text-ink-600">{r.runs}</span>
							</div>
							{r.share != null && (
								<div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100" role="meter"
									aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.share * 100)} aria-label={r.line}>
									<div className={cn("h-full rounded-full", r.over ? "bg-brick-500" : r.low ? "bg-ember-500" : "bg-gold-500")}
										style={{ width: `${Math.max(2, r.share * 100)}%` }} />
								</div>
							)}
							<p className={cn("flex items-start gap-1 text-caption", r.over ? "text-brick-700" : r.low ? "text-ember-700" : "text-ink-700")}>
								{r.share != null && <Gauge className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
								<span>{r.line}</span>
							</p>
							{r.detail && <p className="text-caption text-ink-600">{r.detail}</p>}
							{r.money && <p className="text-caption text-ink-700">{r.money}</p>}
						</li>
					))}
				</ul>
			)}
			{u?.today && <p className="mt-3 text-caption text-ink-600">{u.today}</p>}
			<p className="mt-3 text-caption text-ink-600">{OWNED_MACHINES_NOTE}</p>
			<Link to="/studio/runs" className="mt-auto inline-flex items-center gap-1 pt-3 text-caption font-medium text-plum-700 hover:underline">
				See every run in Activity <ArrowRight className="h-3 w-3" aria-hidden />
			</Link>
		</section>
	);
}

export default function AppBilling() {
	return <Billing aside={<ResearchUsageCard />} />;
}
