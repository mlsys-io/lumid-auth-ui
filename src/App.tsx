import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthGuard } from "./components/auth-guard";
import { AdminGuard } from "./components/admin-guard";

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
const RunmeshAdminDashboard = lazy(() =>
  import("./runmesh/pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
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
const AppTasks = lazy(() => import("./pages/app/tasks"));
const AppBilling = lazy(() => import("./pages/app/billing"));
const AppWorkflowBuilder = lazy(() => import("./pages/app/workflow-builder"));
const AppWorkflowDetail = lazy(() => import("./pages/app/workflow-detail"));
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
const AppAdminClusterWorkers = lazy(() => import("./pages/app/admin-cluster-workers"));
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
            {/* /dashboard root = Workflow Builder (UserDashboard — list
                + edit + open n8n on a workflow). Sidebar entry
                'Workflow Builder' lands here. */}
            <Route index element={<AppApps />} />

            {/* Workflow Builder — design surface (n8n iframe). */}
            <Route path="n8n" element={<AppN8n />} />
            <Route path="n8n/:id" element={<AppN8n />} />
            <Route path="workflow" element={<AppWorkflowBuilder />} />
            <Route path="workflow/:id" element={<AppWorkflowBuilder />} />
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

            {/* Lumilake Submit — pick + configure + submit to Lumilake. */}
            <Route path="lumilake-submit" element={<AppLumilakeSubmit />} />

            {/* Running jobs — merged runtime view. Tab shell. */}
            <Route
              element={
                <AdminSectionLayout
                  title="Running jobs"
                  subtitle="All workflow runs — FlowMesh compute tasks and Lumilake analytics jobs, side by side."
                  tabs={[
                    { to: "/dashboard/jobs/runmesh", label: "FlowMesh", end: true },
                    { to: "/dashboard/jobs/lumilake", label: "Lumilake" },
                  ]}
                />
              }
            >
              <Route path="jobs/runmesh" element={<AppTasks />} />
              <Route path="jobs/lumilake" element={<AppLumilakeJobs />} />
            </Route>

            {/* Legacy-URL redirects (every old URL still resolves). */}
            <Route path="tasks" element={<Navigate to="/dashboard/jobs/runmesh" replace />} />
            <Route path="schedules" element={<Navigate to="/dashboard/runmesh/schedules" replace />} />
            <Route path="workflows" element={<AppWorkflows />} />   {/* legacy WorkflowMarket — still resolves, not in sidebar */}

            {/* Account — Profile + Tokens tabbed together. Billing
                was a tab in the earlier iteration but is now a
                standalone sidebar entry (/dashboard/billing still
                lives in this shell, just outside the Account tab
                group). Connect (OAuth linking) dropped 2026-04-24. */}
            <Route
              element={
                <AdminSectionLayout
                  title="Account"
                  subtitle="Profile and personal access tokens."
                  tabs={[
                    { to: "/dashboard/profile", label: "Profile", end: true },
                    { to: "/dashboard/tokens", label: "Tokens" },
                  ]}
                />
              }
            >
              <Route path="profile" element={<Profile />} />
              <Route path="tokens" element={<Tokens />} />
            </Route>
            {/* Billing is a first-class sidebar entry, not a tab. Kept
                at /dashboard/billing for stable URL. */}
            <Route path="billing" element={<AppBilling />} />

            <Route path="api-docs" element={<AppApiDocs />} />
            <Route path="gpu-rentals" element={<AppGpuRentals />} />
            <Route path="gpu-rentals/new" element={<AppGpuRentalsNew />} />
            <Route path="gpu-rentals/:id" element={<AppGpuRentalDetail />} />

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
                into 4 tabbed areas + Overview (2026-04-24):
                  • People & access  → users, access matrix, invitations, audit, setup
                  • Infrastructure    → clusters, workers, lumilake workers
                  • Runmesh ops       → suppliers, supplier nodes, billing, reviews
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
              <Route index element={<RunmeshAdminDashboard />} />

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

              {/* Infrastructure — 2 tabs. "Lumilake workers" tab retired
                  2026-04-24: the unified Workers page already shows FM + LL
                  from the lumid_cluster registry (filter by role). The old
                  legacy page hit the Lumilake service directly — pre-cluster
                  architecture. /app/admin/lumilake-workers redirects to the
                  unified view (with role=lumilake pre-filtered). */}
              <Route
                element={
                  <AdminSectionLayout
                    title="Infrastructure"
                    subtitle="Clusters and the FlowMesh + Lumilake worker fleet."
                    tabs={[
                      { to: "/dashboard/admin/clusters", label: "Clusters", end: true },
                      { to: "/dashboard/admin/cluster-workers", label: "Workers" },
                    ]}
                  />
                }
              >
                <Route path="clusters" element={<AppAdminClusters />} />
                <Route path="cluster-workers" element={<AppAdminClusterWorkers />} />
              </Route>
              <Route
                path="lumilake-workers"
                element={
                  <Navigate to="/dashboard/admin/cluster-workers?role=lumilake" replace />
                }
              />
              <Route path="clusters/new" element={<AppAdminClustersNew />} />
              <Route path="clusters/:id" element={<AppAdminClustersDetail />} />

              {/* Runmesh ops — 3 tabs (supplier lifecycle + reviews).
                  Billing moved to /app/billing (user-facing Account
                  section) on 2026-04-24 since it's a per-user surface,
                  not an admin-only concern. Legacy /app/admin/billing
                  redirects below. */}
              <Route
                element={
                  <AdminSectionLayout
                    title="Runmesh ops"
                    subtitle="GPU supplier lifecycle and workflow review."
                    tabs={[
                      { to: "/dashboard/admin/suppliers", label: "Suppliers", end: true },
                      { to: "/dashboard/admin/supplier-nodes", label: "Supplier nodes" },
                      { to: "/dashboard/admin/workflow-review", label: "Reviews" },
                    ]}
                  />
                }
              >
                <Route path="suppliers" element={<RunmeshSuppliers />} />
                <Route path="supplier-nodes" element={<RunmeshSupplierNodes />} />
                <Route path="workflow-review" element={<RunmeshWorkflowReview />} />
              </Route>
              <Route
                path="billing"
                element={<Navigate to="/dashboard/billing" replace />}
              />

              {/* QuantArena — 4 tabs */}
              <Route
                element={
                  <AdminSectionLayout
                    title="QuantArena"
                    subtitle="Trading platform admin — competitions, markets, templates, jobs."
                    tabs={[
                      { to: "/dashboard/admin/competitions", label: "Competitions", end: true },
                      { to: "/dashboard/admin/markets", label: "Portfolios" },
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

