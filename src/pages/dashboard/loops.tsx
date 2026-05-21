import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertCircle, CheckCircle, Clock, ExternalLink, Plus, GitPullRequest, Search, TrendingUp } from 'lucide-react';
import axios from 'axios';

interface LoopOutcome {
  alpha_pp?: number;
  sharpe?: number;
  max_dd?: number;
  pnl?: number;
  trades_count?: number;
  win_rate?: number;
  downstream_jobs?: Array<{ job_id: string; source: string; state: string }>;
}

interface LoopRecord {
  app: string;
  loop: string;
  schedule: string;
  engine?: string;
  engine_module?: string;
  last_run?: number;
  last_status?: 'ok' | 'error' | 'running';
  consecutive_failures?: number;
  last_errors?: string[];
  // skills the loop *declares* it uses (Pattern A steps[].skill or Pattern B skills_invoked[])
  skills?: string[];
  steps?: Array<{ id?: string; skill?: string }>;
  skills_invoked?: string[];
  last_ok?: boolean;
  outcome?: LoopOutcome;
}

interface RepoRow {
  owner_sub: string;
  name: string;
  kind: string;
  consumers_count?: number;
}

interface PullRow {
  number: number;
  state: string;
  base_owner: string;
  base_name: string;
  head_branch: string;
  title: string;
  opened_at: number;
}

const identityApi = axios.create({ baseURL: '/', timeout: 15_000, withCredentials: true });
const xpcloudApi = axios.create({ baseURL: '/xpcloud-api/', timeout: 15_000, withCredentials: true });

export default function LoopsPage() {
  const [loops, setLoops] = useState<LoopRecord[]>([]);
  const [apps, setApps] = useState<RepoRow[]>([]);
  const [openPRs, setOpenPRs] = useState<PullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    identityApi.get('/api/v1/admin/loops')
      .then((r) => {
        const all: LoopRecord[] = [];
        for (const app of (r.data?.apps || [])) {
          for (const lp of (app.loops || [])) {
            all.push({ app: app.name, ...lp });
          }
        }
        all.sort((a, b) => {
          const af = a.consecutive_failures || 0;
          const bf = b.consecutive_failures || 0;
          if (af !== bf) return bf - af;
          return a.app.localeCompare(b.app);
        });
        setLoops(all);
      })
      .catch((e) => setErr(e?.response?.data?.detail || 'Failed to load loops'))
      .finally(() => setLoading(false));
  }, []);

  // Side-load the operator's apps + their open improvement PRs.
  // Best-effort: failures degrade silently — the main loop list still renders.
  useEffect(() => {
    if (loops.length === 0) return;
    const loopApps = Array.from(new Set(loops.map((l) => l.app)));
    xpcloudApi.get('repos', { params: { kind: 'app', limit: 50 } })
      .then(async (r) => {
        const repos: RepoRow[] = (r.data?.repos || []).filter((x: RepoRow) => loopApps.includes(x.name));
        setApps(repos);
        const prsByApp = await Promise.all(
          repos.map((repo) =>
            xpcloudApi.get(`repos/${repo.owner_sub}/${repo.name}/pulls`, { params: { state: 'open' } })
              .then((rr) => (rr.data?.pulls || []) as PullRow[])
              .catch(() => [] as PullRow[])
          ),
        );
        setOpenPRs(prsByApp.flat());
      })
      .catch(() => { /* dashboard still renders without PRs */ });
  }, [loops]);

  // Compute skill gaps locally — loops declaring a skill but the app's
  // skill_imports[] / per-loop skills[] list doesn't cover it. Cheap, no fetch.
  const skillGaps = useMemo(() => {
    const out: Array<{ app: string; loop: string; missing: string }> = [];
    for (const lp of loops) {
      const declared = new Set<string>([
        ...(lp.skills || []),
        ...(lp.skills_invoked || []),
      ]);
      const used = (lp.steps || []).map((s) => s.skill).filter(Boolean) as string[];
      for (const u of used) {
        if (!declared.has(u)) out.push({ app: lp.app, loop: lp.loop, missing: u });
      }
    }
    return out;
  }, [loops]);

  // Trading summary across all loops with trading outcomes. Latest-cycle
  // snapshot per loop — we don't have rolling 7d windows from the API
  // yet, so this is "current trading state" not "trailing-7d performance".
  // The plan calls out 7d/aggregate; document the limitation in the UI
  // sub-label and revisit when /admin/loops gains a history endpoint.
  const tradingSummary = useMemo(() => {
    const tradingLoops = loops.filter((lp) => lp.outcome && (lp.outcome.pnl != null || lp.outcome.trades_count != null));
    if (tradingLoops.length === 0) return null;

    let totalPnl = 0;
    let totalTrades = 0;
    let okLoops = 0;
    let topLoop: { app: string; loop: string; pnl: number } | null = null;
    for (const lp of tradingLoops) {
      const pnl = lp.outcome?.pnl ?? 0;
      totalPnl += pnl;
      totalTrades += lp.outcome?.trades_count ?? 0;
      if ((lp.consecutive_failures ?? 0) === 0 && lp.last_status !== 'error') okLoops++;
      if (topLoop == null || pnl > topLoop.pnl) {
        topLoop = { app: lp.app, loop: lp.loop, pnl };
      }
    }
    return {
      loopCount: tradingLoops.length,
      successRate: tradingLoops.length > 0 ? okLoops / tradingLoops.length : 0,
      totalPnl,
      totalTrades,
      topLoop,
    };
  }, [loops]);

  return (
    <div className="max-w-4xl">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My Research Loops</h1>
          <p className="mt-1 text-sm text-slate-600">
            Auto-research pipelines scheduled on this machine.{' '}
            <a href="https://xp.io" target="_blank" rel="noopener noreferrer"
              className="text-indigo-600 hover:underline inline-flex items-center gap-1">
              Browse skills on xp.io <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
        <a
          href="https://xp.io/new/loop"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New loop
        </a>
      </header>

      {/* Trading summary — only renders when at least one loop has trading
          outcomes (auto-quant trading loops + any future trading app). */}
      {tradingSummary && (
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Trading summary · {tradingSummary.loopCount} loop{tradingSummary.loopCount === 1 ? '' : 's'}
            </h2>
            <span className="text-xs text-slate-400">(latest cycle per loop)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              label="Cycles healthy"
              value={`${Math.round(tradingSummary.successRate * 100)}%`}
              hint={`${tradingSummary.loopCount} loops`}
              tone="emerald"
            />
            <SummaryCard
              label="Trades placed"
              value={String(tradingSummary.totalTrades)}
              hint="sum of latest cycles"
              tone="slate"
            />
            <SummaryCard
              label="Aggregate P&amp;L"
              value={fmtPnL(tradingSummary.totalPnl)}
              hint="across all trading loops"
              tone={tradingSummary.totalPnl >= 0 ? 'emerald' : 'rose'}
            />
            <SummaryCard
              label="Top loop"
              value={tradingSummary.topLoop?.loop || '—'}
              hint={tradingSummary.topLoop ? `${tradingSummary.topLoop.app} · ${fmtPnL(tradingSummary.topLoop.pnl)}` : ''}
              tone="indigo"
            />
          </div>
        </section>
      )}

      {/* Improvement PRs — Stage 2-B output. Reviews land here. */}
      {openPRs.length > 0 && (
        <section className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <GitPullRequest className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Improvement proposals · {openPRs.length} open
            </h2>
          </div>
          <ul className="space-y-1.5">
            {openPRs.map((pr) => (
              <li key={`${pr.base_owner}/${pr.base_name}/${pr.number}`} className="text-sm flex items-center gap-2">
                <span className="text-slate-700 truncate">{pr.title}</span>
                <a
                  href={`https://xp.io/${pr.base_owner}/${pr.base_name}/pulls/${pr.number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-xs text-indigo-600 hover:underline shrink-0 inline-flex items-center gap-0.5"
                >
                  Review <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Skill gaps — loops referencing a skill not declared in the app's
          skill_imports[]. Computed locally from the loops response; the
          marketplace link lets the operator find a community skill to fill it. */}
      {skillGaps.length > 0 && (
        <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Skill gaps · {skillGaps.length} step{skillGaps.length === 1 ? '' : 's'} referencing undeclared skills
            </h2>
          </div>
          <ul className="space-y-1.5">
            {skillGaps.map((g, i) => (
              <li key={i} className="text-sm flex items-center gap-2">
                <span className="font-mono text-xs text-slate-600">{g.app}/{g.loop}</span>
                <span className="text-slate-700">→ missing skill <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{g.missing}</code></span>
                <Link to={`/app/marketplace?q=${encodeURIComponent(g.missing)}`} className="ml-auto text-xs text-amber-700 hover:underline shrink-0 inline-flex items-center gap-0.5">
                  Find in Marketplace <ExternalLink className="w-3 h-3" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* unused placeholder to silence unused-state warning on `apps` */}
      <div hidden>{apps.length}</div>

      {loading ? (
        <div className="text-sm text-slate-500 py-10 text-center">Loading loops…</div>
      ) : err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {err}
        </div>
      ) : loops.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <RefreshCw className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <div className="text-sm text-slate-500">No research loops found.</div>
          <div className="mt-2 text-xs text-slate-400">
            Install an app and define a loop in xpcloud.yaml to get started.
          </div>
          <a
            href="https://lum.id/docs/xpio-autoresearch"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
          >
            Read the auto-research contract →
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {loops.map((lp) => {
            const failures = lp.consecutive_failures || 0;
            const status = failures > 0 ? 'error' : lp.last_status || 'ok';
            return (
              <div
                key={`${lp.app}/${lp.loop}`}
                className={`rounded-lg border bg-white px-4 py-3.5 ${
                  status === 'error' ? 'border-red-200' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {status === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                      )}
                      <span className="text-sm font-semibold text-slate-900">
                        {lp.app} / {lp.loop}
                      </span>
                    </div>
                    {lp.engine_module && (
                      <div className="mt-0.5 text-xs text-slate-500 font-mono">
                        engine: command · {lp.engine_module}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    <div className="flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3" />
                      {lp.schedule === '@trigger' ? 'manual' : lp.schedule}
                    </div>
                    {lp.last_run && (
                      <div className="mt-0.5">
                        {new Date(lp.last_run * 1000).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                {failures > 0 && lp.last_errors && lp.last_errors.length > 0 && (
                  <div className="mt-2 rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700 font-mono line-clamp-3">
                    {lp.last_errors[0]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        Loop state is read from the lumid scheduler (apscheduler).{' '}
        <Link to="/dashboard/admin/loops" className="text-indigo-600 hover:underline">
          Super-admin loop view →
        </Link>
      </div>
    </div>
  );
}

// Small stat-card matching the super-admin dashboard tile style.
// Tone drives the value color; the label/hint stays slate.
function SummaryCard({
  label, value, hint, tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: 'emerald' | 'slate' | 'indigo' | 'rose';
}) {
  const toneClass: Record<string, string> = {
    emerald: 'text-emerald-700',
    slate:   'text-slate-700',
    indigo:  'text-indigo-700',
    rose:    'text-rose-700',
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums truncate ${toneClass[tone]}`} title={value}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-400 truncate">{hint}</div>}
    </div>
  );
}

function fmtPnL(n: number): string {
  if (Math.abs(n) < 0.01) return '0.00';
  const sign = n >= 0 ? '+' : '';
  if (Math.abs(n) >= 1000) return `${sign}${n.toFixed(0)}`;
  return `${sign}${n.toFixed(2)}`;
}
