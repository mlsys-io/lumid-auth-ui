// Recent chats for the Studio sidebar's claude.ai-style "Recent" list.
// Two kinds, distinguished by how the right-hand pane opens a thread:
// 'chat' = bare (opens at /studio), 'agent' = grounded (opens docked at
// /studio/apps/:app). Both are the same StudioChat component under the
// hood — the kind is just whether the saved thread carries an `app`.
// Mirrors useAppNav's fetch + poll + invalidate-event shape.

import { useEffect, useState } from "react";

export const RECENT_CHATS_INVALIDATE = "studio:recent-invalidate";
const POLL_MS = 30_000;

interface HistoryRow {
  id: string;
  title: string;
  updated_at: string;
  msg_count: number;
  app?: string;
}

export interface RecentChatItem {
  kind: "chat" | "agent";
  id: string;
  title: string;
  app?: string;
  updatedAt: number;
}

// `loaded` lets the sidebar tell "still fetching" apart from "genuinely no
// chats yet". Without it an empty list and a broken fetch look identical,
// which reads to the user as the whole section being missing.
// 20, not 8: every debounced save fires studio:recent-invalidate, so the
// open thread keeps bumping to the top and a short list visibly pushes
// older rows off the end mid-session.
export function useRecentChats(limit = 20): { items: RecentChatItem[]; loaded: boolean } {
  const [items, setItems] = useState<RecentChatItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/v1/me/chats", { credentials: "include" });
        if (!r.ok) { if (live) setLoaded(true); return; }
        const j = await r.json();
        const rows: HistoryRow[] = j?.data?.chats || [];
        if (!live) return;
        // The server already returns these newest-updated first. Re-sorting
        // on a NaN key (any record with an empty/unparseable updated_at)
        // makes the comparator inconsistent, and JS then reorders rows
        // arbitrarily between polls — which looks like conversations
        // randomly disappearing. Keep the server's order, and only use the
        // timestamp as a NaN-safe tiebreak.
        const mapped = rows
          .map((h, i) => {
            const t = Date.parse(h.updated_at);
            return {
              kind: (h.app ? "agent" : "chat") as RecentChatItem["kind"],
              id: h.id,
              title: h.title,
              app: h.app,
              updatedAt: Number.isNaN(t) ? 0 : t,
              _i: i,
            };
          })
          .sort((a, b) => (b.updatedAt - a.updatedAt) || (a._i - b._i))
          .slice(0, limit)
          .map(({ _i, ...item }) => item);
        setItems(mapped);
        setLoaded(true);
      } catch {
        // soft-fail: mark loaded so the section shows its empty state
        // rather than sitting on a spinner forever.
        if (live) setLoaded(true);
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    const onInvalidate = () => tick();
    const onFocus = () => tick();
    window.addEventListener(RECENT_CHATS_INVALIDATE, onInvalidate);
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.clearInterval(id);
      window.removeEventListener(RECENT_CHATS_INVALIDATE, onInvalidate);
      window.removeEventListener("focus", onFocus);
    };
  }, [limit]);

  return { items, loaded };
}
