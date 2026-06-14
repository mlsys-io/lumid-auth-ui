// Data-driven Studio sidebar: installed xpio apps that declare `ui.sidebar`
// contribute their own nav entries, grouped by section. Mirrors the
// QuantSection runtime-fetch pattern (fetch on mount + 60s poll + an
// invalidate event so an install can refresh the rail immediately).

import { useEffect, useState } from "react";
import {
  Boxes, Database, LineChart, BarChart3, Newspaper, TrendingUp, Globe,
  Activity, Coins, Users, CandlestickChart, MessagesSquare, Brain, Cpu,
  type LucideIcon,
} from "lucide-react";
import { me, type MeAppCard } from "@/api/me";
import { registerAppLabel, registerAppSurfacePresence } from "@/components/workflow/AppCard";

export const APP_NAV_INVALIDATE = "studio:apps-invalidate";
// The installed-app set is near-static — it changes only on install/uninstall,
// which already fire APP_NAV_INVALIDATE for an immediate refresh. The interval
// is just a safety net for changes made out-of-band (CLI install), so a slow
// 5-min tick is plenty; a 60s poll was pure redundant load on /me/apps.
const POLL_MS = 300_000;

const ICONS: Record<string, LucideIcon> = {
  "boxes": Boxes,
  "database": Database,
  "line-chart": LineChart,
  "bar-chart": BarChart3,
  "bar-chart-3": BarChart3,
  "newspaper": Newspaper,
  "trending-up": TrendingUp,
  "globe": Globe,
  "activity": Activity,
  "coins": Coins,
  "users": Users,
  "candlestick-chart": CandlestickChart,
  "chart-candlestick": CandlestickChart,
  "messages-square": MessagesSquare,
  "brain": Brain,
  "cpu": Cpu,
};

export function iconFor(name?: string): LucideIcon {
  return (name && ICONS[name]) || Boxes;
}

export interface AppNavItem {
  app: string;
  label: string;
  icon?: string;
  order: number;
  badge_source?: string;
}
export interface AppNavSection {
  section: string;
  items: AppNavItem[];
}

export function useAppNav(): AppNavSection[] {
  const [apps, setApps] = useState<MeAppCard[]>([]);
  useEffect(() => {
    let live = true;
    const tick = () =>
      me.listApps()
        .then((r) => { if (live) setApps(r.apps || []); })
        .catch(() => { /* soft-fail; sidebar keeps fixed entries */ });
    tick();
    const id = window.setInterval(tick, POLL_MS);
    const onInvalidate = () => tick();
    window.addEventListener(APP_NAV_INVALIDATE, onInvalidate);
    return () => {
      live = false;
      window.clearInterval(id);
      window.removeEventListener(APP_NAV_INVALIDATE, onInvalidate);
    };
  }, []);

  const seen = new Set<string>();
  const bySection = new Map<string, AppNavItem[]>();
  for (const a of apps) {
    const sb = a.ui?.sidebar;
    // Explicit on/off: show when `show` is omitted (back-compat) or true;
    // skip when the app set `show: false` (keeps its label/icon config).
    // Register the canonical display label (even for show:false apps) so
    // appTitle() resolves to the SAME name the sidebar uses, everywhere.
    if (sb?.label) registerAppLabel(a.name, sb.label);
    // Surface presence — lets AppSurfaceCard skip the appUI probe (+ its 404)
    // for apps that declare no UI surface.
    registerAppSurfacePresence(a.name, !!(a.ui?.surface || (a.ui?.surfaces && Object.keys(a.ui.surfaces).length > 0)));
    if (!sb?.label || sb.show === false || seen.has(a.name)) continue; // tenant walked first → wins over operator-shared dup
    seen.add(a.name);
    const section = sb.section || "Apps";
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push({
      app: a.name,
      label: sb.label,
      icon: sb.icon,
      order: sb.order ?? 100,
      badge_source: sb.badge_source,
    });
  }
  return [...bySection.entries()]
    .map(([section, items]) => ({
      section,
      items: items.sort((x, y) => x.order - y.order || x.label.localeCompare(y.label)),
    }))
    .sort((a, b) => a.section.localeCompare(b.section));
}
