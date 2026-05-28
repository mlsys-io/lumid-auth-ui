// /app/loops — your AI working for you.
//
// Three sections, outcome-first:
//   1. Today           — server-authored headlines (drafts pending,
//                        cycle outcomes, "free tier reached" banner).
//                        Sourced from /me/today which aggregates the
//                        tenant's journal.jsonl + drafts state.
//   2. Drafts & decisions — pending drafts with confirm / edit /
//                        dismiss. Send queues a picker intent that
//                        runs the actual Gmail call in the tenant
//                        context with their OAuth grant.
//   3. What it does    — installed loops with Run-now + Pause. Each
//                        card surfaces the next-run countdown so the
//                        user knows when the AI fires next.
//
// No machinery surfaced. No quota numbers, no token counts, no eval
// scores. The page is the user's contract with the AI — "I tell you
// what to do; you do it and ask when uncertain."

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatRelative } from "@/lib/relative-time";
import { DEMO_MODE, DEMO_WORKFLOW_APPS } from "@/lib/demo";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  Pause,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import { cn } from "@/lib/utils";

// ── Section 1: Today ──────────────────────────────────────────────

type Headline = Awaited<ReturnType<typeof me.today>>["headlines"][number];

const HEADLINE_STYLE: Record<Headline["kind"], { icon: typeof Sparkles; cls: string }> = {
  quota_paused: { icon: AlertCircle, cls: "border-amber-200 bg-amber-50 text-amber-900" },
  drafts:       { icon: Mail,        cls: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  brief:        { icon: Sparkles,    cls: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  cycle_ok:     { icon: CheckCircle2,cls: "border-slate-200 bg-slate-50 text-slate-800" },
  cycle_failed: { icon: AlertCircle, cls: "border-rose-200 bg-rose-50 text-rose-900" },
};

function TodaySection() {
  const [data, setData] = useState<Awaited<ReturnType<typeof me.today>> | null>(null);

  useEffect(() => {
    me.today().then(setData).catch(() => setData({ headlines: [], cycles: [], as_of: "" }));
  }, []);

  if (data === null) return <SectionFrame title="Today"><Skeleton lines={3} /></SectionFrame>;

  if (data.headlines.length === 0) {
    return (
      <SectionFrame title="Today">
        <div className="text-sm text-slate-500 italic">
          Nothing to show yet. Your AI&apos;s next cycle will surface here.
        </div>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame title="Today">
      <ul className="space-y-2">
        {data.headlines.map((h, i) => {
          const { icon: Icon, cls } = HEADLINE_STYLE[h.kind] ?? HEADLINE_STYLE.cycle_ok;
          return (
            <li
              key={`${h.kind}-${i}`}
              className={cn("rounded-lg border px-3 py-2 flex items-start gap-3", cls)}
            >
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{h.summary}</div>
                {h.detail && <div className="mt-0.5 text-xs opacity-80">{h.detail}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </SectionFrame>
  );
}

// ── Section 2: Drafts & decisions ─────────────────────────────────

type DraftRow = Awaited<ReturnType<typeof me.listDrafts>>["drafts"][number];

function DraftsSection({ onChange }: { onChange: () => void }) {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await me.listDrafts({ state: "pending" });
      setDrafts(r.drafts);
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: "send" | "dismiss") => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      if (action === "send")    await me.sendDraft(id);
      if (action === "dismiss") await me.dismissDraft(id);
      toast.success(action === "send" ? "Draft sent" : "Dismissed");
      await load();
      onChange();
    } catch (e) {
      toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const startEdit = (d: DraftRow) => {
    setEditingId(d.id);
    setEditText(d.body || "");
  };

  const saveEdit = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await me.editDraft(id, { body: editText });
      toast.success("Draft updated");
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  if (drafts === null) return <SectionFrame title="Drafts & decisions"><Skeleton lines={2} /></SectionFrame>;
  if (drafts.length === 0) {
    return (
      <SectionFrame title="Drafts & decisions">
        <div className="text-sm text-slate-500 italic">No drafts pending — your AI will queue them here when it composes replies for you.</div>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame title="Drafts & decisions">
      <ul className="space-y-3">
        {drafts.map((d) => (
          <li key={d.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500">
                  To <span className="font-medium text-slate-700">{d.to || "—"}</span>
                </div>
                <div className="font-medium text-sm mt-0.5">{d.subject || "(no subject)"}</div>
              </div>
              <div className="shrink-0 inline-flex items-center gap-1.5">
                <button
                  onClick={() => act(d.id, "send")}
                  disabled={!!busy[d.id]}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {busy[d.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Send
                </button>
                <button
                  onClick={() => startEdit(d)}
                  disabled={!!busy[d.id]}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => act(d.id, "dismiss")}
                  disabled={!!busy[d.id]}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            {editingId === d.id ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded p-2 font-sans"
                  rows={5}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50"
                  >Cancel</button>
                  <button
                    onClick={() => saveEdit(d.id)}
                    disabled={!!busy[d.id]}
                    className="px-3 py-1 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                  >Save</button>
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap line-clamp-4">
                {d.body || ""}
              </div>
            )}
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}

// ── Section 3: What it does (loops) ───────────────────────────────

interface LoopRow {
  app: string;
  loop: string;
  schedule?: string;
  enabled?: boolean;
  last_run_ts?: string;
  consecutive_failures?: number;
}

type Busy = "running" | "starting" | "stopping" | null;

function LoopsSection() {
  const [rows, setRows] = useState<LoopRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Map<string, Busy>>(new Map());

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await me.loopsHealth();
      const list = (r as unknown as { loops?: LoopRow[] }).loops ?? (r as unknown as LoopRow[]) ?? [];
      // Demo IA: surface only the two demo apps' loops. Reverts when
      // VITE_DEMO_MODE=false. See src/lib/demo.ts.
      const shown = DEMO_MODE
        ? list.filter((l) => (DEMO_WORKFLOW_APPS as readonly string[]).includes(l.app))
        : list;
      setRows(shown);
    } catch (e) {
      setError(e instanceof MeApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const k = (r: LoopRow) => `${r.app}:${r.loop}`;
  const setOne = (key: string, v: Busy) =>
    setBusy((m) => { const n = new Map(m); n.set(key, v); return n; });

  const toggle = async (r: LoopRow) => {
    const target = !r.enabled;
    setOne(k(r), target ? "starting" : "stopping");
    try {
      await me.patchLoop(r.app, r.loop, { enabled: target });
      toast.success(target ? `${r.loop} resumed` : `${r.loop} paused`);
      await load();
    } catch (e) {
      toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
    } finally {
      setOne(k(r), null);
    }
  };

  const runNow = async (r: LoopRow) => {
    setOne(k(r), "running");
    try {
      await me.runLoopNow(r.app, r.loop);
      toast.success("Queued — result will appear in Today shortly.");
    } catch (e) {
      toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
    } finally {
      setOne(k(r), null);
    }
  };

  if (rows === null) return <SectionFrame title="What it does"><Skeleton lines={3} /></SectionFrame>;
  if (rows.length === 0) {
    return (
      <SectionFrame title="What it does">
        <div className="text-sm text-slate-500 italic">
          No loops yet. <Link to="/studio/library" className="text-emerald-700 hover:underline">Browse the marketplace</Link> to add some.
        </div>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame title="What it does">
      {error && (
        <div className="mb-3 text-sm rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      <ul className="space-y-2">
        {rows.map((r) => {
          const b = busy.get(k(r));
          const failing = (r.consecutive_failures ?? 0) > 0;
          return (
            <li key={k(r)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{humanizeLoop(r.loop)}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {formatRelative(r.last_run_ts) === "—" ? "Hasn't run yet" : `Last ran ${formatRelative(r.last_run_ts)}`}
                  {failing && (
                    <span className="ml-2 text-rose-700">
                      · {r.consecutive_failures} consecutive failure{r.consecutive_failures === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 inline-flex items-center gap-1.5">
                <button
                  onClick={() => runNow(r)}
                  disabled={!!b}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 transition-all shadow-sm shadow-emerald-100"
                >
                  {b === "running" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Run now
                </button>
                <button
                  onClick={() => toggle(r)}
                  disabled={!!b}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                  title={r.enabled ? "Pause this loop" : "Resume this loop"}
                >
                  {b === "starting" || b === "stopping" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : r.enabled ? (
                    <Pause className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  {r.enabled ? "Pause" : "Resume"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionFrame>
  );
}

// ── Shared ─────────────────────────────────────────────────────────

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2.5">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

function humanizeLoop(loop: string): string {
  const map: Record<string, string> = {
    morning_brief: "Morning brief",
    hourly_triage: "Hourly triage",
    weekly_reflection: "Weekly reflection",
    cc_watcher: "Claude Code watcher",
  };
  if (map[loop]) return map[loop];
  return loop.charAt(0).toUpperCase() + loop.slice(1).replace(/_/g, " ");
}


// ── Page ──────────────────────────────────────────────────────────

export default function AppLoops() {
  const [params, setParams] = useSearchParams();
  const justInstalled = params.get("installed");

  // Clear the one-time banner after first paint so refresh doesn't loop.
  useEffect(() => {
    if (justInstalled) {
      // Keep the query for one render then strip it.
      const t = setTimeout(() => {
        setParams((p) => { p.delete("installed"); p.delete("intent"); return p; }, { replace: true });
      }, 8000);
      return () => clearTimeout(t);
    }
  }, [justInstalled, setParams]);

  // Refresh Today after a draft action so the headlines reflect the new count.
  const [todayKey, setTodayKey] = useState(0);
  const bumpToday = () => setTodayKey((k) => k + 1);

  return (
    <div className="space-y-6">
      {/* Page identity in StudioShell top-bar — no local H1. */}
      {justInstalled && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900 flex items-center gap-3">
          <Sparkles className="w-4 h-4 shrink-0 text-emerald-600" />
          <div className="flex-1">Your AI is set up. The next cycle will fire on schedule — or use Run now to try it immediately.</div>
        </div>
      )}

      <div key={todayKey}>
        <TodaySection />
      </div>
      <DraftsSection onChange={bumpToday} />
      <LoopsSection />
    </div>
  );
}
