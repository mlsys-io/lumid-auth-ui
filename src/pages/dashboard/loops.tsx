import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertCircle, CheckCircle, Clock, ExternalLink, Plus } from 'lucide-react';
import axios from 'axios';

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
}

const identityApi = axios.create({ baseURL: '/', timeout: 15_000, withCredentials: true });

export default function LoopsPage() {
  const [loops, setLoops] = useState<LoopRecord[]>([]);
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
        // Sort: failing first, then by app name
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
