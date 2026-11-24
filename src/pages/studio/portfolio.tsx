// Fleet totals for /studio/apps/all — the 30-day rollup from GET /me/portfolio.
//
// This used to be a full page (/studio/portfolio, now a redirect) with a
// per-workflow table and a "learning velocity" column. The table listed the
// same apps the index below it already lists, and the velocity bars were
// almost always empty, so both went (2026-11). What stays: the fleet totals,
// each shown only when it isn't zero, and each app's 30-day cost, which
// apps.tsx folds into that app's index row.

import { useContext } from "react";
import { Boxes, Activity, DollarSign, Brain, Cpu, AlertTriangle } from "lucide-react";
import type { Portfolio, PortfolioTotals } from "@/api/portfolio";
import { AuthContext } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function fmtUSD(v: number): string {
	if (!v) return "$0";
	if (v < 0.01) return "<$0.01";
	if (v < 100) return `$${v.toFixed(2)}`;
	return `$${Math.round(v).toLocaleString()}`;
}

function fmtCompact(v: number): string {
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
	return `${Math.round(v)}`;
}

/** app slug → summed 30-day cost across its workflows. */
export function costByApp(p: Portfolio | null): Map<string, number> {
	const m = new Map<string, number>();
	for (const w of p?.workflows || []) m.set(w.app, (m.get(w.app) || 0) + (w.cost_usd_30d || 0));
	return m;
}

type Tile = {
	key: string;
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
	tone?: string;
};

export function FleetTotals({ totals }: { totals: PortfolioTotals }) {
	const auth = useContext(AuthContext);
	const role = auth?.user?.role;
	const isAdmin = role === "admin" || role === "super_admin";

	const tiles: Tile[] = [];
	if (totals.workflows > 0) tiles.push({ key: "wf", icon: Boxes, label: "workflows", value: `${totals.workflows}` });
	if (totals.healthy > 0) tiles.push({ key: "ok", icon: Activity, label: "healthy", value: `${totals.healthy}`, tone: "text-gold-600" });
	if (totals.needs_attention > 0) tiles.push({ key: "att", icon: AlertTriangle, label: "need attention", value: `${totals.needs_attention}`, tone: "text-brick-600" });
	if (totals.cost_usd_30d > 0) tiles.push({ key: "cost", icon: DollarSign, label: "spent in 30 days", value: fmtUSD(totals.cost_usd_30d) });
	if (totals.learned_30d > 0) tiles.push({ key: "kn", icon: Brain, label: "learned in 30 days", value: `${totals.learned_30d}`, tone: "text-plum-600" });
	// Token counts are an engineer detail: admins only.
	if (isAdmin && totals.total_tokens_30d > 0) tiles.push({ key: "tok", icon: Cpu, label: "tokens in 30 days", value: fmtCompact(totals.total_tokens_30d) });

	if (tiles.length === 0) return null;
	return (
		<div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
			{tiles.map(({ key, icon: Icon, label, value, tone }) => (
				<div key={key} className="rounded-xl border border-ink-200 bg-card px-3 py-2.5 sm:flex-1 sm:min-w-[120px]">
					<div className="flex items-center gap-1.5 text-micro text-ink-600">
						<Icon className={cn("w-3.5 h-3.5", tone ?? "text-ink-600")} />
						<span className="truncate">{label}</span>
					</div>
					<div className="text-title font-semibold text-ink-900 tabular-nums mt-0.5">{value}</div>
				</div>
			))}
		</div>
	);
}
