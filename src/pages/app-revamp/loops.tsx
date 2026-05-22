// /app/loops — installed apps + their loops. Start / Stop / Run-now
// buttons backed by PATCH /me/loops + POST /me/loops/.../run.
//
// Reads loop status from the existing /admin/loops surface via
// /me/loops/health (which delegates to the admin handler in P0;
// per-tenant filtering lands in P2). UI is row-per-loop with action
// buttons inline. Quality-score sparkline + runtime picker land in P1+.

import { useEffect, useState } from "react";
import {
  RefreshCw, Play, Square, Zap, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";
import { me, MeApiError } from "@/api/me";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface LoopRow {
  app: string;
  loop: string;
  schedule?: string;
  enabled?: boolean;
  last_run_ts?: string;
  last_status?: string;
  consecutive_failures?: number;
}

type Busy = "running" | "starting" | "stopping" | null;

export default function AppLoops() {
  const [rows, setRows] = useState<LoopRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Map<string, Busy>>(new Map());

  const load = async () => {
    setError(null);
    try {
      const r = await me.loopsHealth();
      // /me/loops/health currently delegates to admin/loops which returns
      // a list shaped like { loops: [{app, loop, schedule, ...}, …] }.
      const list = (r as unknown as { loops?: LoopRow[] }).loops ?? (r as unknown as LoopRow[]) ?? [];
      setRows(list);
    } catch (e) {
      setError(e instanceof MeApiError ? e.message : String(e));
    }
  };
  useEffect(() => { load(); }, []);

  const key = (r: LoopRow) => `${r.app}:${r.loop}`;
  const setOne = (k: string, v: Busy) =>
    setBusy((m) => { const n = new Map(m); n.set(k, v); return n; });

  const toggle = async (r: LoopRow) => {
    const target = !r.enabled;
    setOne(key(r), target ? "starting" : "stopping");
    try {
      await me.patchLoop(r.app, r.loop, { enabled: target });
      toast.success(target ? `${r.loop} started` : `${r.loop} stopped`);
      await load();
    } catch (e) {
      toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
    } finally {
      setOne(key(r), null);
    }
  };

  const runNow = async (r: LoopRow) => {
    setOne(key(r), "running");
    try {
      const { job_id } = await me.runLoopNow(r.app, r.loop);
      toast.success(`Queued one-shot — job ${job_id.slice(-8)}`);
    } catch (e) {
      toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
    } finally {
      setOne(key(r), null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-indigo-600" />
            My Loops
          </h1>
          <p className="text-sm text-slate-600">
            Your installed apps' autoresearch loops. Start, stop, or trigger a one-shot cycle.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border border-slate-200 bg-white hover:bg-slate-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-sm rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">App / Loop</th>
              <th className="px-3 py-2 font-medium w-32">Schedule</th>
              <th className="px-3 py-2 font-medium w-32">Last run</th>
              <th className="px-3 py-2 font-medium w-24">State</th>
              <th className="px-3 py-2 font-medium w-44 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows?.map((r) => {
              const b = busy.get(key(r));
              return (
                <tr key={key(r)} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.loop}</div>
                    <div className="text-xs text-slate-500 font-mono">{r.app}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 font-mono">
                    {r.schedule ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.last_run_ts ? new Date(r.last_run_ts).toISOString().slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.consecutive_failures && r.consecutive_failures > 0 ? (
                      <span className="text-rose-700 inline-flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {r.consecutive_failures} fail{r.consecutive_failures === 1 ? "" : "s"}
                      </span>
                    ) : r.enabled ? (
                      <span className="text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> on
                      </span>
                    ) : (
                      <span className="text-slate-500">off</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => runNow(r)}
                        disabled={!!b}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                      >
                        {b === "running" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        Run now
                      </button>
                      <button
                        onClick={() => toggle(r)}
                        disabled={!!b}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border disabled:opacity-50",
                          r.enabled
                            ? "border-slate-200 bg-white hover:bg-slate-50"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                        )}
                      >
                        {b === "starting" || b === "stopping" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : r.enabled ? (
                          <Square className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        {r.enabled ? "Stop" : "Start"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                  No loops yet. Install an app from the <a href="/app/marketplace" className="text-indigo-600 hover:underline">Marketplace</a> to get started.
                </td>
              </tr>
            )}
            {rows === null && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
