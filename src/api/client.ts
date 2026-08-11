import axios, { type AxiosInstance, type AxiosResponse, AxiosError } from "axios";
import { API_BASE_URL } from "../config/env";
import type { ErrorResponse } from "./types";

export class ApiError extends Error {
  ret_code: number;
  response?: AxiosResponse;
  constructor(ret_code: number, message: string, response?: AxiosResponse) {
    super(message);
    this.name = "ApiError";
    this.ret_code = ret_code;
    this.response = response;
  }
}

// Single source of truth for "your session is gone, go log in again".
// Without this, N concurrent in-flight requests that each 401 would each
// trigger a redirect / toast, with the fastest-to-resolve winning and the
// rest spamming the UI. We dispatch one CustomEvent; a top-level listener
// in AuthProvider handles the clean-up + navigation. Pages still get the
// ApiError(401) as a rejected promise so any in-progress UI state can
// settle, they just shouldn't toast it.
let sessionExpiredFired = false;
function notifySessionExpired() {
  if (sessionExpiredFired) return;
  sessionExpiredFired = true;
  // Reset on the next tick so a *new* session can expire later without a reload.
  setTimeout(() => {
    sessionExpiredFired = false;
  }, 10_000);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("lumid:session-expired"));
  }
}

// The session endpoint. A 401 from THIS is unambiguous — the session really is
// gone — so it short-circuits the confirmation probe below.
const SESSION_PROBE_PATH = "/api/v1/user";

// Not every 401 means "your session expired".
//
// Services behind lum.id also answer 401 for "authenticated, but this token
// lacks the scope for this endpoint" — `/api/v1/cluster/clusters/selectable` is
// the one that bit us. Treating those as expiry logged people out of a working
// session: Studio would load, every core call would succeed, and then one
// unrelated background call would 401 and bounce them to /auth/login.
//
// So before declaring expiry, ASK. One cheap re-check of the session endpoint
// distinguishes the two cases definitively:
//   probe 200 → session is alive; that 401 was a permission problem. Stay put.
//   probe 401 → session really is gone. Fire.
// Deliberately a bare axios call, not apiClient — going back through this
// interceptor would recurse.
async function confirmSessionGone(): Promise<boolean> {
  try {
    const r = await axios.get(SESSION_PROBE_PATH, {
      baseURL: API_BASE_URL,
      withCredentials: true,
      timeout: 10_000,
      // Any status resolves, so a 401 lands here rather than in catch.
      validateStatus: () => true,
    });
    return r.status === 401;
  } catch {
    // Network error, timeout, offline: we genuinely can't tell. Don't log the
    // user out on a blip — a wrong "session expired" costs their in-progress
    // work, a missed one costs one more failed request.
    return false;
  }
}

/** True when an error is the 401 envelope the response interceptor emits.
 *  Use in `.catch` blocks so pages can skip their own error toast for
 *  session-expired cases (the AuthProvider listener already handles UX). */
export function isSessionExpired(e: unknown): boolean {
  return e instanceof ApiError && e.ret_code === 401;
}

// One axios instance used site-wide. withCredentials so the .lum.id
// lm_session cookie rides on every call — we never touch localStorage
// because the cookie is HttpOnly by design.
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
  paramsSerializer: { indexes: null },
});

// Normalize LQA's ret_code envelope into a thrown ApiError, and
// surface 401 cleanly so calling code can tell "bad input" from
// "session gone".
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    if (
      response.data &&
      typeof response.data === "object" &&
      "ret_code" in response.data
    ) {
      const { ret_code, message } = response.data as ErrorResponse;
      if (ret_code !== 0) {
        throw new ApiError(ret_code, message || "Request failed", response);
      }
    }
    return response;
  },
  (error: AxiosError<ErrorResponse>) => {
    if (error.response?.status === 401) {
      // Dedupe: all concurrent 401s produce exactly one
      // `lumid:session-expired` event, which AuthProvider listens
      // for and turns into one navigation. Pages still reject here
      // so their own async work can abort cleanly.
      const from = error.config?.url || "";
      if (from.includes(SESSION_PROBE_PATH)) {
        // Straight from the session endpoint — no ambiguity, no probe.
        notifySessionExpired();
      } else if (!sessionExpiredFired) {
        // Confirm before logging anyone out. Fire-and-forget: the caller's
        // rejection below must not wait on the probe.
        void confirmSessionGone().then((gone) => {
          if (gone) notifySessionExpired();
        });
      }
      return Promise.reject(new ApiError(401, "unauthenticated", error.response));
    }
    const data = error.response?.data;
    if (data && typeof data === "object" && "ret_code" in data) {
      return Promise.reject(
        new ApiError(data.ret_code as number, data.message || error.message, error.response)
      );
    }
    return Promise.reject(
      new ApiError(error.response?.status || -1, error.message, error.response)
    );
  }
);

export default apiClient;
