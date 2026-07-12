import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { getUserInfo, logout as logoutApi } from "../api";
import type { UserInfo } from "../api";
import { clearDataLakeCache } from "../api/dataLake";

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

// Exported so non-page consumers (e.g. app-surface directives, which may also
// render on public docs pages OUTSIDE an AuthProvider) can read auth state
// DEFENSIVELY via useContext without useAuth()'s throw-when-absent contract.
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
      // Wipe any user-owned client state that survives the session
      // cookie. Chat history (in sessionStorage) is the load-bearing
      // case: previously, signing out + signing in as someone else on
      // the same tab leaked the prior user's conversation. Belt-and-
      // suspenders alongside the user_sub-tagged guards in chat-widget
      // and StudioChat.
      try {
        sessionStorage.removeItem("lumid:chat:v1");
        // StudioChat sidebar — conversation + the per-conversation
        // identifiers that bind it to a user (transcript, active chat id,
        // grounding agent, persona). UI prefs (model/mode/think/width/
        // collapse) are not conversation content, so they can persist.
        sessionStorage.removeItem("studio_chat_transcript_v1");
        localStorage.removeItem("studio_chat_active_id_v1");
        localStorage.removeItem("studio_chat_agent_v1");
        localStorage.removeItem("studio_chat_persona_v1");
        // Data-lake catalog cache (sessionStorage) is bearer-scoped — wipe it
        // so the next user on this tab can't see the prior session's schema
        // /table shape before revalidation.
        clearDataLakeCache();
      } catch { /* private mode / quota */ }
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
