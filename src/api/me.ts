// Typed client for the new /api/v1/me/* surface on lumid-identity.
//
// All calls cross-origin from the xp.io/go bundle → lum.id; the CORS
// middleware on lumid-identity (handler/router.go::meCORS) allows the
// xp.io and lum.id origins with credentials. Browser auto-sends the
// `lm_session` cookie (Domain=.lum.id) so no manual auth header is
// needed when the user is signed in via the lum.id auth flow. For
// PAT-based auth (CLI parity), pass via `Authorization: Bearer …`.
//
// All responses follow the lumid-identity envelope:
//   { ret_code: number, message: string, data: any }
// We unwrap `.data` on success and throw on non-2xx or non-zero ret_code.

const ME_BASE =
  // Vite-inlined env. In prod (lum.id deploy) and xp.io/go deploy both
  // call lum.id since that's where lumid-identity lives.
  (import.meta.env.VITE_ME_API_BASE as string | undefined) || "https://lum.id";

export class MeApiError extends Error {
  ret_code: number;
  status: number;
  constructor(status: number, ret_code: number, message: string) {
    super(message);
    this.name = "MeApiError";
    this.status = status;
    this.ret_code = ret_code;
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${ME_BASE}/api/v1/me${path}`, {
    method,
    headers,
    body: payload,
    credentials: "include", // send lm_session cookie cross-origin
  });
  let json: { ret_code?: number; message?: string; data?: T } = {};
  try {
    json = await r.json();
  } catch {
    /* empty / non-JSON body */
  }
  if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) {
    throw new MeApiError(
      r.status,
      json.ret_code ?? r.status,
      json.message ?? r.statusText,
    );
  }
  return (json.data ?? ({} as T));
}

// ── Apps ─────────────────────────────────────────────────────────────────

export interface MeAppCard {
  name: string;
  has_manifest: boolean;
  has_xpcloud: boolean;
  has_user_overrides: boolean;
}

export interface MeIntentResult {
  intent_id: string;
  status: "pending" | "completed";
  intent?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export const me = {
  // Apps
  listApps: () => call<{ apps: MeAppCard[] }>("GET", "/apps"),
  installApp: (slug: string, runtime: "local" | "cloud" = "local", as?: string) =>
    call<{ intent_id: string; status: "pending" }>("POST", "/apps", { slug, runtime, as }),
  uninstallApp: (app: string) =>
    call<{ intent_id: string; status: "pending" }>("DELETE", `/apps/${encodeURIComponent(app)}`),
  getIntent: (id: string) =>
    call<MeIntentResult>("GET", `/intents/${encodeURIComponent(id)}`),

  // Loops
  patchLoop: (
    app: string,
    loop: string,
    body: { runtime?: "local" | "cloud"; schedule?: string; enabled?: boolean },
  ) =>
    call<{ app: string; loop: string; overrides: Record<string, unknown> }>(
      "PATCH",
      `/loops/${encodeURIComponent(app)}/${encodeURIComponent(loop)}`,
      body,
    ),
  runLoopNow: (app: string, loop: string, args?: Record<string, unknown>) =>
    call<{ job_id: string; state: string }>(
      "POST",
      `/loops/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/run`,
      { args },
    ),
  loopsHealth: () => call<{ loops: unknown[] }>("GET", "/loops/health"),

  // Secrets — values never come back; only presence.
  listSecrets: (app: string) =>
    call<{ app: string; secrets: { key: string; is_set: boolean; updated_at: string }[] }>(
      "GET",
      `/apps/${encodeURIComponent(app)}/secrets`,
    ),
  putSecret: (app: string, key: string, value: string) =>
    call<{ app: string; key: string; is_set: true; updated_at: string }>(
      "PUT",
      `/apps/${encodeURIComponent(app)}/secrets/${encodeURIComponent(key)}`,
      { value },
    ),
  deleteSecret: (app: string, key: string) =>
    call<{ app: string; key: string }>(
      "DELETE",
      `/apps/${encodeURIComponent(app)}/secrets/${encodeURIComponent(key)}`,
    ),
};

// Poll helper — convenience for intent completion.
export async function waitForIntent(
  id: string,
  opts: { everyMs?: number; timeoutMs?: number } = {},
): Promise<MeIntentResult> {
  const every = opts.everyMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  while (true) {
    const r = await me.getIntent(id);
    if (r.status === "completed") return r;
    if (Date.now() > deadline) {
      throw new MeApiError(0, 1408, `intent ${id} did not complete in ${opts.timeoutMs ?? 120_000}ms`);
    }
    await new Promise((res) => setTimeout(res, every));
  }
}
