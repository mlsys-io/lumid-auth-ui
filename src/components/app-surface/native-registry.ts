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

export const NATIVE_SURFACES: Record<string, ComponentType> = {
  "lumid-data-findata": lazy(() => import("@/pages/dashboard/datasets-findata")),
  "lumid-data-macro": lazy(() => import("@/pages/dashboard/datasets-macro")),
  "lumid-data-markets": lazy(() => import("@/pages/dashboard/datasets-markets")),
  "lumid-data-predmarket": lazy(() => import("@/pages/dashboard/datasets-predmarket")),
  "lumid-data-news": lazy(() => import("@/pages/dashboard/datasets-news")),
  "lumid-data-kols": lazy(() => import("@/pages/dashboard/datasets-kols")),
};

export function resolveNativeSurface(key?: string): ComponentType | undefined {
  if (!key) return undefined;
  return NATIVE_SURFACES[key];
}
