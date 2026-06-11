// Surface embeds — the thin first-party "escape hatch" components that a
// lumid-market config surface (ui/*.md) references via `lumid:native`.
//
// Everything that CAN be a declarative directive (tables, charts, stats, forms,
// links) lives in the surface markdown. These wrappers exist only for the few
// genuinely interactive widgets the directive set can't express:
//   • the click-to-sort leaderboard          → quant-leaderboard
//   • the live-polling activity feed          → quant-activity
//   • the multi-step "Create with AI" wizard  → quant-ai-wizard
//   • the in-competition strategy inspector   → quant-my-strategy / quant-strategy-detail
//
// Each adapts the directive `config` (string-valued, interpolated from URL
// params) to the underlying component's props. competitionId/strategyId are
// read from the route (useParams) where the component already does so.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "./components/ui/button";
import { Sparkles } from "lucide-react";
import LeaderboardUser from "./pages/competition/detail/leaderboard-user";
import ActivityFeed from "./pages/competition/detail/activity-feed";
import AIStrategyWizard from "./pages/strategy/ai-strategy-wizard";
import MyStrategyDetail from "./pages/competition/detail/my-strategy-detail";
import CommonStrategyDetail from "./pages/competition/detail/common-strategy-detail";

type Cfg = { config?: Record<string, unknown> };

function compId(config?: Record<string, unknown>): number {
  const fromCfg = config?.competition_id ?? config?.competitionId;
  if (fromCfg != null && fromCfg !== "") return Number(fromCfg);
  return NaN; // falls back to useParams in the wrappers below
}

// Sortable leaderboard. competitionId from config or route; status from config.
export function QuantLeaderboard({ config }: Cfg) {
  const params = useParams();
  const id = Number.isFinite(compId(config)) ? compId(config) : Number(params.competitionId);
  const status = (config?.status as "Upcoming" | "Ongoing" | "Completed" | undefined) ?? "Ongoing";
  if (!Number.isFinite(id)) return null;
  return <LeaderboardUser competitionId={id} status={status} onRefreshMyStrategies={() => {}} />;
}

// Live activity feed (polls recent trades).
export function QuantActivity({ config }: Cfg) {
  const params = useParams();
  const id = Number.isFinite(compId(config)) ? compId(config) : Number(params.competitionId);
  const status = String(config?.status ?? "Ongoing");
  if (!Number.isFinite(id)) return null;
  return <ActivityFeed competitionId={id} status={status} />;
}

// "Create with AI" — a button that opens the multi-step wizard dialog.
export function QuantAiWizard({ config }: Cfg) {
  const [open, setOpen] = useState(false);
  const label = String(config?.label ?? "Create with AI");
  return (
    <div className="my-2">
      <Button
        onClick={() => setOpen(true)}
        variant="outline"
        className="gap-2 cursor-pointer border-indigo-200 text-indigo-700 hover:bg-indigo-50"
      >
        <Sparkles className="h-4 w-4" />
        {label}
      </Button>
      <AIStrategyWizard open={open} onOpenChange={setOpen} />
    </div>
  );
}

// In-competition inspector for the caller's own strategies (reads competitionId
// from the route; has its own strategy-picker dropdown).
export function QuantMyStrategy(_: Cfg) {
  return <MyStrategyDetail />;
}

// Any participant's strategy detail (reads competitionId + strategyId from route).
export function QuantStrategyDetail(_: Cfg) {
  return <CommonStrategyDetail />;
}
