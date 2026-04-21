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

// The unified shell + content pages render under /dashboard/*
const DashboardLayout = lazy(() => import("./components/dashboard-layout"));
const Overview = lazy(() => import("./pages/dashboard/overview"));
const Profile = lazy(() => import("./pages/account/profile"));
const Tokens = lazy(() => import("./pages/account/tokens"));
const Connect = lazy(() => import("./pages/account/connect"));
const AdminInvitations = lazy(() => import("./pages/account/admin-invitations"));
const RunmeshAdminDashboard = lazy(() =>
  import("./runmesh/pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const RunmeshUsers = lazy(() =>
  import("./runmesh/pages/UserManagement").then((m) => ({ default: m.UserManagement })),
);
const RunmeshNodes = lazy(() =>
  import("./runmesh/pages/NodeManagement").then((m) => ({ default: m.NodeManagement })),
);
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
const AppProfile = lazy(() => import("./pages/app/profile"));
const AppSchedules = lazy(() => import("./pages/app/schedules"));
const AppApiDocs = lazy(() => import("./pages/app/api-docs"));
const AppGpuRentals = lazy(() => import("./pages/app/gpu-rentals"));
const AppGpuRentalDetail = lazy(() => import("./pages/app/gpu-rental-detail"));
// Lumilake-origin pages (grouped under /app/lumilake/*)
const AppLumilakeDashboard = lazy(() => import("./pages/app/lumilake/dashboard"));
const AppLumilakeData = lazy(() => import("./pages/app/lumilake/data"));
const AppLumilakeDataLabel = lazy(() => import("./pages/app/lumilake/data-label"));
const AppLumilakeSQL = lazy(() => import("./pages/app/lumilake/sql"));
const AppLumilakePython = lazy(() => import("./pages/app/lumilake/python"));
const AppLumilakeLowCode = lazy(() => import("./pages/app/lumilake/low-code"));
const AppLumilakeModelling = lazy(() => import("./pages/app/lumilake/modelling"));
const AppLumilakeJobs = lazy(() => import("./pages/app/lumilake/jobs"));
// Lumilake admin pages stay under /app/admin/*
const AppAdminLumilakeWorkers = lazy(() => import("./pages/app/admin-workers"));
const AppAdminLumilakeUsers = lazy(() => import("./pages/app/admin-lumilake-users"));

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

// /auth/account/<tail> and /auth/dashboard/<tail> both rewrite to
// /dashboard/<tail> so every stale bookmark keeps working.
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
          {/* Identity shell — /dashboard/* holds profile + tokens + installer. */}
          <Route
            path="/dashboard"
            element={
              <AuthGuard requireAuth={true}>
                <DashboardLayout />
              </AuthGuard>
            }
          >
            <Route index element={<Overview />} />
            <Route path="profile" element={<Profile />} />
            <Route path="tokens" element={<Tokens />} />
            <Route path="connect" element={<Connect />} />
            {/* Admin routes moved under /app/admin/* — redirect old bookmarks. */}
            <Route path="admin" element={<Navigate to="/app/admin" replace />} />
            <Route path="admin/invitations" element={<Navigate to="/app/admin/invitations" replace />} />
            <Route path="admin/runmesh" element={<Navigate to="/app/admin" replace />} />
            <Route path="admin/runmesh/dashboard" element={<Navigate to="/app/admin" replace />} />
            <Route path="admin/runmesh/users" element={<Navigate to="/app/admin/users" replace />} />
            <Route path="admin/runmesh/nodes" element={<Navigate to="/app/admin/nodes" replace />} />
            <Route path="admin/runmesh/suppliers" element={<Navigate to="/app/admin/suppliers" replace />} />
            <Route path="admin/runmesh/supplier-nodes" element={<Navigate to="/app/admin/supplier-nodes" replace />} />
            <Route path="admin/runmesh/billing" element={<Navigate to="/app/admin/billing" replace />} />
            <Route path="admin/runmesh/workflow-review" element={<Navigate to="/app/admin/workflow-review" replace />} />
          </Route>

          {/* Product + admin at /app/*. One shell, sidebar gates admin by role. */}
          <Route
            path="/app"
            element={
              <AuthGuard requireAuth={true}>
                <AppLayout />
              </AuthGuard>
            }
          >
            <Route index element={<AppApps />} />
            <Route path="workflows" element={<AppWorkflows />} />
            <Route path="workflows/:id" element={<AppWorkflowDetail />} />
            <Route path="workflow" element={<AppWorkflowBuilder />} />
            <Route path="workflow/:id" element={<AppWorkflowBuilder />} />
            <Route path="n8n" element={<AppN8n />} />
            <Route path="n8n/:id" element={<AppN8n />} />
            <Route path="tasks" element={<AppTasks />} />
            <Route path="billing" element={<AppBilling />} />
            <Route path="profile" element={<AppProfile />} />
            <Route path="schedules" element={<AppSchedules />} />
            <Route path="api-docs" element={<AppApiDocs />} />
            <Route path="gpu-rentals" element={<AppGpuRentals />} />
            <Route path="gpu-rentals/:id" element={<AppGpuRentalDetail />} />

            {/* Lumilake-origin pages grouped under /app/lumilake/*. */}
            <Route path="lumilake">
              <Route index element={<AppLumilakeDashboard />} />
              <Route path="data" element={<AppLumilakeData />} />
              <Route path="data-label" element={<AppLumilakeDataLabel />} />
              <Route path="sql" element={<AppLumilakeSQL />} />
              <Route path="python" element={<AppLumilakePython />} />
              <Route path="low-code" element={<AppLumilakeLowCode />} />
              <Route path="modelling" element={<AppLumilakeModelling />} />
              <Route path="jobs" element={<AppLumilakeJobs />} />
            </Route>

            {/* Admin section — same shell, gated by role. */}
            <Route
              path="admin"
              element={
                <AdminGuard>
                  <Outlet />
                </AdminGuard>
              }
            >
              <Route index element={<RunmeshAdminDashboard />} />
              <Route path="users" element={<RunmeshUsers />} />
              <Route path="nodes" element={<RunmeshNodes />} />
              <Route path="suppliers" element={<RunmeshSuppliers />} />
              <Route path="supplier-nodes" element={<RunmeshSupplierNodes />} />
              <Route path="billing" element={<RunmeshBilling />} />
              <Route path="workflow-review" element={<RunmeshWorkflowReview />} />
              <Route path="invitations" element={<AdminInvitations />} />
              <Route path="lumilake-workers" element={<AppAdminLumilakeWorkers />} />
              <Route path="lumilake-users" element={<AppAdminLumilakeUsers />} />
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

