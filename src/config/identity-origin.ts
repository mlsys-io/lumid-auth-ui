// Resolve the lumid-identity API origin at RUNTIME instead of trusting the
// build-time VITE_* value alone.
//
// The same lumid-ui bundle serves three surfaces:
//   - lum.id (prod)            → identity is same-origin (https://lum.id)
//   - nightly.lum.id (nightly) → identity is same-origin — the nightly ingress
//     proxies /api, /oauth, /.well-known to lumid-identity:9900
//     (deploy_infra k8s-lift/lumid-ui-nightly/lumid-ui-nightly.yaml)
//   - xp.io/go (marketspace)   → identity is CROSS-origin at https://lum.id,
//     covered by lumid-identity's CORS allowlist (handler/router.go::meCORS)
//
// A build-time-only origin can't cover nightly: the nightly lane RE-TAGS the
// CI-built image (DEV-WORKFLOW.md §B, `imagetools create … :nightly-<sha>`),
// so a nightly bundle can never carry a different VITE_API_ORIGIN than prod —
// it shipped pointing at https://lum.id and every identity call from
// nightly.lum.id was CORS-blocked (login broken). Deriving the origin from
// window.location fixes the class: any *.lum.id host that serves this bundle
// must (and does) proxy the identity surface same-origin.
export function identityOrigin(built?: string): string {
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "lum.id" || h.endsWith(".lum.id")) return window.location.origin;
  }
  return built || "https://lum.id";
}
