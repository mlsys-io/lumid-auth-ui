/**
 * Auditor workbench — `/app/lqt/auditor`.
 *
 * Four cards (per `plans/fizzy-humming-quasar.md` §"6 thin slices"):
 *  1. Audit chain head — paginated rows + live toggle
 *  2. Kind filter (multi-select from ALL_KINDS)
 *  3. Anchor journal — last 50 anchors
 *  4. Verify-status indicator
 *
 * Thin slice — read-only MVP, 200-400 LOC. Verify trigger + bundle
 * export ship in Phase 2 (T-UI-011).
 */

import { useEffect, useMemo, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { getJson } from '../utils/axios';
import { useLqtSse } from '../utils/sse';
import { AuditRowTable } from '../components/AuditRowTable';
import { KindBadge } from '../components/KindBadge';
import type {
  AnchorsBody,
  AuditHeadBody,
  AuditRow,
  AuditTailRow,
  KindsBody,
} from '../types';

interface KindFilterCardProps {
  selected: string[];
  onChange: (kinds: string[]) => void;
}

function KindFilterCard({ selected, onChange }: KindFilterCardProps) {
  const [body, setBody] = useState<KindsBody | null>(null);

  useEffect(() => {
    void getJson<KindsBody>('/api/audit/kinds').then(setBody).catch(() => {});
  }, []);

  const grouped = useMemo<Record<string, KindsBody['kinds']>>(() => {
    const out: Record<string, KindsBody['kinds']> = {};
    if (!body) return out;
    for (const k of body.kinds) {
      const domain = k.kind_str.startsWith('lqt.')
        ? (k.kind_str.split('.')[1] ?? 'other')
        : 'other';
      (out[domain] ??= []).push(k);
    }
    return out;
  }, [body]);

  function toggle(k: string) {
    if (selected.includes(k)) onChange(selected.filter((x) => x !== k));
    else onChange([...selected, k]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Filter by kind</CardTitle>
      </CardHeader>
      <CardContent>
        {!body ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([domain, kinds]) => (
                <div key={domain}>
                  <div className="text-xs font-medium text-muted-foreground">{domain}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {kinds.map((k) => {
                      const on = selected.includes(k.kind_str);
                      return (
                        <button
                          key={k.kind_str}
                          type="button"
                          onClick={() => toggle(k.kind_str)}
                          className={on ? 'opacity-100' : 'opacity-60'}
                          aria-pressed={on}
                        >
                          <KindBadge kind={k.kind_str} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}
        <div className="pt-2 text-xs text-muted-foreground">
          {selected.length} kind{selected.length === 1 ? '' : 's'} selected
        </div>
      </CardContent>
    </Card>
  );
}

function AnchorsCard() {
  const [body, setBody] = useState<AnchorsBody | null>(null);
  useEffect(() => {
    void getJson<AnchorsBody>('/api/audit/anchors', { limit: 50 })
      .then(setBody)
      .catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Anchor journal (last 50)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto text-xs">
          {!body ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : body.anchors.length === 0 ? (
            <div className="text-muted-foreground">No anchors recorded.</div>
          ) : (
            <ul className="space-y-1">
              {body.anchors.map((a) => (
                <li key={a.anchor_seq} className="rounded border p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono">#{a.anchor_seq}</span>
                    <span className="font-mono text-muted-foreground">
                      {new Date(Math.floor(a.anchored_at_ns / 1_000_000))
                        .toISOString()
                        .slice(0, 19)}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px]">
                    body: {a.body_hash_hex.slice(0, 24)}…
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {a.chain_heads_summary.tenant_count} tenants
                    {a.chain_heads_summary.head_hash_sample
                      ? ` · sample ${a.chain_heads_summary.head_hash_sample}`
                      : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function VerifyStatusCard() {
  // The gateway exposes verify outcome via the audit chain itself
  // (kind: lqt.audit.anchor_verify_outcome.v1). Phase 2 adds a
  // dedicated endpoint; for now, scrape the most-recent matching
  // row from /api/audit/head.
  const [latest, setLatest] = useState<AuditRow | null>(null);
  useEffect(() => {
    void getJson<AuditHeadBody>('/api/audit/head', {
      kind: 'lqt.audit.anchor_verify_outcome.v1',
      limit: 1,
    })
      .then((b) => setLatest(b.rows[0] ?? null))
      .catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Last verify outcome</CardTitle>
      </CardHeader>
      <CardContent>
        {!latest ? (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            no recent verify run
          </Badge>
        ) : (
          <div className="space-y-1 text-xs">
            <div className="font-mono">
              seq {latest.seq} · {new Date(Math.floor(latest.ts_ns / 1_000_000))
                .toISOString()
                .slice(0, 19)}
            </div>
            <div>actor: {latest.actor}</div>
            <div className="text-muted-foreground">
              full payload decode is a Phase-2 surface
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditorPage() {
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [liveOn, setLiveOn] = useState(false);
  const [loading, setLoading] = useState(false);

  const tailPath = useMemo<string | null>(() => (liveOn ? '/api/audit/tail' : null), [liveOn]);
  const { events: tailEvents, status: sseStatus } = useLqtSse<AuditTailRow>(tailPath);

  // Merge SSE events into the rows buffer (top of list).
  useEffect(() => {
    if (!liveOn || tailEvents.length === 0) return;
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.seq));
      const incoming: AuditRow[] = tailEvents
        .filter((e) => !seen.has(e.seq))
        .map((e) => ({ ...e }));
      const merged = [...incoming, ...prev];
      // Cap visible rows so the table stays responsive.
      return merged.slice(0, 500);
    });
  }, [tailEvents, liveOn]);

  async function loadPage(from_seq: number | null) {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { limit: 100 };
      if (selectedKinds.length > 0) params.kind = selectedKinds.join(',');
      if (from_seq != null) params.from_seq = from_seq;
      const body = await getJson<AuditHeadBody>('/api/audit/head', params);
      setRows((prev) =>
        from_seq == null ? body.rows : [...prev, ...body.rows.filter((r) => !prev.find((p) => p.seq === r.seq))],
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[auditor] head load failed', e);
    } finally {
      setLoading(false);
    }
  }

  // Refetch first page whenever the kind filter changes.
  useEffect(() => {
    void loadPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKinds.join(',')]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Auditor</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            SSE: {sseStatus}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void loadPage(null)}>
            refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="pt-4">
              <AuditRowTable
                rows={rows}
                onLoadMore={loadPage}
                liveOn={liveOn}
                onToggleLive={setLiveOn}
                isLoading={loading}
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <KindFilterCard selected={selectedKinds} onChange={setSelectedKinds} />
          <AnchorsCard />
          <VerifyStatusCard />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Run-verify trigger + bundle export ship in Phase 2 (T-UI-011).
      </p>
    </div>
  );
}

export default AuditorPage;
