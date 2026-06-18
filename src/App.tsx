import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthGuard, defaultLandingPath } from "./components/auth-guard";
import { AdminGuard } from "./components/admin-guard";
import BrandLoader from "./components/BrandLoader";
import { SuperAdminGuard } from "./components/super-admin-guard";
// New web-first revamp shell + pages (2026-05-22). Mounted at /app/*
// here; physically served at xp.io/go/app/* during P0-P3 via the
// VITE_ROUTER_BASE_PATH=/go build (see /proj/infra/compose/lumid_ui_go/).
const UserLayout    = lazy(() => import("./components/user-layout"));
const AppHome       = lazy(() => import("./pages/app-revamp/home"));
const AppMarketplace = lazy(() => import("./pages/app-revamp/marketplace"));
const AppLoops      = lazy(() => import("./pages/app-revamp/loops"));
const AppResults    = lazy(() => import("./pages/app-revamp/results"));
const AppKnowledge  = lazy(() => import("./pages/app-revamp/knowledge"));
const OnboardingWelcome = lazy(() => import("./pages/onboarding/welcome"));
const OnboardingDomain  = lazy(() => import("./pages/onboarding/domain"));
const OnboardingReady   = lazy(() => import("./pages/onboarding/ready"));
// /go-composer — Phase A1's xp.io/go composer. Lives in lumid_ui so
// session cookie auth flows naturally. Reachable at /go-composer from
// any bundle; the lumid-ui-go bundle (basename=/go) also serves it at
// "/" (see the Route definition below).
const Go            = lazy(() => import("./pages/Go"));

// Lumid Studio (Phase S1) — unified workspace shell. Lives at /studio/*
// alongside existing /app/* and /dashboard/* per the studio-plan.md
// decision: build alongside, no immediate cutover.
const StudioShell      = lazy(() => import("./components/StudioShell"));
const StudioChatHome   = lazy(() => import("./pages/studio/chat"));
const StudioIntents    = lazy(() => import("./pages/studio/intents"));
// Phase S5+ — real inbox (no longer a placeholder).
const StudioInbox      = lazy(() => import("./pages/studio/inbox"));
// Library page removed — the marketplace lives on xp.io. Old in-app
// paths bounce there via XpioRedirect.
function XpioRedirect() {
  useEffect(() => { window.location.replace("https://xp.io"); }, []);
  return null;
}
// Phase S3-C — app editor (lean v1).
const StudioApps         = lazy(() => import("./pages/studio/apps"));
const StudioWorkspace    = lazy(() => import("./pages/studio/StudioWorkspace"));
// App-defined UI surface (runtime-loaded markdown / native escape-hatch) at /studio/a/:app
const AppSurface         = lazy(() => import("./components/app-surface/AppSurface"));
// In-Studio markdown editor for an installed app's surface at /studio/a/:app/edit
const AppSurfaceEditor   = lazy(() => import("./components/app-surface/AppSurfaceEditor"));
// In-Studio YAML config editor for an installed app at /studio/a/:app/config
const AppManagePanel    = lazy(() => import("./components/app-surface/AppManagePanel"));
const AppConfigEditor    = lazy(() => import("./components/app-surface/AppConfigEditor"));
// W1 workflow surfaces folded into /studio/apps (per-app observability
// panel); /workflows and /mind redirect there, /workflows/:slug
// param-redirects into the owning app's panel. Runs stay as the
// cross-app run index.
const StudioRuns         = lazy(() => import("./pages/studio/runs"));
const StudioPortfolio    = lazy(() => import("./pages/studio/portfolio"));
// Workstream E — skills as a first-class surface (inventory + health + discovery).
const StudioSkills       = lazy(() => import("./pages/studio/skills"));
// Workstream F — cross-app experiments aggregate.
const StudioExperiments  = lazy(() => import("./pages/studio/experiments"));
const StudioRunDetail    = lazy(() => import("./pages/studio/run-detail"));
// Phase S3-D — per-agent knowledge browser (at /studio/knowledge/:agent).
const StudioKnowledge  = lazy(() => import("./pages/studio/knowledge"));
// "You, encoded" ledger at /studio/knowledge (distinct from the per-agent browser).
const StudioKnowledgeEncoded = lazy(() => import("./pages/studio/knowledge-encoded"));
// T13 — Generic intent-detail panel at /studio/intents/:intentId.
// Dispatches by intent.detail.body.kind (autoresearch | judgment | …).
const StudioIntentDetail = lazy(() => import("./pages/studio/intent-detail"));
// Phase S1.5 — Settings consolidation; Phase S4 — Admin tabs.
const StudioSettings   = lazy(() => import("./pages/studio/settings"));
const StudioAdmin      = lazy(() => import("./pages/studio/admin"));
// Phase S3-B — cycle inspector.
// "How Lumid works" — walkable 3-stage loop (Assemble → Adapt → Compound)
// illustrated against the demo intents. Stages 1-2 concrete, 3 open.
const StudioHow        = lazy(() => import("./pages/studio/how"));
const StudioMarketplace = lazy(() => import("./pages/studio/library"));
const StudioLibraryTabs = lazy(() => import("./pages/studio/library-tabs"));
const StudioRepo = lazy(() => import("./pages/studio/repo"));
const PublicShell = lazy(() => import("./components/PublicShell"));

// Auto-quant operator page (/dashboard/auto-quant/*)
const AutoQuantPage = lazy(() => import("./pages/app/auto-quant/index"));
const AutoQuantStrategyDetail = lazy(() => import("./pages/app/auto-quant/strategy-detail"));

// Lazy-load so first paint on /auth/login doesn't fetch the dashboard code.
const Login = lazy(() => import("./pages/login/login").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("./pages/login/register").then((m) => ({ default: m.Register })));
const Callback = lazy(() => import("./pages/auth/callback").then((m) => ({ default: m.AuthCallback })));
const ForgotPassword = lazy(() => import("./pages/auth/forgot-password"));
const ResetPassword = lazy(() => import("./pages/auth/reset-password"));
const XpioAutoresearchDoc = lazy(() => import("./pages/docs/xpio-autoresearch"));
const RedeemInvite = lazy(() => import("./pages/auth/redeem-invite"));

// The unified shell for /dashboard/* (absorbed the old /app/* tree in
// the 2026-04-24 merge). DashboardLayout + Overview are deprecated —
// AppLayout is the single shell now and /dashboard's index route shows
// the Apps landing.
const Profile = lazy(() => import("./pages/account/profile"));
const Tokens = lazy(() => import("./pages/account/tokens"));
const ConnectGoogle = lazy(() => import("./pages/account/connect-google"));
const ConnectPowerAutomate = lazy(() => import("./pages/account/connect-power-automate"));
const ConnectMicrosoft = lazy(() => import("./pages/account/connect-microsoft"));
const Inbox = lazy(() => import("./pages/account/inbox"));
const SkillsNew = lazy(() => import("./pages/account/skills/new"));
const MemoryNew = lazy(() => import("./pages/account/memory/new"));
// Connect (OAuth account linking) dropped from the sidebar 2026-04-24;
// page file kept on disk at /pages/account/connect.tsx but no longer
// routed. Re-add import + route + tab entry if/when OAuth linking is
// needed again.
const AdminInvitations = lazy(() => import("./pages/account/admin-invitations"));
// AdminOverview — operational snapshot landing at /dashboard/admin/.
// Replaces the Runmesh-ported AdminDashboard (revenue/success metrics
// that are zero in our deployment); pulls live cluster/node/worker/
// user/audit data instead. Source at pages/dashboard/overview.tsx.
const AdminOverview = lazy(() => import("./pages/dashboard/overview"));
// Super-admin single pane of glass — billing/identity/QA/infra/build
// tiles + embedded Grafana panels. Lives at /dashboard/super-admin.
const SuperAdminDashboard = lazy(() => import("./pages/dashboard/super-admin"));
const QuantLayout = lazy(() => import("./pages/dashboard/quant-layout"));
const QuantStrategy = lazy(() => import("./pages/dashboard/quant-strategy"));
// QuantDatasource lazy import retired 2026-05-03 — folded into
// Strategy ("Backtest") as a 3rd sub-tab. Old route redirects.
// QuantBacktesting + QuantRanking lazy imports retired 2026-05-03 —
// Backtesting absorbed into Strategy as a "Results" sub-tab; Ranking
// reachable via Competition deep-link only.
const QuantTemplate = lazy(() => import("./pages/dashboard/quant-template"));
const QuantMarketData = lazy(() => import("./pages/dashboard/quant-market-data"));
// Datasets pages are now the Data Exploration apps — the dashboard routes
// redirect into /studio/a/lumid-data-*, and the components load via the
// app-surface native-registry (not these lazy consts). Removed as dead code.
// Quant competition leaf components retired 2026-06-09 — the lumid-market
// competition section is now PURE config surfaces (AppSurface + ui/*.md).
// The QuantCompetitions/Detail/StrategyDetail/Research pages were removed as
// route mounts; their irreducibly-interactive parts survive as lumid:native
// embeds (quantarena/surface-embeds.tsx → native-registry.ts).
// RunmeshUsers removed 2026-04-24 — canonical user admin now at
// /app/admin/users (backed by lumid_identity.users). sys_user stays as
// a lazy mirror for FK integrity but is no longer separately editable.
// RunmeshNodes retired 2026-04-24 — replaced by /app/admin/clusters.
// The Runmesh sys_gpu_node table still mirrors node rows for billing,
// but it's no longer edited through this UI.
const RunmeshSuppliers = lazy(() =>
  import("./runmesh/pages/SupplierManagement").then((m) => ({ default: m.SupplierManagement })),
);
const RunmeshSupplierNodes = lazy(() =>
  import("./runmesh/pages/SupplierNodeConfig").then((m) => ({ default: m.SupplierNodeConfig })),
);
const RunmeshBilling = lazy(() =>
  import("./runmesh/pages/BillingManagement").then((m) => ({ default: m.BillingManagement })),
);
const RunmeshWorkflowReview = lazy(() => import("./runmesh/pages/WorkflowReview"));

// Research surface (xp.io marketplace plan 2026-05-18)
const LoopsPage = lazy(() => import("./pages/dashboard/loops"));
const MarketplacePage = lazy(() => import("./pages/dashboard/marketplace"));
const KnowledgePage = lazy(() => import("./pages/dashboard/knowledge"));
const ResultsPage = lazy(() => import("./pages/dashboard/results"));

// AppShell deprecated by Phase S7 cutover — /app/* now redirects to
// /studio/*; the focused Research shell is gone. Import + module
// retained on disk in case any deep-import path still references it;
// safe to delete once tree-shake confirms zero uses.

// Product surface — /app/*. Separate shell from /dashboard/*.
const AppLayout = lazy(() => import("./components/app-layout"));
const AppApps = lazy(() => import("./pages/app/apps"));
const AppWorkflows = lazy(() => import("./pages/app/workflows"));
const AppJobs = lazy(() => import("./pages/dashboard/jobs"));
const AppBilling = lazy(() => import("./pages/app/billing"));
const AppWorkflowBuilder = lazy(() => import("./pages/app/workflow-builder"));
const AppWorkflowDetail = lazy(() => import("./pages/app/workflow-detail"));
const AppWorkflowYaml = lazy(() => import("./pages/app/workflow-yaml"));
const AppN8n = lazy(() => import("./pages/app/n8n"));
// AppProfile (Runmesh user profile) retired 2026-04-24 — the canonical
// Profile tab at /dashboard/profile renders the identity-side Profile
// component from /pages/account/profile.tsx.
const AppSchedules = lazy(() => import("./pages/app/schedules"));
const AppApiDocs = lazy(() => import("./pages/app/api-docs"));
// lumid-gpu-rentals is now PURE config surfaces (AppSurface + ui/*.md). The
// list/wizard route mounts were retired; the rental detail (terminal/SSH/logs/
// billing) survives as a lumid:native embed loaded via native-registry.ts.
// Lumilake-origin pages (grouped under /app/lumilake/*)
const AppLumilakeDashboard = lazy(() => import("./pages/app/lumilake/dashboard"));
const AppLumilakeData = lazy(() => import("./pages/app/lumilake/data"));
const AppLumilakeSQL = lazy(() => import("./pages/app/lumilake/sql"));
const AppLumilakePython = lazy(() => import("./pages/app/lumilake/python"));
// Replaced 2026-04-24 — Runmesh Submit + Lumilake Submit are now real
// "pick an existing workflow + configure params + submit" pages, not
// reuses of the list/management view. The old AppApps (UserDashboard)
// reverts to being the Workflow Builder at /dashboard.
const AppRunmeshSubmit = lazy(() => import("./pages/app/runmesh-submit"));
// T-UI-003 — LQT (Lumid QuantTrading) pages
const AppLqtTrader = lazy(() => import("@/lqt/pages/trader").then(m => ({ default: m.TraderPage })));
const AppLqtAuditor = lazy(() => import("@/lqt/pages/auditor").then(m => ({ default: m.AuditorPage })));
const AppLqtResearcher = lazy(() => import("@/lqt/pages/researcher").then(m => ({ default: m.ResearcherPage })));
const AppLqtOperator = lazy(() => import("@/lqt/pages/operator").then(m => ({ default: m.OperatorPage })));
const AppLqtAccountant = lazy(() => import("@/lqt/pages/accountant").then(m => ({ default: m.AccountantPage })));
const AppLqtAdmin = lazy(() => import("@/lqt/pages/admin").then(m => ({ default: m.AdminPage })));

const AppLumilakeSubmit = lazy(() => import("./pages/app/lumilake-submit"));
const AppLumilakeJobs = lazy(() => import("./pages/app/lumilake/jobs"));
// Lumilake workers page retired 2026-04-24 — /app/admin/lumilake-workers
// redirects to /app/admin/cluster-workers?role=lumilake. The unified
// Workers page pulls from the lumid_cluster registry (both roles).
// Canonical user admin at lum.id/app/admin/users — the one user store.
// Replaces /app/admin/users (Runmesh sys_user) and /app/admin/lumilake-users.
const AppAdminUsers = lazy(() => import("./pages/app/admin-users"));
const AppAdminUserDetail = lazy(() => import("./pages/app/admin-user-detail"));
const AppAdminUsersMatrix = lazy(() => import("./pages/app/admin-users-matrix"));
const AppAdminAudit = lazy(() => import("./pages/app/admin-audit"));
const AppAdminSetup = lazy(() => import("./pages/app/admin-setup"));
// lumid_cluster admin — /app/admin/clusters/*
const AppAdminClusters = lazy(() => import("./pages/app/admin-clusters"));
const AppAdminClustersNew = lazy(() => import("./pages/app/admin-clusters-new"));
const AppAdminClustersDetail = lazy(() => import("./pages/app/admin-clusters-detail"));
const ClusterDetailOverview = lazy(() => import("./admin/clusters/overview-tab"));
const ClusterDetailServers = lazy(() =>
  import("./admin/clusters/detail-routes").then((m) => ({ default: m.ServersRoute })),
);
const ClusterDetailNodes = lazy(() =>
  import("./admin/clusters/detail-routes").then((m) => ({ default: m.NodesRoute })),
);
const ClusterDetailWorkers = lazy(() =>
  import("./admin/clusters/detail-routes").then((m) => ({ default: m.WorkersRoute })),
);
const ClusterDetailCommercial = lazy(() =>
  import("./admin/clusters/detail-routes").then((m) => ({ default: m.CommercialRoute })),
);
const ClusterDetailSubmit = lazy(() =>
  import("./admin/clusters/detail-routes").then((m) => ({ default: m.SubmitRoute })),
);
const AppAdminClusterWorkers = lazy(() => import("./pages/app/admin-cluster-workers"));
const AppAdminInfrastructureSetup = lazy(() => import("./pages/app/admin/infrastructure-setup"));
// QuantArena admin pages — bridged via /api/v1/qa-admin/* nginx proxy
const AppAdminCompetitions = lazy(() => import("./pages/app/admin-competitions"));
const AppAdminMarkets = lazy(() => import("./pages/app/admin-markets"));
const AppAdminTemplates = lazy(() => import("./pages/app/admin-templates"));
const AppAdminFlowMeshJobs = lazy(() => import("./pages/app/admin-flowmesh-jobs"));
const AdminSectionLayout = lazy(() => import("./pages/app/admin-section-layout"));

function LoginPage() {
  const { login } = useAuth();
  return (
    <Login
      onLogin={(token, user) => {
        login(token, user);
      }}
    />
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  return (
    <Register
      onSwitchToLogin={() => navigate("/auth/login")}
      onRegisterSuccess={() => navigate("/auth/login")}
    />
  );
}

// /auth/account/<tail>, /auth/dashboard/<tail>, /account/<tail>, and
// /app/<tail> all rewrite to /dashboard/<tail> so every stale bookmark
// keeps working after the 2026-04-24 merge.
function LegacyDashboardRedirect() {
  const { "*": tail = "" } = useParams();
  const loc = useLocation();
  const dest = tail ? `/dashboard/${tail}${loc.search}` : `/dashboard${loc.search}`;
  return <Navigate to={dest} replace />;
}

// /app/admin/* → /dashboard/admin/<rest>. The old /app shell's admin tree
// moved to /dashboard/admin (e.g. /dashboard/admin/clusters/<id>); old
// links like /app/admin/clusters/<id> need to land on the cluster detail
// page, not the studio catch-all. Preserves path tail + query.
// Legacy /dashboard/account/connect/google → Studio, PRESERVING the query
// string. A bare <Navigate to="/studio/..."> would drop ?return_to=/?then=,
// silently losing the OAuth return address (onboarding + /go both rely on it).
function ConnectGoogleStudioRedirect() {
  const loc = useLocation();
  return <Navigate to={`/studio/account/connect/google${loc.search}`} replace />;
}
function AppAdminRedirect() {
  const { "*": tail = "" } = useParams();
  const loc = useLocation();
  const dest = tail ? `/dashboard/admin/${tail}${loc.search}` : `/dashboard/admin${loc.search}`;
  return <Navigate to={dest} replace />;
}

// Opening an app (its surface at /studio/a/:app, or its overview at
// /studio/apps/:app) now drops you INTO the chat with the app rendered inline
// + the agent grounded on it — the deeper migration into conversation. The
// dense standalone page survives as the "?full=1" escape hatch. We stash the
// app synchronously (before <Navigate> fires) so StudioChat consumes it on
// mount; the full page renders in place when ?full=1.
// Bare app routes (/studio/a/:app, and gpu-rentals home) now open the app
// WORKSPACE (/studio/apps/:app) — the morphing 3-panel view (nav · details ·
// grounded chat). ?full=1 stays the standalone surface escape hatch.
function OpenAppRedirect({ app: appProp, surface }: { app?: string; surface?: string }) {
  const { app: paramApp = "" } = useParams();
  const app = appProp ?? paramApp;
  const [sp] = useSearchParams();
  if (sp.get("full") === "1") {
    return appProp ? <AppSurface app={appProp} surface={surface} /> : <AppSurface />;
  }
  return <Navigate to={`/studio/apps/${encodeURIComponent(app)}`} replace />;
}

// /studio/workflows → /studio/apps, PRESERVING the query (?compose=1
// must reach the apps page's composer host).
function WorkflowsListRedirect() {
  const loc = useLocation();
  return <Navigate to={`/studio/apps${loc.search}`} replace />;
}

// /studio/workflows/:slug (slug = "<app>:<loop>") folded into the
// per-app observability panel; deep links land there with the loop open.
function WorkflowSlugRedirect() {
  const { slug = "" } = useParams();
  const i = slug.indexOf(":");
  const app = i > 0 ? slug.slice(0, i) : slug;
  const loop = i > 0 ? slug.slice(i + 1) : "";
  return <Navigate to={`/studio/apps/${app}${loop ? `?selected=${encodeURIComponent(loop)}` : ""}`} replace />;
}

// The standalone cycle inspector merged into the app-overview panel
// (per-stage content + cycle stepper). Old /studio/(intents|today)/cycle/...
// deep links land on the app's panel with that loop open.
function CycleRedirect() {
  const { app = "", loop = "", ts = "" } = useParams();
  const cyc = ts ? `&cycle=${encodeURIComponent(ts)}` : "";
  return <Navigate to={`/studio/apps/${encodeURIComponent(app)}?selected=${encodeURIComponent(loop)}${cyc}`} replace />;
}

// Redirect dashboard quant/* routes to their Studio equivalents.
// Pattern may contain :paramName tokens that are replaced with matched params.
function ParamRedirect({ pattern }: { pattern: string }) {
  const params = useParams();
  const to = pattern.replace(/:(\w+)/g, (_, k) => params[k] ?? "");
  return <Navigate to={to} replace />;
}

// Cold-load fallback — the shared on-brand spiral loader on contextual gray boxes.
function Spinner() {
  return <BrandLoader />;
}

// RoleHome — used at "/" and the catch-all "*". Reads auth + role and
// Navigates to the right surface. Without this, "/" would render
// <Navigate to="/auth/login">, and the AuthGuard on /auth/login would
// then bounce already-authed users to /dashboard — landing every
// regular user on the admin shell even though they wanted /app.
function RoleHome() {
  const { isLoading, isAuthenticated, user } = useAuth();
  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <Navigate to="/auth/login" replace />;
  return <Navigate to={defaultLandingPath(user?.role)} replace />;
}

// RootEntry — root "/" branches by build-time bundle. The /go bundle
// (xp.io/go/*) renders the composer directly; lum.id (no basename)
// keeps the existing role-aware redirect. Inlined env constant so
// Vite tree-shakes the unused branch from each bundle.
const IS_GO_BUNDLE =
  (import.meta.env.VITE_ROUTER_BASE_PATH || "").replace(/\/$/, "") === "/go";
function RootEntry() {
  if (IS_GO_BUNDLE) return <Go />;
  return <RoleHome />;
}

// Deploy watcher — a long-lived SPA tab never refetches index.html, so after a
// UI push the user keeps running the old bundle (and clicking through "fixed"
// bugs). Poll the shell's ETag (no-cache on index.html makes this exact) every
// few minutes + on tab focus; when it changes, prompt one reload. Also reload
// automatically when a lazy route chunk 404s (its hashed file was replaced by
// the deploy) — Vite signals that via the `vite:preloadError` event.
// reloadForStaleChunk — hard-reload once to pick up the new bundle when a
// stale chunk fails to load. Guarded so a genuinely-broken chunk (not just
// stale) can't spin in a reload loop: at most one reload per 15s.
function reloadForStaleChunk() {
  try {
    const k = "chunk_reload_at";
    const last = Number(sessionStorage.getItem(k) || 0);
    if (Date.now() - last < 15_000) return; // already reloaded recently — avoid loop
    sessionStorage.setItem(k, String(Date.now()));
  } catch { /* sessionStorage blocked — still try one reload */ }
  window.location.reload();
}

function useDeployWatch() {
  useEffect(() => {
    let etag: string | null = null;
    let prompted = false;
    const check = async () => {
      try {
        const r = await fetch("/studio/", { method: "HEAD", cache: "no-store" });
        const e = r.headers.get("etag");
        if (!e) return;
        if (etag === null) { etag = e; return; }
        if (e !== etag && !prompted) {
          prompted = true;
          toast.info("A new version of Lumid is available.", {
            duration: Infinity,
            action: { label: "Reload", onClick: () => window.location.reload() },
          });
        }
      } catch { /* offline / transient — ignore */ }
    };
    check();
    const id = setInterval(check, 5 * 60_000);
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVis);
    const onPreloadError = (e: Event) => { e.preventDefault(); reloadForStaleChunk(); };
    window.addEventListener("vite:preloadError", onPreloadError);
    // A click-time dynamic import() of a stale (post-deploy) chunk rejects as a
    // plain error React.lazy surfaces — NOT always a vite:preloadError — which
    // white-screens the route ("library doesn't render"). Catch those globally
    // and reload once (guarded against reload loops) so the route self-heals.
    const isChunkErr = (msg: string) =>
      /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|module script failed/i.test(msg);
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = String(e?.reason?.message || e?.reason || "");
      if (isChunkErr(msg)) reloadForStaleChunk();
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkErr(String(e?.message || ""))) reloadForStaleChunk();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
}

export default function App() {
  useDeployWatch();
  return (
    <AuthProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          {/* Auth flows — unchanged under /auth/*. */}
          <Route
            path="/auth/login"
            element={
              <AuthGuard requireAuth={false}>
                <LoginPage />
              </AuthGuard>
            }
          />
          <Route
            path="/auth/register"
            element={
              <AuthGuard requireAuth={false}>
                <RegisterPage />
              </AuthGuard>
            }
          />
          <Route path="/auth/callback" element={<Callback />} />
          <Route path="/auth/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          {/* Public docs — anyone browsing app repos before forking
              should be able to read the canonical xpio contract. */}
          <Route path="/docs/xpio-autoresearch" element={<XpioAutoresearchDoc />} />

          {/* Public marketplace (anonymous discovery) — replaces the retired
              xp.io SPA. Browse + read-only repo pages without login; install/
              subscribe bounce through the authed studio (login prompt). */}
          <Route path="/explore" element={<PublicShell />}>
            <Route index element={<StudioMarketplace />} />
            <Route path="r/:owner/:name" element={<StudioRepo />} />
          </Route>

          {/* === Web-first revamp (2026-05-22) ===========================
              New user-facing surface mounted under /app/*. Same React
              bundle is also built with VITE_ROUTER_BASE_PATH=/go for the
              xp.io/go/* staging deploy — those URLs resolve here too
              because BrowserRouter basename strips the prefix at runtime.
              Replaces /dashboard/{marketplace,loops,knowledge,results}
              for the user persona; admins keep the /dashboard/* shell. */}
          <Route
            path="/onboarding/welcome"
            element={
              <AuthGuard requireAuth={true}>
                <OnboardingWelcome />
              </AuthGuard>
            }
          />
          <Route
            path="/onboarding/domain"
            element={
              <AuthGuard requireAuth={true}>
                <OnboardingDomain />
              </AuthGuard>
            }
          />
          <Route
            path="/onboarding/ready"
            element={
              <AuthGuard requireAuth={true}>
                <OnboardingReady />
              </AuthGuard>
            }
          />
          {/* /app/* shell removed in Phase S7 cutover — see the
              <Navigate /> redirects further down. The old UserLayout
              + AppHome/AppMarketplace/etc. pages are no longer
              mounted; the Studio shell handles all user surfaces. */}

          {/* Lumid Studio — Phase S1 unified shell. Lives alongside
              /dashboard (admin) and replaced /app entirely as of S7.
              The shell renders the left nav + top bar; each child
              route fills the workspace area. */}
          <Route
            path="/studio"
            element={
              <AuthGuard requireAuth={true}>
                <StudioShell />
              </AuthGuard>
            }
          >
            {/* The main page stays the chat home (2-panel: sidebar + chat). The
                3-panel workspace is ONLY for app pages (/studio/apps/:app). */}
            <Route index             element={<StudioChatHome />} />
            {/* Spine is now My Apps. The old Intents/Today landings redirect
                there; their cycle-inspector + intent-detail sub-routes stay. */}
            <Route path="intents"                       element={<Navigate to="/studio/apps" replace />} />
            <Route path="today"                         element={<Navigate to="/studio/apps" replace />} />
            {/* Cycle inspector merged into the app-overview panel (per-stage
                content + cycle stepper). Old deep links redirect there. */}
            <Route path="intents/cycle/:app/:loop/:ts"  element={<CycleRedirect />} />
            <Route path="today/cycle/:app/:loop/:ts"    element={<CycleRedirect />} />
            {/* T13 — per-intent detail panel; dispatched by intent.body.kind. */}
            <Route path="intents/:intentId"             element={<StudioIntentDetail />} />
            <Route path="inbox"                        element={<StudioInbox />} />
            {/* lumid-market competition section — now PURE config surfaces.
                Each route mounts AppSurface with an explicit named surface
                (declared in the bundle's xpcloud.yaml ui.surfaces); the page
                content, links, and clickables are generated from ui/*.md.
                URL params (competitionId, strategyId) are injected into the
                directive sources. Static segments beat :competitionId, which
                beats the generic :app/:surface below. The few irreducibly
                interactive widgets (sortable leaderboard, live feed, AI wizard,
                strategy inspector) are lumid:native embeds inside those .md
                files — see quantarena/surface-embeds.tsx. */}
            <Route path="a/lumid-market/competition"          element={<AppSurface app="lumid-market" surface="lobby" />} />
            <Route path="a/lumid-market/competition/lobby"    element={<AppSurface app="lumid-market" surface="lobby" />} />
            <Route path="a/lumid-market/competition/my"       element={<AppSurface app="lumid-market" surface="my-strategies" />} />
            <Route path="a/lumid-market/competition/pathways" element={<AppSurface app="lumid-market" surface="pathways" />} />
            <Route path="a/lumid-market/competition/:competitionId"                        element={<AppSurface app="lumid-market" surface="competition-detail" />} />
            <Route path="a/lumid-market/competition/:competitionId/strategy/:strategyId"   element={<AppSurface app="lumid-market" surface="strategy-detail" />} />
            <Route path="a/lumid-market/strategy/research/:strategyId"                     element={<AppSurface app="lumid-market" surface="research" />} />
            {/* lumid-gpu-rentals — PURE config surfaces (same pattern as
                lumid-market). home = pricing + your rentals (config);
                new = create form (config); detail = the irreducibly-interactive
                terminal/SSH/logs/billing as a lumid:native escape-hatch. The
                :id param is the FlowMesh task_id, injected into the detail
                embed.
                ROUTE-RANK TRAP (2026-06-11): `a/lumid-gpu-rentals/:id` scores
                10+3 — it BEATS the generic `a/:app/:surface` (3+3) and TIES
                `a/:app/manage` (3+10), so /home and /manage rendered the
                rental-detail page with id="home"/"manage". Every reserved
                name needs an explicit static route here (10+10 wins all),
                and this block is declared BEFORE the editor/manage routes
                only for the bare + static paths — :id ties resolve in favor
                of whichever is declared FIRST, so keep `:id` LAST in the
                whole a/* group (it lives below, after manage/config/edit). */}
            {/* Home opens in chat (surface card + grounded agent), like every
                other app. ?full=1 = the standalone page. /new + /:id stay full. */}
            <Route path="a/lumid-gpu-rentals"           element={<OpenAppRedirect app="lumid-gpu-rentals" surface="home" />} />
            <Route path="a/lumid-gpu-rentals/home"      element={<OpenAppRedirect app="lumid-gpu-rentals" surface="home" />} />
            <Route path="a/lumid-gpu-rentals/new"       element={<AppSurface app="lumid-gpu-rentals" surface="new" />} />
            {/* lumid-data-findata per-symbol drill-down: a row in Movers/Earnings/
                IPOs links here; {symbol} is injected into the detail surface
                (ohlc price chart + fundamentals + news). Beats the generic route. */}
            <Route path="a/lumid-data-findata/symbol/:symbol" element={<AppSurface app="lumid-data-findata" surface="symbol" />} />
            {/* App-defined UI surface — apps declare ui.surface in xpcloud.yaml;
                served as runtime markdown (or a first-party native key). */}
            {/* Editor/config routes must come before the generic :surface param
                route so React Router v7's static-segment scoring resolves correctly. */}
            <Route path="a/:app/edit"                   element={<AppSurfaceEditor />} />
            <Route path="a/:app/edit/:surface"          element={<AppSurfaceEditor />} />
            <Route path="a/:app/config"                 element={<AppConfigEditor />} />
            {/* App management — rename (card/sidebar label), workflows
                (create/run/remove loops), skill imports. Static segment
                beats the generic :surface below. */}
            <Route path="a/:app/manage"                 element={<AppManagePanel />} />
            {/* gpu-rentals rental detail — :id is the FlowMesh task_id. Declared
                AFTER manage/config/edit so those static names win their rank
                ties; still beats the generic :app/:surface for real ids. */}
            <Route path="a/lumid-gpu-rentals/:id"       element={<AppSurface app="lumid-gpu-rentals" surface="detail" />} />
            {/* Bare app surface → open in chat (deeper migration). ?full=1 =
                the standalone page. Named sub-surfaces stay full-page. */}
            <Route path="a/:app"                        element={<OpenAppRedirect />} />
            <Route path="a/:app/:surface"               element={<AppSurface />} />
            {/* Account surfaces folded into the one Studio shell. The old
                /dashboard/{profile,tokens,account/connect/google} routes stay
                reachable (back-compat) and redirect here. */}
            <Route path="account/profile"               element={<Profile />} />
            <Route path="account/tokens"                element={<Tokens />} />
            <Route path="account/connect/google"        element={<ConnectGoogle />} />
            {/* Management landing inside Studio — role-gated. Deep admin
                section trees (users/clusters/competitions) keep their existing
                /dashboard/admin/* tab-strip routes for now; the overview links
                into them. (Full re-shell is a follow-up.) */}
            <Route path="manage" element={<AdminGuard><AdminOverview /></AdminGuard>} />
            {/* Sidebar consolidation 2026-05-25: skills merged into the
                catalog (now "Library"); runs + mind folded into Workflows.
                Marketplace → Library rename (demo IA); old paths redirect.
                The StudioApps editor still mounts under /apps/:app to handle
                per-app YAML edits until the dedicated workflow editor ships. */}
            {/* Library page removed → the marketplace lives on xp.io. */}
            {/* In-Studio marketplace — browse + install xpio apps/skills/datasets
                (MarketplaceBrowse). Was redirecting out to xp.io, leaving no
                in-app install affordance; now mounts the page so install works
                from the dashboard. */}
            {/* Library — Marketplace / Skills / Experiments as tabs under
                one nav entry; the old top-level paths redirect in. */}
            <Route path="library"                      element={<StudioLibraryTabs />}>
              <Route index                             element={<Navigate to="marketplace" replace />} />
              <Route path="marketplace"                element={<StudioMarketplace />} />
              <Route path="skills"                     element={<StudioSkills />} />
              <Route path="experiments"                element={<StudioExperiments />} />
            </Route>
            {/* Read-only repo browser (files + PRs) — replaces the xp_ui repo
                page. Same component serves the public /explore/r/:owner/:name. */}
            <Route path="r/:owner/:name"               element={<StudioRepo />} />
            <Route path="marketplace"                  element={<Navigate to="/studio/library/marketplace" replace />} />
            <Route path="skills"                       element={<Navigate to="/studio/library/skills" replace />} />
            <Route path="experiments"                  element={<Navigate to="/studio/library/experiments" replace />} />
            {/* Knowledge is now the "you, encoded" ledger; the per-agent
                bank browser keeps its deep-link at /knowledge/:agent. */}
            <Route path="knowledge"                    element={<StudioKnowledgeEncoded />} />
            <Route path="knowledge/:agent"             element={<StudioKnowledge />} />
            {/* The Apps experience is the workspace (one featured app + switcher
                + grounded chat), NOT a grid. /apps opens the last-featured app;
                /apps/all is the full installed-app inventory (reached from the
                user menu's "Manage apps"). */}
            <Route path="apps"                         element={<StudioWorkspace />} />
            <Route path="apps/all"                     element={<StudioApps />} />
            <Route path="apps/:app"                    element={<StudioWorkspace />} />
            {/* Workflows folded into the per-app overview; list redirects,
                detail pages stay reachable via deep-link. */}
            <Route path="workflows"                    element={<WorkflowsListRedirect />} />
            <Route path="workflows/:slug"              element={<WorkflowSlugRedirect />} />
            {/* Runs + Mind kept reachable for back-compat and direct
                links from chat tools. Their lens-in-Workflows ports
                land in a follow-up PR; both still work at their
                original URLs and are just hidden from the sidebar. */}
            <Route path="runs"                         element={<StudioRuns />} />
            <Route path="portfolio"                    element={<StudioPortfolio />} />
            <Route path="runs/:run_id"                 element={<StudioRunDetail />} />
            {/* Mind folded into each workflow's Insights panel. */}
            <Route path="mind"                         element={<Navigate to="/studio/apps" replace />} />
            <Route path="how"                          element={<StudioHow />} />
            <Route path="settings"                     element={<StudioSettings />} />
            <Route path="admin"                        element={<StudioAdmin />} />
          </Route>
          {/* Authenticated-but-incomplete users (empty invitation_code)
              get redirected here by AuthGuard. The page itself runs
              behind AuthGuard so unauth users still bounce to /login. */}
          <Route
            path="/auth/redeem-invite"
            element={
              <AuthGuard requireAuth={true}>
                <RedeemInvite />
              </AuthGuard>
            }
          />

          {/* Unified /dashboard shell. All authenticated routes nest
              under this so the sidebar is always present. */}
          {/* Merged shell at /dashboard/*. Previously /dashboard held
              identity (Profile / Tokens / Connect) and /app held the
              product (Apps, Workflows, GPU rentals, Lumilake, Admin).
              2026-04-24 consolidation: one AppLayout renders all of it
              at /dashboard/*. Legacy /app/* URLs redirect further down. */}
          {/* One shell: /dashboard/* now renders inside StudioShell too (was
              AppLayout). URLs/tab-links/redirects unchanged — the pages just
              host in the unified Studio chrome. Revert to <AppLayout/> here to
              roll back. AppLayout is retained (referenced by no route now) for
              that one-line revert + reference. */}
          <Route
            path="/dashboard"
            element={
              <AuthGuard requireAuth={true}>
                <StudioShell />
              </AuthGuard>
            }
          >
            {/* 2026-04-24 reshape — split build from submit from run:
                  Workflow Builder   = n8n canvas (design the DAG)
                  Runmesh Submit     = pick + submit to FlowMesh
                                        (tab 1) or manage schedules
                                        (tab 2)
                  Lumilake Submit    = submit to Lumilake
                  Running jobs       = unified runtime list
                                        (tab 1: FlowMesh, tab 2: Lumilake)
                Root redirects to Runmesh Submit since that's the
                primary action. */}
            {/* Research Loops — xp.io marketplace plan 2026-05-18 */}
            <Route path="loops" element={<LoopsPage />} />
            <Route path="marketplace" element={<MarketplacePage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="results" element={<ResultsPage />} />

            {/* /dashboard root = Workflow Builder. AppApps embeds its
                own header + narrative inline (UserDashboard owns the
                inner full-height scroll layout, so a route-level
                wrapper would produce awkward double chrome). */}
            <Route index element={<AppApps />} />

            {/* Workflow Builder — design surface (n8n iframe). */}
            <Route path="n8n" element={<AppN8n />} />
            <Route path="n8n/:id" element={<AppN8n />} />
            <Route path="workflow" element={<AppWorkflowBuilder />} />
            <Route path="workflow/:id" element={<AppWorkflowBuilder />} />
            <Route path="workflow/yaml" element={<AppWorkflowYaml />} />
            <Route path="workflows/:id" element={<AppWorkflowDetail />} />

            {/* Runmesh Submit — pick + submit to FlowMesh, plus
                schedules management. Tab shell. */}
            <Route
              element={
                <AdminSectionLayout
                  title="Runmesh Submit"
                  subtitle="Pick a workflow to submit to FlowMesh, or manage recurring schedules."
                  tabs={[
                    { to: "/dashboard/runmesh/submit", label: "Submit", end: true },
                    { to: "/dashboard/runmesh/schedules", label: "Schedules" },
                  ]}
                />
              }
            >
              <Route path="runmesh/submit" element={<AppRunmeshSubmit />} />
              {/* T-UI-003 — LQT (Lumid QuantTrading) personas */}
              <Route path="lqt/trader" element={<AppLqtTrader />} />
              <Route path="lqt/auditor" element={<AppLqtAuditor />} />
              <Route path="lqt/researcher" element={<AppLqtResearcher />} />
              <Route path="lqt/operator" element={<AppLqtOperator />} />
              <Route path="lqt/accountant" element={<AppLqtAccountant />} />
              <Route path="lqt/admin" element={<AppLqtAdmin />} />
              <Route path="runmesh/schedules" element={<AppSchedules />} />
            </Route>

            {/* Lumilake Submit — pick + configure + submit to Lumilake.
                Wrapped in a header-only section layout for title +
                narrative parity with Runmesh Submit. */}
            <Route
              element={
                <AdminSectionLayout
                  title="Lumilake Submit"
                  subtitle="Pick a workflow and run it as a Lumilake analytics job — inputs in, results to your chosen lakehouse location."
                />
              }
            >
              <Route path="lumilake-submit" element={<AppLumilakeSubmit />} />
            </Route>

            {/* Running jobs — single page, Source dropdown filter
                (All / Quant / Lumid). Lumilake analytics jobs keep a
                standalone route for the data-engineer audience but
                aren't in the dropdown. The old AdminSectionLayout
                tabs were retired 2026-04-30 along with the Quant
                Trading-jobs tab in QuantLayout — both folded in here. */}
            <Route path="jobs" element={<AppJobs />} />
            <Route path="jobs/lumilake" element={<AppLumilakeJobs />} />
            <Route path="jobs/runmesh" element={<Navigate to="/dashboard/jobs?source=lumid" replace />} />
            <Route path="jobs/quant" element={<Navigate to="/dashboard/jobs?source=quant" replace />} />

            {/* Legacy-URL redirects (every old URL still resolves). */}
            <Route path="tasks" element={<Navigate to="/dashboard/jobs/runmesh" replace />} />
            <Route path="schedules" element={<Navigate to="/dashboard/runmesh/schedules" replace />} />
            <Route path="workflows" element={<AppWorkflows />} />   {/* legacy WorkflowMarket — still resolves, not in sidebar */}

            {/* Account — Profile only now. Tokens was tabbed here
                previously; hoisted out to the sidebar on 2026-04-24
                because users treat PATs as a top-level concern
                (CLI/SDK onboarding) rather than a profile sub-page.
                Connect (OAuth linking) dropped 2026-04-24. Billing
                stays as its own sidebar entry. */}
            {/* Account folded into Studio — old /dashboard paths redirect. */}
            <Route path="profile" element={<Navigate to="/studio/account/profile" replace />} />
            <Route path="tokens" element={<Navigate to="/studio/account/tokens" replace />} />
            <Route path="account/connect/google" element={<ConnectGoogleStudioRedirect />} />
            <Route path="account/connect/power-automate" element={<ConnectPowerAutomate />} />
            <Route path="account/connect/microsoft" element={<ConnectMicrosoft />} />
            <Route path="billing" element={<AppBilling />} />

            {/* Theme A4 / A5 / inbox — Lumid Studio authoring side
                channel. The AI auto-loop (Theme A1) is the primary
                surface for skill + memory authoring; these forms
                handle cold-start + override + the human review of
                staged drafts. The inbox is the steady-state landing. */}
            <Route path="inbox" element={<Inbox />} />
            <Route path="skills/new" element={<SkillsNew />} />
            <Route path="memory/new" element={<MemoryNew />} />

            <Route path="api-docs" element={<AppApiDocs />} />
            {/* Legacy /dashboard/gpu-rentals/* → consolidated into the Studio
                config surfaces (one entrance, mirrors the quant teardown). */}
            <Route path="gpu-rentals" element={<Navigate to="/studio/a/lumid-gpu-rentals" replace />} />
            <Route path="gpu-rentals/new" element={<Navigate to="/studio/a/lumid-gpu-rentals/new" replace />} />
            <Route path="gpu-rentals/:id" element={<ParamRedirect pattern="/studio/a/lumid-gpu-rentals/:id" />} />

            {/* Lumid Market migration — all authed lumid.market pages
                now live under /dashboard/quant/*. lumid.market itself
                is reduced to the public contest landing + /public/
                ranking; everything else (strategy, backtesting,
                competition, etc.) was ported into lumid_ui on
                2026-04-30. */}
            {/* All /dashboard/quant/* routes redirect to Studio equivalents.
                The QuantLayout shell is no longer rendered here — Studio is
                the canonical shell for all lumid-market pages. */}
            <Route path="quant">
              <Route index element={<Navigate to="/studio/a/lumid-market/competition/lobby" replace />} />
              <Route path="competition">
                <Route index element={<Navigate to="/studio/a/lumid-market/competition/lobby" replace />} />
                <Route path="lobby" element={<Navigate to="/studio/a/lumid-market/competition/lobby" replace />} />
                <Route path="my" element={<Navigate to="/studio/a/lumid-market/competition/my" replace />} />
                <Route path="pathways" element={<Navigate to="/studio/a/lumid-market/competition/pathways" replace />} />
              </Route>
              <Route path="competition/:competitionId" element={<ParamRedirect pattern="/studio/a/lumid-market/competition/:competitionId" />} />
              <Route path="competition/:competitionId/strategy/:strategyId" element={<ParamRedirect pattern="/studio/a/lumid-market/competition/:competitionId/strategy/:strategyId" />} />
              <Route path="strategy" element={<Navigate to="/studio/a/lumid-market/competition/my" replace />} />
              <Route path="backtesting" element={<Navigate to="/studio/a/lumid-market/competition/my" replace />} />
              <Route path="ranking" element={<Navigate to="/studio/a/lumid-market/competition/lobby" replace />} />
              <Route path="template" element={<Navigate to="/studio/a/lumid-market/competition/lobby" replace />} />
              <Route path="datasource" element={<Navigate to="/studio/a/lumid-market/competition/my" replace />} />
              <Route path="market-data" element={<Navigate to="/studio/a/lumid-market/competition/lobby" replace />} />
              <Route path="flowmesh-jobs" element={<Navigate to="/dashboard/jobs?source=quant" replace />} />
              <Route path="research/:strategyId" element={<ParamRedirect pattern="/studio/a/lumid-market/strategy/research/:strategyId" />} />
            </Route>

            {/* Datasets — FinData embed (Tier E of lumid.data prereq plan).
                Surfaced under /dashboard/datasets/findata; the iframe loads
                the FinData Vue SPA via /findata-embed/ same-origin proxy. */}
            {/* Datasets are now the Data Exploration apps — redirect into Studio. */}
            <Route path="datasets/findata" element={<Navigate to="/studio/a/lumid-data-findata" replace />} />
            <Route path="datasets/macro"   element={<Navigate to="/studio/a/lumid-data-macro" replace />} />
            <Route path="datasets/kols"    element={<Navigate to="/studio/a/lumid-data-kols" replace />} />
            <Route path="datasets/news"    element={<Navigate to="/studio/a/lumid-data-news" replace />} />
            <Route path="datasets/predmarket" element={<Navigate to="/studio/a/lumid-data-predmarket" replace />} />
            <Route path="datasets/markets" element={<Navigate to="/studio/a/lumid-data-markets" replace />} />

            {/* Lumilake-origin pages grouped under /app/lumilake/*.
                data-label + modelling hidden 2026-04-24 — not
                implemented yet; page files kept on disk for future
                reinstatement. */}
            <Route path="lumilake">
              <Route index element={<AppLumilakeDashboard />} />
              <Route path="data" element={<AppLumilakeData />} />
              <Route path="sql" element={<AppLumilakeSQL />} />
              <Route path="python" element={<AppLumilakePython />} />
              {/* Low-code (Lumilake n8n builder) is the same n8n as
                  the Workflows page at /dashboard. Redirect so the
                  two entry points don't diverge; the Workflows page's
                  output-target toggle (FlowMesh vs Lumilake) picks
                  backend — a future refactor. */}
              {/* Both Lumilake-specific URLs now redirect into the
                  unified /dashboard surface: low-code → lumilake-submit,
                  jobs → the FlowMesh+Lumilake merged runtime tab. */}
              <Route
                path="low-code"
                element={<Navigate to="/dashboard/lumilake-submit" replace />}
              />
              <Route path="jobs" element={<Navigate to="/dashboard/jobs/lumilake" replace />} />
            </Route>

            {/* Auto-quant operator page — Theme I strategy-grid-first.
                Gated by regular auth (any logged-in user). The page hits
                /api/v1/admin/loops which is admin-only, but the page itself
                has value for any operator who has the app installed. */}
            <Route path="auto-quant" element={<AutoQuantPage />} />
            <Route path="auto-quant/strategy/:name" element={<AutoQuantStrategyDetail />} />

            {/* Admin section — same shell, gated by role. Consolidated
                into 3 tabbed areas + Overview (Runmesh ops merged into
                Infrastructure on 2026-04-24 now that the supplier-node
                auto-mirror makes them one conceptual surface):
                  • People & access  → users, access matrix, invitations, audit, setup
                  • Infrastructure    → clusters, workers, suppliers, billing, reviews
                  • QuantArena        → competitions, portfolios, templates, flowmesh jobs
                Each area renders the child route inside an
                <AdminSectionLayout> that draws a tab strip at the top.
                Existing deep links (e.g. /app/admin/users/matrix) still
                resolve — the tab router is URL-based. Detail views
                (users/:id, clusters/:id, clusters/new) render OUTSIDE
                the tab shell since they aren't siblings of the tabs. */}
            <Route
              path="super-admin"
              element={
                <SuperAdminGuard>
                  <SuperAdminDashboard />
                </SuperAdminGuard>
              }
            />
            <Route
              path="admin"
              element={
                <AdminGuard>
                  <Outlet />
                </AdminGuard>
              }
            >
              <Route index element={<AdminOverview />} />

              {/* People & access — 5 tabs */}
              <Route
                element={
                  <AdminSectionLayout
                    title="People & access"
                    subtitle="Users, roles, invitations, and the audit trail."
                    tabs={[
                      { to: "/dashboard/admin/users", label: "Users", end: true },
                      { to: "/dashboard/admin/users/matrix", label: "Access matrix" },
                      { to: "/dashboard/admin/invitations", label: "Invitations" },
                      { to: "/dashboard/admin/audit", label: "Audit log" },
                      { to: "/dashboard/admin/setup", label: "Setup" },
                    ]}
                  />
                }
              >
                <Route path="users" element={<AppAdminUsers />} />
                <Route path="users/matrix" element={<AppAdminUsersMatrix />} />
                <Route path="invitations" element={<AdminInvitations />} />
                <Route path="audit" element={<AppAdminAudit />} />
                <Route path="setup" element={<AppAdminSetup />} />
              </Route>
              {/* User detail lives outside the tab layout — it's drill-down, not peer. */}
              <Route path="users/:id" element={<AppAdminUserDetail />} />

              {/* Infrastructure — unified GPU/compute admin surface
                  (consolidated from the old Infrastructure + Runmesh ops
                  split on 2026-04-24). Clusters is the primary view —
                  nodes, workers, and commercial/vendor metadata all roll
                  up there via the supplier-node auto-mirror. Suppliers
                  keeps a cross-cluster vendor list for legacy rows;
                  Billing is the platform-wide ledger (per-user view is
                  /dashboard/billing); Reviews gates workflow execution.
                  Legacy /admin/lumilake-workers redirects into the
                  unified Workers page. */}
              <Route
                element={
                  <AdminSectionLayout
                    title="Infrastructure"
                    subtitle="Clusters, workers, billing, and workflow review — one admin surface for the compute layer. Suppliers are auto-mirrored from clusters; the standalone Suppliers tab is retired."
                    tabs={[
                      { to: "/dashboard/admin/clusters", label: "Clusters", end: true },
                      { to: "/dashboard/admin/cluster-workers", label: "Workers" },
                      // Suppliers retired from the sidebar 2026-04-25 —
                      // every cluster auto-creates one vendor row, so
                      // /admin/suppliers and /admin/clusters showed the
                      // same physical things from two lenses. Vendor
                      // metadata now lives on the Commercial tab of each
                      // cluster. Route stays reachable for the rare
                      // untied-vendor case.
                      // Billing + platform-wide accounting are
                      // super_admin-only. Regular admins manage users
                      // / clusters / workflows but don't touch money.
                      { to: "/dashboard/admin/billing", label: "Billing", requireSuperAdmin: true },
                      { to: "/dashboard/admin/workflow-review", label: "Reviews" },
                      { to: "/dashboard/admin/infra-setup", label: "Setup guide" },
                    ]}
                  />
                }
              >
                <Route path="clusters" element={<AppAdminClusters />} />
                <Route path="cluster-workers" element={<AppAdminClusterWorkers />} />
                <Route path="suppliers" element={<RunmeshSuppliers />} />
                <Route path="supplier-nodes" element={<RunmeshSupplierNodes />} />
                <Route
                  path="billing"
                  element={
                    <SuperAdminGuard>
                      <RunmeshBilling />
                    </SuperAdminGuard>
                  }
                />
                <Route path="workflow-review" element={<RunmeshWorkflowReview />} />
                <Route path="infra-setup" element={<AppAdminInfrastructureSetup />} />
              </Route>
              <Route
                path="lumilake-workers"
                element={
                  <Navigate to="/dashboard/admin/cluster-workers?role=lumilake" replace />
                }
              />
              <Route path="clusters/new" element={<AppAdminClustersNew />} />
              {/* Cluster detail uses its own tab strip in place of the
                  Infrastructure section strip — flat one-level nav while
                  inside a cluster. Old /admin/clusters/:id deep-links
                  resolve via the index redirect to /overview. */}
              <Route path="clusters/:id" element={<AppAdminClustersDetail />}>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<ClusterDetailOverview />} />
                <Route path="servers" element={<ClusterDetailServers />} />
                <Route path="nodes" element={<ClusterDetailNodes />} />
                <Route path="workers" element={<ClusterDetailWorkers />} />
                <Route path="commercial" element={<ClusterDetailCommercial />} />
                <Route path="submit" element={<ClusterDetailSubmit />} />
              </Route>

              {/* QuantArena — 4 tabs */}
              <Route
                element={
                  <AdminSectionLayout
                    title="QuantArena"
                    subtitle="Trading platform admin — competitions, markets, templates, jobs."
                    tabs={[
                      { to: "/dashboard/admin/competitions", label: "Competitions", end: true },
                      { to: "/dashboard/admin/markets", label: "Markets" },
                      { to: "/dashboard/admin/templates", label: "Backtest templates" },
                      { to: "/dashboard/admin/flowmesh-jobs", label: "FlowMesh jobs" },
                    ]}
                  />
                }
              >
                <Route path="competitions" element={<AppAdminCompetitions />} />
                <Route path="markets" element={<AppAdminMarkets />} />
                <Route path="templates" element={<AppAdminTemplates />} />
                <Route path="flowmesh-jobs" element={<AppAdminFlowMeshJobs />} />
              </Route>

              {/* Retired surface — legacy deep-link redirects */}
              <Route path="nodes" element={<Navigate to="/dashboard/admin/clusters" replace />} />
              <Route path="lumilake-users" element={<Navigate to="/dashboard/admin/users" replace />} />
            </Route>
          </Route>

          {/* Legacy paths — one-hop redirect to /dashboard/*. */}
          <Route path="/auth/dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/auth/dashboard/*" element={<LegacyDashboardRedirect />} />
          <Route path="/auth/account" element={<Navigate to="/dashboard" replace />} />
          <Route path="/auth/account/admin" element={<Navigate to="/dashboard" replace />} />
          <Route path="/auth/account/*" element={<LegacyDashboardRedirect />} />
          <Route path="/account" element={<Navigate to="/dashboard" replace />} />
          <Route path="/account/admin" element={<Navigate to="/dashboard" replace />} />
          <Route path="/account/*" element={<LegacyDashboardRedirect />} />
          {/* 2026-04-24 merge: /app/* was the product shell; now its
              entire tree lives under /dashboard/*. Catchall redirect
              preserves every deep link (sidebar history, Runmesh CLI
              output, docs, bookmarks). */}
          {/* /app/* — DEPRECATED as of Phase S7 cutover. The Research
              shell collapsed into Studio. All known /app/* deep links
              redirect to their Studio equivalent; unknown paths land
              on /studio/today.

              The old LoopsPage / MarketplacePage / KnowledgePage /
              ResultsPage components remain imported because their
              contents are mounted under /studio/* (e.g. AppLoops is
              rendered inside StudioIntents). When inactive direct-mount
              references are pruned, those imports can go too.

              Old bookmarks → Studio mapping:
                /app             → /studio/today
                /app/loops       → /studio/today (AppLoops renders inside)
                /app/marketplace → /studio/skills
                /app/knowledge   → /studio/knowledge
                /app/results     → /studio/today */}
          <Route path="/app"             element={<Navigate to="/studio/apps"      replace />} />
          <Route path="/app/loops"       element={<Navigate to="/studio/apps"      replace />} />
          <Route path="/app/marketplace" element={<XpioRedirect />} />
          <Route path="/app/knowledge"   element={<Navigate to="/studio/knowledge" replace />} />
          <Route path="/app/results"     element={<Navigate to="/studio/apps"      replace />} />
          {/* /app/admin/* belonged to the old /app shell admin tree but
              everything admin now lives under /dashboard/admin/*. Preserve
              the rest of the path so deep links like
              /app/admin/clusters/<id> route through. */}
          <Route path="/app/admin/*"     element={<AppAdminRedirect />} />
          <Route path="/app/*"           element={<Navigate to="/studio/apps"      replace />} />

          {/* Root "/" — role-aware landing. AuthGuard(false) handles
              the unauth case by rendering <RoleHome>, which then reads
              user.role and Navigates to /app (user) or /dashboard
              (admin). Unauthed users fall to <RoleHome>'s unauth branch
              and bounce to /auth/login. This replaces the previous
              two-hop /→/auth/login→/dashboard which would land regular
              users on the admin shell. */}
          {/* /go-composer — also reachable from the lum.id bundle so the
              landing CTA can deep-link. Same component renders here and
              at root of the /go bundle (see RootEntry above). */}
          <Route path="/go-composer" element={<Go />} />
          <Route path="/" element={<RootEntry />} />
          <Route path="*" element={<RootEntry />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

