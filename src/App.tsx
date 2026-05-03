import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthGuard } from "./components/auth-guard";
import { AdminGuard } from "./components/admin-guard";
import { SuperAdminGuard } from "./components/super-admin-guard";

// Lazy-load so first paint on /auth/login doesn't fetch the dashboard code.
const Login = lazy(() => import("./pages/login/login").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("./pages/login/register").then((m) => ({ default: m.Register })));
const Callback = lazy(() => import("./pages/auth/callback").then((m) => ({ default: m.AuthCallback })));
const ForgotPassword = lazy(() => import("./pages/auth/forgot-password"));
const ResetPassword = lazy(() => import("./pages/auth/reset-password"));

// The unified shell for /dashboard/* (absorbed the old /app/* tree in
// the 2026-04-24 merge). DashboardLayout + Overview are deprecated —
// AppLayout is the single shell now and /dashboard's index route shows
// the Apps landing.
const Profile = lazy(() => import("./pages/account/profile"));
const Tokens = lazy(() => import("./pages/account/tokens"));
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
const QuantLayout = lazy(() => import("./pages/dashboard/quant-layout"));
const QuantStrategy = lazy(() => import("./pages/dashboard/quant-strategy"));
const QuantDatasource = lazy(() => import("./pages/dashboard/quant-datasource"));
// QuantBacktesting + QuantRanking lazy imports retired 2026-05-03 —
// Backtesting absorbed into Strategy as a "Results" sub-tab; Ranking
// reachable via Competition deep-link only.
const QuantTemplate = lazy(() => import("./pages/dashboard/quant-template"));
const QuantResearch = lazy(() => import("./pages/dashboard/quant-research"));
const QuantMarketData = lazy(() => import("./pages/dashboard/quant-market-data"));
const DatasetsFindata = lazy(() => import("./pages/dashboard/datasets-findata"));
const QuantCompetition = lazy(() =>
  import("./pages/dashboard/quant-competition").then((m) => ({ default: m.QuantCompetitionPage }))
);
const QuantCompetitionDetail = lazy(() =>
  import("./pages/dashboard/quant-competition").then((m) => ({ default: m.QuantCompetitionDetailPage }))
);
const QuantCompetitionStrategyDetail = lazy(() =>
  import("./pages/dashboard/quant-competition").then((m) => ({ default: m.QuantCompetitionStrategyDetailPage }))
);
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
const AppGpuRentals = lazy(() => import("./pages/app/gpu-rentals"));
const AppGpuRentalsNew = lazy(() => import("./pages/app/gpu-rentals-new"));
const AppGpuRentalDetail = lazy(() => import("./pages/app/gpu-rental-detail"));
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

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
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

          {/* Unified /dashboard shell. All authenticated routes nest
              under this so the sidebar is always present. */}
          {/* Merged shell at /dashboard/*. Previously /dashboard held
              identity (Profile / Tokens / Connect) and /app held the
              product (Apps, Workflows, GPU rentals, Lumilake, Admin).
              2026-04-24 consolidation: one AppLayout renders all of it
              at /dashboard/*. Legacy /app/* URLs redirect further down. */}
          <Route
            path="/dashboard"
            element={
              <AuthGuard requireAuth={true}>
                <AppLayout />
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
            <Route path="profile" element={<Profile />} />
            <Route path="tokens" element={<Tokens />} />
            <Route path="billing" element={<AppBilling />} />

            <Route path="api-docs" element={<AppApiDocs />} />
            <Route path="gpu-rentals" element={<AppGpuRentals />} />
            <Route path="gpu-rentals/new" element={<AppGpuRentalsNew />} />
            <Route path="gpu-rentals/:id" element={<AppGpuRentalDetail />} />

            {/* Lumid Market migration — all authed lumid.market pages
                now live under /dashboard/quant/*. lumid.market itself
                is reduced to the public contest landing + /public/
                ranking; everything else (strategy, backtesting,
                competition, etc.) was ported into lumid_ui on
                2026-04-30. */}
            <Route path="quant" element={<QuantLayout />}>
              <Route index element={<Navigate to="/dashboard/quant/competition" replace />} />
              <Route path="competition" element={<QuantCompetition />} />
              <Route path="competition/:competitionId" element={<QuantCompetitionDetail />} />
              <Route
                path="competition/:competitionId/strategy/:strategyId"
                element={<QuantCompetitionStrategyDetail />}
              />
              <Route path="strategy" element={<QuantStrategy />} />
              {/* Tab consolidation 2026-05-03 — Backtesting moved into Strategy as the
                  "Results" sub-tab; Ranking demoted (deep-link via Competition); Template
                  demoted (deep-link only). Routes preserved as redirects so old
                  bookmarks keep working. */}
              <Route path="backtesting" element={<Navigate to="/dashboard/quant/strategy?tab=results" replace />} />
              <Route path="ranking" element={<Navigate to="/dashboard/quant/competition" replace />} />
              <Route path="template" element={<QuantTemplate />} />
              <Route path="datasource" element={<QuantDatasource />} />
              <Route path="market-data" element={<QuantMarketData />} />
              <Route path="flowmesh-jobs" element={<Navigate to="/dashboard/jobs?source=quant" replace />} />
              <Route path="research/:strategyId" element={<QuantResearch />} />
            </Route>

            {/* Datasets — FinData embed (Tier E of lumid.data prereq plan).
                Surfaced under /dashboard/datasets/findata; the iframe loads
                the FinData Vue SPA via /findata-embed/ same-origin proxy. */}
            <Route path="datasets/findata" element={<DatasetsFindata />} />

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
          <Route path="/app" element={<Navigate to="/dashboard" replace />} />
          <Route path="/app/*" element={<LegacyDashboardRedirect />} />

          {/* Roots → login if unauth, dashboard if auth (AuthGuard decides). */}
          <Route
            path="/"
            element={
              <AuthGuard requireAuth={false}>
                <Navigate to="/auth/login" replace />
              </AuthGuard>
            }
          />
          <Route path="*" element={<Navigate to="/auth/login" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

