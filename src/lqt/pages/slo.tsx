/**
 * Operator SLO console — `/app/lqt/slo` (Phase 6, T-ANALYSIS-SLO).
 *
 * Rebuilds the operator SLO surface on the obs plane after Grafana /
 * Prometheus were torn down (2026-07-04). Five panels, all read-only:
 *
 *  1. SLO rollup — per (region, strategy) whole-cycle latency p50/p99 +
 *     per-stage p99 + the proposed→submitted→rejected→suppressed funnel,
 *     from `obs.runtime_cycles` via `/api/ops/slo`.
 *  2. Reject-reason distribution — merged `{reason: count}` across the
 *     window (the funnel-anomaly explainer).
 *  3. Fleet heartbeat — per-region freshest cycle ts + obs-ingest lag +
 *     distinct box / strategy counts, from `/api/ops/fleet`. The
 *     "don't SSH to see field state" view.
 *  4. P&L reconciliation — realized-vs-expected divergence + mismark /
 *     unreconciled flags per (strategy, venue, day), from
 *     `/api/ops/pnl-reconciliation` (`analysis.pnl_reconciliation`).
 *  5. Fill quality — per-venue toxic_fill_pct + net markout, from
 *     `/api/ops/fill-quality` (`analysis.fill_quality`).
 *
 * SLO-breach highlight is CLIENT-SIDE (a server-side alert rule is a
 * documented follow-up): a group's p99 latency panel goes red past
 * `P99_BREACH_NS`, and a funnel with a high suppressed/rejected share
 * relative to proposed is flagged. Same threshold posture as the
 * replicator-lag gauge on the operator console.
 *
 * NOT role-gated on the UI (matches operator.tsx); the gateway enforces
 * `role ∈ {admin, super_admin}` on `/api/ops/slo` + `/api/ops/fleet`
 * (cross-tenant infra rollups) and RLS on the analysis reads. A
 * non-operator user simply gets empty panels (403 → caught).
 */

import { useEffect, useMemo, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { getJson } from '../utils/axios';
import type {
  FillQualityBody,
  FleetBody,
  PnlReconBody,
  SloBody,
  SloGroup,
} from '../types';

// ---- client-side SLO-breach thresholds (server-side alert = follow-up) ----

/** Whole-cycle p99 latency breach (ns) — 50ms. Past this the group is red. */
const P99_BREACH_NS = 50_000_000;
/** p99 warn band (ns) — 20ms. Yellow between warn and breach. */
const P99_WARN_NS = 20_000_000;
/** obs-ingest-lag staleness bands (seconds). */
const LAG_WARN_S = 120;
const LAG_BREACH_S = 600;
/** A funnel is anomalous when >`FUNNEL_ANOMALY_FRAC` of proposals never
 * submit (rejected+suppressed share of proposed). */
const FUNNEL_ANOMALY_FRAC = 0.5;

function fmtNsMs(ns: number): string {
  if (!Number.isFinite(ns) || ns <= 0) return '—';
  return `${(ns / 1_000_000).toFixed(2)}ms`;
}

function fmtMicrosUsd(micros: number): string {
  if (!Number.isFinite(micros)) return '—';
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function p99Class(ns: number): string {
  if (ns >= P99_BREACH_NS) return 'text-red-600 font-bold';
  if (ns >= P99_WARN_NS) return 'text-yellow-600 font-semibold';
  return 'text-green-600';
}

function lagClass(s: number): string {
  if (s >= LAG_BREACH_S) return 'text-red-600 font-bold';
  if (s >= LAG_WARN_S) return 'text-yellow-600 font-semibold';
  return 'text-green-600';
}

/** A group's funnel is anomalous when most proposals never make it to submit. */
function funnelAnomalous(g: SloGroup): boolean {
  if (g.n_proposed <= 0) return false;
  const dropped = g.n_rejected + g.n_suppressed;
  return dropped / g.n_proposed > FUNNEL_ANOMALY_FRAC;
}

// ---- window selector (shared) ----

function WindowSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  options: { v: number; l: string }[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <select
        className="rounded border bg-background px-1 py-0.5 text-xs"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}

const WINDOW_OPTIONS = [
  { v: 15, l: '15m' },
  { v: 60, l: '1h' },
  { v: 360, l: '6h' },
  { v: 1440, l: '24h' },
];

const DAYS_OPTIONS = [
  { v: 1, l: '1d' },
  { v: 7, l: '7d' },
  { v: 30, l: '30d' },
];

// ---- Panel 1 + 2: SLO rollup + reject-reason distribution ----

export function SloRollupCard() {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [body, setBody] = useState<SloBody | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getJson<SloBody>('/api/ops/slo', { window_minutes: windowMinutes })
      .then((b) => {
        if (!cancelled) setBody(b);
      })
      .catch(() => {
        if (!cancelled) setBody(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowMinutes]);

  const anyBreach = useMemo(
    () => (body?.groups ?? []).some((g) => g.cycle_p99_ns >= P99_BREACH_NS || funnelAnomalous(g)),
    [body],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>SLO — cycle latency + funnel</span>
          <span className="flex items-center gap-2">
            {anyBreach ? (
              <Badge variant="outline" className="bg-red-100 text-[10px] text-red-800">
                SLO breach
              </Badge>
            ) : null}
            {body && !body.obs_reachable ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                obs unreachable
              </Badge>
            ) : null}
            <WindowSelect
              label="window"
              value={windowMinutes}
              onChange={setWindowMinutes}
              options={WINDOW_OPTIONS}
            />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>region</TableHead>
              <TableHead>strategy</TableHead>
              <TableHead className="text-right">cycles</TableHead>
              <TableHead className="text-right">p50</TableHead>
              <TableHead className="text-right">p99</TableHead>
              <TableHead className="text-right">gate p99</TableHead>
              <TableHead className="text-right">router p99</TableHead>
              <TableHead className="text-right">prop</TableHead>
              <TableHead className="text-right">subm</TableHead>
              <TableHead className="text-right">rej</TableHead>
              <TableHead className="text-right">supp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || !body ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-xs text-muted-foreground">
                  {loading ? 'Loading…' : 'No data.'}
                </TableCell>
              </TableRow>
            ) : body.groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-xs text-muted-foreground">
                  No cycles in window.
                </TableCell>
              </TableRow>
            ) : (
              body.groups.map((g) => (
                <TableRow
                  key={`${g.region_id}|${g.strategy_id}`}
                  className={funnelAnomalous(g) ? 'bg-red-50' : undefined}
                >
                  <TableCell className="font-mono text-xs">{g.region_id}</TableCell>
                  <TableCell className="font-mono text-xs">{g.strategy_id || '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{g.cycles}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNsMs(g.cycle_p50_ns)}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-xs ${p99Class(g.cycle_p99_ns)}`}>
                    {fmtNsMs(g.cycle_p99_ns)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNsMs(g.gate_p99_ns)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNsMs(g.router_p99_ns)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{g.n_proposed}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{g.n_submitted}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{g.n_rejected}</TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${
                      funnelAnomalous(g) ? 'text-red-600 font-semibold' : ''
                    }`}
                  >
                    {g.n_suppressed}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {body && body.reject_reasons.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Reject-reason distribution
            </div>
            <div className="flex flex-wrap gap-1">
              {body.reject_reasons.map((r) => (
                <Badge key={r.reason} variant="outline" className="font-mono text-[10px]">
                  {r.reason}: {r.count}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---- Panel 3: Fleet heartbeat ----

export function FleetCard() {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [body, setBody] = useState<FleetBody | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getJson<FleetBody>('/api/ops/fleet', { window_minutes: windowMinutes })
      .then((b) => {
        if (!cancelled) setBody(b);
      })
      .catch(() => {
        if (!cancelled) setBody(null);
      });
    // Fleet is a liveness view — refresh on a 30s cadence.
    const timer = setInterval(() => {
      void getJson<FleetBody>('/api/ops/fleet', { window_minutes: windowMinutes })
        .then((b) => {
          if (!cancelled) setBody(b);
        })
        .catch(() => {});
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [windowMinutes]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Fleet heartbeat</span>
          <span className="flex items-center gap-2">
            {body && !body.obs_reachable ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                obs unreachable
              </Badge>
            ) : null}
            <WindowSelect
              label="window"
              value={windowMinutes}
              onChange={setWindowMinutes}
              options={WINDOW_OPTIONS}
            />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>region</TableHead>
              <TableHead className="text-right">boxes</TableHead>
              <TableHead className="text-right">strategies</TableHead>
              <TableHead className="text-right">cycles</TableHead>
              <TableHead>last heartbeat</TableHead>
              <TableHead className="text-right">ingest lag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.regions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                  {body ? 'No field boxes reporting.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.regions.map((r) => (
                <TableRow key={r.region_id}>
                  <TableCell className="font-mono text-xs">{r.region_id}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.box_count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.active_strategies}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.cycles}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.last_cycle_at_ns > 0
                      ? new Date(Math.floor(r.last_cycle_at_ns / 1_000_000))
                          .toISOString()
                          .slice(0, 19)
                      : '—'}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-xs ${lagClass(r.ingest_lag_seconds)}`}>
                    {r.ingest_lag_seconds.toFixed(0)}s
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Panel 4: P&L reconciliation ----

export function PnlReconCard() {
  const [days, setDays] = useState(7);
  const [body, setBody] = useState<PnlReconBody | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getJson<PnlReconBody>('/api/ops/pnl-reconciliation', { days })
      .then((b) => {
        if (!cancelled) setBody(b);
      })
      .catch(() => {
        if (!cancelled) setBody(null);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>P&amp;L reconciliation</span>
          <WindowSelect label="range" value={days} onChange={setDays} options={DAYS_OPTIONS} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>day</TableHead>
              <TableHead>strategy</TableHead>
              <TableHead>venue</TableHead>
              <TableHead className="text-right">realized</TableHead>
              <TableHead className="text-right">expected</TableHead>
              <TableHead className="text-right">divergence</TableHead>
              <TableHead className="text-right">settled</TableHead>
              <TableHead className="text-right">unrecon</TableHead>
              <TableHead className="text-right">mismark</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-xs text-muted-foreground">
                  {body ? 'No reconciliation rows.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.rows.map((r) => (
                <TableRow
                  key={`${r.day}|${r.strategy_id}|${r.venue}`}
                  className={
                    r.unreconciled_positions > 0 || r.mismark_positions > 0 ? 'bg-yellow-50' : undefined
                  }
                >
                  <TableCell className="font-mono text-xs">{r.day}</TableCell>
                  <TableCell className="font-mono text-xs">{r.strategy_id || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.venue || '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtMicrosUsd(r.realized_pnl_micros)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtMicrosUsd(r.expected_pnl_micros)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${
                      r.pnl_divergence_micros < 0 ? 'text-red-600' : ''
                    }`}
                  >
                    {fmtMicrosUsd(r.pnl_divergence_micros)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.settled_positions}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${
                      r.unreconciled_positions > 0 ? 'text-red-600 font-semibold' : ''
                    }`}
                  >
                    {r.unreconciled_positions}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${
                      r.mismark_positions > 0 ? 'text-yellow-700 font-semibold' : ''
                    }`}
                  >
                    {r.mismark_positions}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Panel 5: Fill quality ----

function fillQualityToxicClass(pct: number): string {
  // toxic_fill_pct is a fraction 0..1.
  if (pct >= 0.5) return 'text-red-600 font-bold';
  if (pct >= 0.3) return 'text-yellow-600 font-semibold';
  return '';
}

export function FillQualityCard() {
  const [days, setDays] = useState(7);
  const [body, setBody] = useState<FillQualityBody | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getJson<FillQualityBody>('/api/ops/fill-quality', { days })
      .then((b) => {
        if (!cancelled) setBody(b);
      })
      .catch(() => {
        if (!cancelled) setBody(null);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Fill quality — markout / adverse selection</span>
          <WindowSelect label="range" value={days} onChange={setDays} options={DAYS_OPTIONS} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>day</TableHead>
              <TableHead>venue</TableHead>
              <TableHead>strategy</TableHead>
              <TableHead className="text-right">mo 10s (bps)</TableHead>
              <TableHead className="text-right">net mo 10s (bps)</TableHead>
              <TableHead className="text-right">toxic %</TableHead>
              <TableHead className="text-right">net toxic %</TableHead>
              <TableHead className="text-right">fills</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-xs text-muted-foreground">
                  {body ? 'No fill-quality rows.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.rows.map((r) => (
                <TableRow key={`${r.day}|${r.venue}|${r.strategy_id}`}>
                  <TableCell className="font-mono text-xs">{r.day}</TableCell>
                  <TableCell className="font-mono text-xs">{r.venue || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.strategy_id || '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.markout_10s_bps.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${
                      r.markout_net_10s_bps < 0 ? 'text-red-600' : ''
                    }`}
                  >
                    {r.markout_net_10s_bps.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${fillQualityToxicClass(r.toxic_fill_pct)}`}
                  >
                    {(r.toxic_fill_pct * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-xs ${fillQualityToxicClass(
                      r.net_toxic_fill_pct,
                    )}`}
                  >
                    {(r.net_toxic_fill_pct * 100).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.fills_scored}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function SloPage() {
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">Operator SLO</h1>
      <p className="text-xs text-muted-foreground">
        Obs-sourced service-level views (rebuilt on <code>obs.runtime_cycles</code> +{' '}
        <code>analysis.*</code> after Grafana/Prometheus were retired). SLO-breach highlighting is
        client-side; a server-side alert rule is a documented follow-up.
      </p>
      <SloRollupCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FleetCard />
        <FillQualityCard />
      </div>
      <PnlReconCard />
    </div>
  );
}

export default SloPage;
