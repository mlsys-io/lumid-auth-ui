// First-party native surfaces — the bundle-internal escape hatch.
//
// An app's `ui.surface.native: "<key>"` resolves here to a React component
// shipped inside this bundle. This is ONLY for first-party, irreducibly
// interactive surfaces that the Markdown directive set can't express. The
// server echoes the `native` key but NEVER serves code; the client resolves
// it strictly against this map, so an installed third-party bundle can never
// inject a component.
//
// The six Data Exploration forks reuse the existing self-contained
// `datasets-*` pages verbatim (no feature loss). LQA's quant surface is a
// nested route tree, not a single component, so it isn't here yet — it ships
// with the deep-admin/quant re-shell follow-up.

import { lazy, type ComponentType } from "react";

// Native surface components receive an optional `config` prop — the key/value
// body of the `lumid:native` directive (minus `key`). This makes a native
// embed configurable (title, defaults, which panels) instead of opaque.
export type NativeSurfaceProps = { config?: Record<string, unknown> };

// Native surfaces: only for genuinely interactive components that can't be
// expressed as directives — SSH terminals, real-time billing, log streaming.
// Data-display pages use lumid:tabs + lumid:table/chart instead.
export const NATIVE_SURFACES: Record<string, ComponentType<NativeSurfaceProps>> = {
  // GPU Rentals — SSH terminal, real-time task polling, billing, wizard.
  // Accepts config: { title, subtitle, hide_header }.
  "lumid-gpu-rentals": lazy(() => import("@/pages/app/gpu-rentals")),
  // GPU rental detail — the irreducibly-interactive escape-hatch (live task
  // polling, SSH connect snippet, log streaming, billing ticker, cancel).
  // Reads :id from the route; embedded by the detail config surface.
  "gpu-rental-detail": lazy(() => import("@/pages/app/gpu-rental-detail")),

  // lumid-market escape-hatch widgets — referenced from the config surfaces
  // (ui/*.md) via `lumid:native` for the few interactive bits directives can't
  // express. competitionId/strategyId come from the route or config.
  "quant-leaderboard": lazy(() =>
    import("@/quantarena/surface-embeds").then((m) => ({ default: m.QuantLeaderboard }))),
  "quant-activity": lazy(() =>
    import("@/quantarena/surface-embeds").then((m) => ({ default: m.QuantActivity }))),
  "quant-ai-wizard": lazy(() =>
    import("@/quantarena/surface-embeds").then((m) => ({ default: m.QuantAiWizard }))),
  "quant-my-strategy": lazy(() =>
    import("@/quantarena/surface-embeds").then((m) => ({ default: m.QuantMyStrategy }))),
  "quant-strategy-detail": lazy(() =>
    import("@/quantarena/surface-embeds").then((m) => ({ default: m.QuantStrategyDetail }))),

  // Generic data-app catalog browser — interactive (endpoint list + param form
  // + run), so it's a native surface. Config: { data_app, label }; data_app is
  // an allowlisted base-id (nginx /dataapp-proxy/<id>/). Powers lumid-data-explorer.
  "data-app-browser": lazy(() => import("./DataAppBrowser")),

  // Federated data-lake viewer — one screen across the whole data mesh
  // (findata /findata, lumid-data /data, lqt-data /lqt-data). UI-fanout: fetches
  // each instance's catalog + a capped sample directly, merges client-side. No
  // platform hub; data never moves. Config: { title }. Powers lumid-data-lake
  // (also mounted directly at /studio/a/lumid-data-lake).
  "data-lake-viewer": lazy(() => import("./DataLakeViewer")),

  // The app's workflow/autoresearch machinery (loops, run history, cycle
  // inspector) embedded as a tab of its configured UI. App comes from the
  // route — any loop-bearing app can declare a `workflows` surface with this.
  "app-workflows": lazy(() => import("./AppWorkflowsSurface")),
  "app-experiments": lazy(() => import("./AppExperimentsSurface")),

  // n8n-style pipeline canvas as a standalone native surface. Config:
  // { loop, cycle: "latest"? } — the lumid:workflow directive is the
  // markdown-first path; this key serves apps that want the canvas as a
  // whole declared surface/tab.
  "workflow-canvas": lazy(() => import("./WorkflowCanvasSurface")),
};

export function resolveNativeSurface(key?: string): ComponentType<NativeSurfaceProps> | undefined {
  if (!key) return undefined;
  return NATIVE_SURFACES[key];
}
