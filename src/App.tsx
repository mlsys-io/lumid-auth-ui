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
            <Route
              path="admin/invitations"
              element={
                <AdminGuard>
                  <AdminInvitations />
                </AdminGuard>
              }
            />
            <Route
              path="admin/runmesh"
              element={
                <AdminGuard>
                  <Outlet />
                </AdminGuard>
              }
            >
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<RunmeshAdminDashboard />} />
              <Route path="users" element={<RunmeshUsers />} />
              <Route path="nodes" element={<RunmeshNodes />} />
              <Route path="suppliers" element={<RunmeshSuppliers />} />
              <Route path="supplier-nodes" element={<RunmeshSupplierNodes />} />
              <Route path="billing" element={<RunmeshBilling />} />
              <Route path="workflow-review" element={<RunmeshWorkflowReview />} />
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

