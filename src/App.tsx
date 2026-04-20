import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthGuard } from "./components/auth-guard";
import { AdminGuard } from "./components/admin-guard";

// Lazy-load so first paint on /login doesn't fetch /account/tokens code.
const Login = lazy(() => import("./pages/login/login").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("./pages/login/register").then((m) => ({ default: m.Register })));
const Callback = lazy(() => import("./pages/auth/callback").then((m) => ({ default: m.AuthCallback })));
const ForgotPassword = lazy(() => import("./pages/auth/forgot-password"));
const ResetPassword = lazy(() => import("./pages/auth/reset-password"));
const Tokens = lazy(() => import("./pages/account/tokens"));
const Connect = lazy(() => import("./pages/account/connect"));
const Dashboard = lazy(() => import("./pages/account/dashboard"));
const Profile = lazy(() => import("./pages/account/profile"));
const AdminInvitations = lazy(() => import("./pages/account/admin-invitations"));
const AdminHub = lazy(() => import("./pages/account/admin-hub"));
const RunmeshAdminLayout = lazy(() => import("./pages/account/admin/runmesh-layout"));
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

// Tiny wrapper — the copied login.tsx takes the same onLogin signature
// the lumid.market LoginPage uses, so we adapt here instead of
// modifying the page component.
function LoginPage() {
  const { login } = useAuth();
  return (
    <Login
      onLogin={(token, user) => {
        login(token, user);
        // AuthProvider handles the redirect via AuthGuard
      }}
    />
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  return (
    <Register
      onSwitchToLogin={() => navigate("/login")}
      onRegisterSuccess={() => navigate("/login")}
    />
  );
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
          <Route
            path="/login"
            element={
              <AuthGuard requireAuth={false}>
                <LoginPage />
              </AuthGuard>
            }
          />
          <Route
            path="/register"
            element={
              <AuthGuard requireAuth={false}>
                <RegisterPage />
              </AuthGuard>
            }
          />
          <Route path="/callback" element={<Callback />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Authed-only /account routes */}
          <Route
            path="/account"
            element={
              <AuthGuard requireAuth={true}>
                <Dashboard />
              </AuthGuard>
            }
          />
          <Route
            path="/account/profile"
            element={
              <AuthGuard requireAuth={true}>
                <Profile />
              </AuthGuard>
            }
          />
          <Route
            path="/account/tokens"
            element={
              <AuthGuard requireAuth={true}>
                <Tokens />
              </AuthGuard>
            }
          />
          <Route
            path="/account/connect"
            element={
              <AuthGuard requireAuth={true}>
                <Connect />
              </AuthGuard>
            }
          />
          <Route
            path="/account/admin"
            element={
              <AdminGuard>
                <AdminHub />
              </AdminGuard>
            }
          />
          <Route
            path="/account/admin/invitations"
            element={
              <AdminGuard>
                <AdminInvitations />
              </AdminGuard>
            }
          />
          <Route
            path="/account/admin/runmesh"
            element={
              <AdminGuard>
                <RunmeshAdminLayout />
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

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
