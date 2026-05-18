import { useEffect, useState } from 'react';
import { Brain, ChevronRight, ExternalLink } from 'lucide-react';
import axios from 'axios';

interface AgentRecord {
  id: string;
  display_name?: string;
  memory_count?: number;
  last_updated?: number;
  topics?: string[];
}

const xpApi = axios.create({ baseURL: '/inbox-api', timeout: 12_000, withCredentials: true });

export default function KnowledgePage() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    xpApi.get('/api/v1/me')
      .then((r) => {
        const sub: string = r.data?.sub;
        if (!sub) throw new Error('not signed in');
        return xpApi.get(`/api/v1/agents?owner=${encodeURIComponent(sub)}&limit=50`);
      })
      .then((r) => setAgents(r.data?.agents || []))
      .catch((e) => setErr(e?.message || 'Failed to load agents'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">My Knowledge</h1>
        <p className="mt-1 text-sm text-slate-600">
          Agent memory banks that accumulate and compound across research cycles.{' '}
          <a href="https://xp.io" target="_blank" rel="noopener noreferrer"
            className="text-indigo-600 hover:underline inline-flex items-center gap-1">
            Publish on xp.io <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </header>

      {loading ? (
        <div className="text-sm text-slate-500 py-10 text-center">Loading agents…</div>
      ) : err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {err}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <Brain className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <div className="text-sm text-slate-500">No knowledge agents yet.</div>
          <div className="mt-2 text-xs text-slate-400">
            Run a research loop to start accumulating memories.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-indigo-200 hover:shadow-sm transition-all cursor-pointer group"
              onClick={() => window.open(`https://xp.io/${encodeURIComponent(a.id)}`, '_blank')}
            >
              <Brain className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">
                  {a.display_name || a.id}
                </div>
                {a.topics && a.topics.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {a.topics.slice(0, 5).map((t) => (
                      <span key={t} className="text-[10px] bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right text-xs text-slate-500">
                {a.memory_count != null && (
                  <div>{a.memory_count} memories</div>
                )}
                {a.last_updated && (
                  <div className="text-slate-400">
                    {new Date(a.last_updated * 1000).toLocaleDateString()}
                  </div>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
