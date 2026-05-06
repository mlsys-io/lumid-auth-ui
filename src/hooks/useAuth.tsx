import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { getUserInfo, logout as logoutApi } from "../api";
import type { UserInfo } from "../api";

// The identity backend sets an HttpOnly `lm_session` cookie on
// .lum.id after /login. We never touch it from JS — instead, every
// app call either succeeds (cookie present + valid) or 401s. Auth
// state is therefore derived from `getUserInfo()`, not from any
// localStorage slot.

interface AuthContextType {
  user: UserInfo | null;
  isLoading: boolean;
  /** Called from the login page after the backend has set the cookie.
   *  `token` kept for source-compat with the ported lumid.market
   *  component — we ignore it. */
  login: (token: string, userData: UserInfo) => void;
  logout: () => Promise<void>;
  /** Refetch /api/v1/user — used after invitation-code redeem so the
   *  AuthGuard sees the populated `invitation_code` field without a
   *  full reload. */
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const info = await getUserInfo();
        setUser(info);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Central session-expired handler. api/client.ts emits this event
  // exactly once per expiry (even if N requests 401 at the same time),
  // so we don't race multiple redirects or stack toasts. We clear the
  // React user so AuthGuards re-render into the login redirect naturally
  // — no `window.location.replace` needed on the happy path.
  useEffect(() => {
    function onExpired() {
      setUser(null);
      // Guarded pages immediately Navigate to /auth/login with a
      // return_to pointing at the current URL. Unguarded pages
      // (/auth/*) do nothing, which is correct.
    }
    window.addEventListener("lumid:session-expired", onExpired);
    return () => window.removeEventListener("lumid:session-expired", onExpired);
  }, []);

  const login = (_token: string, userData: UserInfo) => {
    setUser(userData);
  };

  const logout = async () => {
    try {
      await logoutApi();
    } catch {
      /* best-effort */
    } finally {
      setUser(null);
    }
  };

  const refreshUser = async () => {
    try {
      const info = await getUserInfo();
      setUser(info);
    } catch {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        refreshUser,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
