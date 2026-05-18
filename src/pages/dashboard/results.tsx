import { useEffect, useState } from 'react';
import { BarChart3, ExternalLink } from 'lucide-react';
import axios from 'axios';

interface CycleSummary {
  app: string;
  loop: string;
  ts: number;
  status: 'ok' | 'error';
  primary_metric?: { name: string; value: number };
  findings?: number;
  skills_run?: number;
}

const identityApi = axios.create({ baseURL: '/', timeout: 15_000, withCredentials: true });

export default function ResultsPage() {
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    identityApi.get('/api/v1/admin/loops?include_history=1&limit=50')
      .then((r) => {
        const all: CycleSummary[] = [];
        for (const app of (r.data?.apps || [])) {
          for (const lp of (app.loops || [])) {
            for (const cycle of (lp.recent_cycles || [])) {
              all.push({
                app: app.name,
                loop: lp.loop,
                ts: cycle.ts,
                status: cycle.status || 'ok',
                primary_metric: cycle.primary_metric,
                findings: cycle.findings_count,
                skills_run: cycle.skills_run,
              });
            }
          }
        }
        all.sort((a, b) => b.ts - a.ts);
        setCycles(all.slice(0, 40));
      })
      .catch((e) => setErr(e?.response?.data?.detail || 'Failed to load results'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">My Results</h1>
        <p className="mt-1 text-sm text-slate-600">
          Recent cycle outputs from your research loops.{' '}
          <a href="https://xp.io" target="_blank" rel="noopener noreferrer"
            className="text-indigo-600 hover:underline inline-flex items-center gap-1">
            Share findings on xp.io <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </header>

      {loading ? (
        <div className="text-sm text-slate-500 py-10 text-center">Loading results…</div>
      ) : err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {err}
        </div>
      ) : cycles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <BarChart3 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <div className="text-sm text-slate-500">No cycle results yet.</div>
          <div className="mt-2 text-xs text-slate-400">
            Results appear here after a research loop completes a cycle.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {cycles.map((c, i) => (
            <div
              key={`${c.app}/${c.loop}/${c.ts}/${i}`}
              className={`flex items-center gap-3 rounded-lg border bg-white px-4 py-3 ${
                c.status === 'error' ? 'border-red-200' : 'border-slate-200'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${
                  c.status === 'error' ? 'bg-red-400' : 'bg-emerald-400'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">
                  {c.app} / {c.loop}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {c.findings != null && `${c.findings} findings · `}
                  {c.skills_run != null && `${c.skills_run} skills`}
                </div>
              </div>
              {c.primary_metric && (
                <div className="shrink-0 text-right text-xs">
                  <div className="font-mono text-indigo-600 font-medium">
                    {c.primary_metric.name}: {c.primary_metric.value.toFixed(3)}
                  </div>
                </div>
              )}
              <div className="shrink-0 text-xs text-slate-400">
                {new Date(c.ts * 1000).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
