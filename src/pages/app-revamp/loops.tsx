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
import RunSparkline from "@/components/RunSparkline";
import { RUNNING_APPS } from "@/lib/demo";

// The showcase apps the Studio surface scopes to. Keeps the demo focused
// on the Assemble → Adapt → Compound story instead of the operator's full
// fleet. Ambient (app-less) items always pass.
const inScope = (app?: string) => !app || (RUNNING_APPS as readonly string[]).includes(app);
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Lightbulb,
  Loader2,
  Mail,
  MinusCircle,
  Pause,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";
import { cn } from "@/lib/utils";

// ── Recent cycles (iteration timeline) ────────────────────────────
//
// Each cycle's honest outcome — ran / no_change / awaiting_review /
// no_setup, plus skips and failures shown as-is. Every row deep-links
// to the CycleInspector (/studio/intents/:app/:loop/:ts) where the
// observe gate, review queue (approve / edit / revamp), and compound
// offers live.

type CycleRow = Awaited<ReturnType<typeof me.today>>["cycles"][number];

const OUTCOME_META: Record<
  NonNullable<CycleRow["outcome"]>,
  { label: string; icon: typeof CheckCircle2; cls: string }
> = {
  ran:             { label: "Ran",                  icon: CheckCircle2, cls: "text-emerald-700" },
  no_change:       { label: "Skipped — no change",  icon: MinusCircle,  cls: "text-slate-500" },
  awaiting_review: { label: "Awaiting your review", icon: Clock,        cls: "text-amber-700" },
  no_setup:        { label: "Nothing to act on",    icon: MinusCircle,  cls: "text-slate-500" },
};

function cycleOutcome(c: CycleRow): { label: string; icon: typeof CheckCircle2; cls: string } {
  if (c.outcome && OUTCOME_META[c.outcome]) return OUTCOME_META[c.outcome];
  // Derive an honest outcome from legacy fields when summary.outcome
  // is absent (old cycles).
  if (c.skipped) return OUTCOME_META.no_change;
  if (!c.ok) return { label: "Failed", icon: AlertCircle, cls: "text-rose-700" };
  return OUTCOME_META.ran;
}

// Per-workflow run queue — adopts the old Workflows-page visual: each
// workflow shows a state dot (last run ok/failed) + a RunSparkline strip
// of its recent success/fail runs (oldest→newest), grouped by app. The
// row deep-links to the workflow's detail page.
type WfRow = Awaited<ReturnType<typeof me.listWorkflows>>["workflows"][number];

function CyclesSection() {
  const [rows, setRows] = useState<WfRow[] | null>(null);

  useEffect(() => {
    me.listWorkflows()
      .then((r) => setRows((r.workflows ?? []).filter((w) => inScope(w.app))))
      .catch(() => setRows([]));
  }, []);

  if (rows === null) return <SectionFrame title="Recent runs"><Skeleton lines={3} /></SectionFrame>;
  if (rows.length === 0) {
    return (
      <SectionFrame title="Recent runs">
        <div className="text-sm text-slate-500 italic">
          No workflows yet — start one above and its runs will queue up here.
        </div>
      </SectionFrame>
    );
  }

  // Group by app so each app's workflows sit together.
  const byApp = new Map<string, WfRow[]>();
  for (const w of rows) {
    const k = w.app || "—";
    const arr = byApp.get(k);
    if (arr) arr.push(w); else byApp.set(k, [w]);
  }

  return (
    <SectionFrame title="Recent runs">
      <div className="space-y-4">
        {[...byApp.entries()].map(([app, wfs]) => (
          <div key={app}>
            <div className="text-[11px] tracking-[0.06em] text-slate-400 mb-1.5">{app}</div>
            <ul className="space-y-1.5">
              {wfs.map((w) => {
                const dot =
                  w.last_run_ok === true ? "bg-emerald-500"
                  : w.last_run_ok === false ? "bg-rose-500"
                  : "bg-slate-300";
                const dotTitle =
                  w.last_run_ok === true ? "last run succeeded"
                  : w.last_run_ok === false ? "last run failed"
                  : "no runs yet";
                return (
                  <li key={w.slug}>
                    <Link
                      to={`/studio/workflows/${encodeURIComponent(w.slug)}`}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50 transition-colors"
                    >
                      <span className={cn("w-2 h-2 rounded-full shrink-0", dot)} title={dotTitle} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-800 truncate">
                          {w.name || humanizeLoop(w.slug)}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {w.last_run_ts ? `ran ${formatRelative(w.last_run_ts * 1000)}` : "no runs yet"}
                        </div>
                      </div>
                      <RunSparkline spec={w.run_spark || ""} className="hidden sm:flex" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
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
      // Scope to the showcase apps so the demo stays focused on the
      // three-stage story, not the operator's full fleet. See src/lib/demo.ts.
      setRows(list.filter((l) => inScope(l.app)));
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

export function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2.5">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

// Friendly display overrides for specific loop ids — win over the raw
// backend name (e.g. "benchmark" → "NL-to-SQL" in auto-sysresearch, which
// is an NL-to-SQL config optimizer, not a generic benchmark).
const LOOP_OVERRIDE: Record<string, string> = {
  benchmark: "NL-to-SQL",
};
export function loopLabel(name?: string, fallbackLoop?: string): string {
  if (name && LOOP_OVERRIDE[name]) return LOOP_OVERRIDE[name];
  if (!name) return humanizeLoop(fallbackLoop || "");
  // The backend sets name = the loop slug for most loops — a "name" with no
  // uppercase and no spaces is a slug, not a curated title; humanize it
  // ("momentum_research" -> "Momentum research"). Real display names pass.
  return /[A-Z\s]/.test(name) ? name : humanizeLoop(name);
}

export function humanizeLoop(loop: string): string {
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
        <CyclesSection />
      </div>
      <DraftsSection onChange={bumpToday} />
      <LoopsSection />
    </div>
  );
}
