import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AuthGuard } from "./components/auth-guard";
import { AdminGuard } from "./components/admin-guard";

// Lazy-load so first paint on /login doesn't fetch /account/tokens code.
const Login = lazy(() => import("./pages/login/login").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("./pages/login/register").then((m) => ({ default: m.Register })));
const Callback = lazy(() => import("./pages/auth/callback").then((m) => ({ default: m.AuthCallback })));
const Tokens = lazy(() => import("./pages/account/tokens"));
const Connect = lazy(() => import("./pages/account/connect"));
const Dashboard = lazy(() => import("./pages/account/dashboard"));
const AdminInvitations = lazy(() => import("./pages/account/admin-invitations"));
const AdminHub = lazy(() => import("./pages/account/admin-hub"));

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

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
