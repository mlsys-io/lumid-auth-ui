// Data-driven Studio sidebar: installed xpio apps that declare `ui.sidebar`
// contribute their own nav entries, grouped by section. Mirrors the
// QuantSection runtime-fetch pattern (fetch on mount + 60s poll + an
// invalidate event so an install can refresh the rail immediately).

import { useEffect, useState } from "react";
import {
  Boxes, Database, LineChart, BarChart3, Newspaper, TrendingUp, Globe,
  Activity, Coins, Users, CandlestickChart, MessagesSquare, Brain, Cpu,
  Briefcase, BookOpen, GraduationCap, FlaskConical, Microscope, Compass,
  Target, Sparkles, Shield, Wrench, Rocket, Layers, Network, Search,
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
  // Names apps actually declare that had no entry, so they silently fell back
  // to Boxes — mbb-consultant asks for "briefcase".
  "briefcase": Briefcase,
  "book": BookOpen,
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  "flask": FlaskConical,
  "flask-conical": FlaskConical,
  "microscope": Microscope,
  "compass": Compass,
  "target": Target,
  "sparkles": Sparkles,
  "shield": Shield,
  "wrench": Wrench,
  "rocket": Rocket,
  "layers": Layers,
  "network": Network,
  "search": Search,
};

// Distinct fallbacks. A single default made every app that declares no icon —
// or declares one we don't map — visually identical, which defeats the point of
// showing an icon at all now that the sidebar identifies an app's conversations
// by it rather than by nesting. Picked deterministically from the app slug, so
// an app keeps the same glyph across reloads and between users.
const FALLBACK_ICONS: LucideIcon[] = [
  Boxes, Layers, Network, Compass, Target, FlaskConical,
  Microscope, Rocket, Shield, Wrench, BookOpen, Sparkles,
];

function hashSlug(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function iconFor(name?: string, seed?: string): LucideIcon {
  const declared = name && ICONS[name.toLowerCase()];
  if (declared) return declared;
  // No usable declaration: give this app a stable glyph of its own rather than
  // the same default as everyone else.
  if (seed) return FALLBACK_ICONS[hashSlug(seed) % FALLBACK_ICONS.length];
  return Boxes;
}

// Fallback display name for an app that ships no `ui.sidebar.label`.
// "venue-link-matcher" → "Venue Link Matcher". Most installed apps declare
// no sidebar block at all, and skipping them made a Library install look
// like it did nothing — the app was installed, it just had no way to appear.
export function humanizeAppName(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ") || slug;
}

export interface AppNavItem {
  app: string;
  label: string;
  icon?: string;
  order: number;
  badge_source?: string;
  // "installing" / "failed" surface in the rail so a Library install shows
  // progress in place instead of a row that silently never works.
  status?: "ready" | "installing" | "failed";
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
    // EVERY installed app gets a rail entry now — a `ui.sidebar.label` is an
    // optional override, not the price of admission. Requiring it meant
    // installing from the Library appeared to do nothing for the (majority)
    // of apps that ship no sidebar block. `show: false` stays an explicit
    // opt-out for apps that deliberately don't want a rail row.
    if (sb?.show === false || seen.has(a.name)) continue; // tenant walked first → wins over operator-shared dup
    seen.add(a.name);
    const section = sb?.section || "Agents";
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push({
      app: a.name,
      label: sb?.label || humanizeAppName(a.name),
      icon: sb?.icon,
      order: sb?.order ?? 100,
      badge_source: sb?.badge_source,
      status: a.status,
    });
  }
  return [...bySection.entries()]
    .map(([section, items]) => ({
      section,
      items: items.sort((x, y) => x.order - y.order || x.label.localeCompare(y.label)),
    }))
    .sort((a, b) => a.section.localeCompare(b.section));
}
