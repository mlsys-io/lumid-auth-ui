// Per-app "latest session" map { app: chatId }, so re-entering an app resumes
// its most-recent conversation instead of dumping into whatever was open.
//
// This lived inside StudioChat, but the sidebar now needs to clear an app's
// pointer too ("New chat" inside an app folder must start a fresh thread
// rather than resume the last one). Two copies of a localStorage key is how
// they silently drift, so it lives here and both import it.

export const APP_CHAT_MAP_KEY = "studio_app_chat_v1";
export const CHAT_ID_KEY = "studio_chat_active_id_v1";

export function readAppChatMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(APP_CHAT_MAP_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function writeAppChat(app: string, chatId: string | null) {
  if (!app) return;
  try {
    const m = readAppChatMap();
    if (chatId) m[app] = chatId;
    else delete m[app];
    localStorage.setItem(APP_CHAT_MAP_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

// Forget a chatId everywhere it could be resumed from (per-app resume map +
// the persisted active id), so a DELETED conversation can't reappear when you
// re-enter the app. Without this, the prop-driven grounding resumes the
// per-app thread on every entry — including one you just deleted.
export function forgetChatId(id: string) {
  if (!id) return;
  try {
    const m = readAppChatMap();
    let changed = false;
    for (const k of Object.keys(m)) if (m[k] === id) { delete m[k]; changed = true; }
    if (changed) localStorage.setItem(APP_CHAT_MAP_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
  try {
    if (localStorage.getItem(CHAT_ID_KEY) === id) localStorage.removeItem(CHAT_ID_KEY);
  } catch {
    /* ignore */
  }
}
