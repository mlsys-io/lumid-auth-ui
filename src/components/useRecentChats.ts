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

export function useRecentChats(limit = 8): RecentChatItem[] {
  const [items, setItems] = useState<RecentChatItem[]>([]);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/v1/me/chats", { credentials: "include" });
        if (!r.ok) return;
        const j = await r.json();
        const rows: HistoryRow[] = j?.data?.chats || [];
        if (!live) return;
        const mapped = rows
          .map((h) => ({
            kind: (h.app ? "agent" : "chat") as RecentChatItem["kind"],
            id: h.id,
            title: h.title,
            app: h.app,
            updatedAt: +new Date(h.updated_at),
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit);
        setItems(mapped);
      } catch { /* soft-fail; sidebar just shows no Recent section */ }
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

  return items;
}
