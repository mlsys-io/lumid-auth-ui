/**
 * Operator console — `/app/lqt/operator`.
 *
 * Five cards (per `plans/fizzy-humming-quasar.md` §"6 thin slices"):
 *  1. Service status grid (16 cells)
 *  2. Audit replicator lag gauge (SSE)
 *  3. Drift observer counts
 *  4. xpio loops table
 *  5. Recent alerts panel
 *
 * NOT role-gated — operator views stay visible for every logged-in
 * user. The sensitive admin paths live behind `AdminGuard` on the
 * `admin` route.
 *
 * Thin slice — read-only MVP. HSM rotation drill, replicator
 * restart, and alert silence ship in Phase 2 (T-UI-013).
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
import { useLqtSse } from '../utils/sse';
import { ServiceStatusGrid } from '../components/ServiceStatusGrid';
// Phase 6 (T-ANALYSIS-SLO) — obs-sourced SLO + fleet + analysis panels.
// The dedicated page is `slo.tsx`; the operator console embeds the same
// panels so the SLO surface is reachable wherever the operator route
// mounts (the standalone /slo route is wired alongside it).
import {
  FillQualityCard,
  FleetCard,
  PnlReconCard,
  SloRollupCard,
} from './slo';
import type {
  AlertsBody,
  DriftObserversBody,
  PreflightBody,
  ReplicatorLagTick,
  ServiceStatusBody,
  XpioLoopsBody,
} from '../types';

function ServiceStatusCard() {
  const [body, setBody] = useState<ServiceStatusBody | null>(null);
  useEffect(() => {
    void getJson<ServiceStatusBody>('/api/ops/service-status').then(setBody).catch(() => {});
    const timer = setInterval(() => {
      void getJson<ServiceStatusBody>('/api/ops/service-status').then(setBody).catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <ServiceStatusGrid
      services={body?.services ?? []}
      dockerReachable={body?.docker_reachable ?? true}
    />
  );
}

function ReplicatorLagCard() {
  const { events, status } = useLqtSse<ReplicatorLagTick>('/api/ops/replicator-lag', {
    bufferSize: 60,
  });
  const latest = events[events.length - 1] ?? null;

  function gaugeColor(lag: number | null | undefined): string {
    if (lag == null) return 'text-gray-500';
    if (lag < 5) return 'text-green-600';
    if (lag < 30) return 'text-yellow-600';
    return 'text-red-600';
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Audit replicator lag</span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            SSE: {status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!latest ? (
          <div className="text-xs text-muted-foreground">Awaiting first tick…</div>
        ) : (
          <div className="space-y-1">
            <div className={`text-3xl font-bold ${gaugeColor(latest.lag_seconds)}`}>
              {latest.lag_seconds == null ? '—' : `${latest.lag_seconds.toFixed(2)}s`}
            </div>
            <div className="text-xs text-muted-foreground">
              head {latest.head_seq} · tail {latest.tail_seq} · {latest.lag_rows} row
              {latest.lag_rows === 1 ? '' : 's'} behind
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DriftCountsCard() {
  const [body, setBody] = useState<DriftObserversBody | null>(null);
  useEffect(() => {
    void getJson<DriftObserversBody>('/api/ops/drift-observers').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Drift observers (1h window)</CardTitle>
      </CardHeader>
      <CardContent>
        {!body ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border p-2">
              <div className="text-muted-foreground">polymarket</div>
              <div className="font-mono">only_oms: {body.by_venue.polymarket.only_in_oms}</div>
              <div className="font-mono">only_venue: {body.by_venue.polymarket.only_in_venue}</div>
              <div className="font-mono">
                mismatched: {body.by_venue.polymarket.mismatched_state}
              </div>
              <div className="font-mono">throttled: {body.by_venue.polymarket.throttled}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">kalshi</div>
              <div className="font-mono">only_oms: {body.by_venue.kalshi.only_in_oms}</div>
              <div className="font-mono">only_venue: {body.by_venue.kalshi.only_in_venue}</div>
              <div className="font-mono">mismatched: {body.by_venue.kalshi.mismatched_state}</div>
              <div className="font-mono">throttled: {body.by_venue.kalshi.throttled}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function XpioLoopsCard() {
  const [body, setBody] = useState<XpioLoopsBody | null>(null);
  useEffect(() => {
    void getJson<XpioLoopsBody>('/api/ops/xpio-loops').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">xpio loops</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>loop</TableHead>
              <TableHead>schedule</TableHead>
              <TableHead>last</TableHead>
              <TableHead>outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.loops.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                  {body ? 'No loops configured.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.loops.map((l) => (
                <TableRow key={l.name}>
                  <TableCell className="font-mono text-xs">{l.name}</TableCell>
                  <TableCell className="font-mono text-xs">{l.schedule}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.last_cycle_at_ns == null
                      ? '—'
                      : new Date(Math.floor(l.last_cycle_at_ns / 1_000_000))
                          .toISOString()
                          .slice(0, 19)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.last_outcome ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AlertsCard() {
  const [body, setBody] = useState<AlertsBody | null>(null);
  useEffect(() => {
    void getJson<AlertsBody>('/api/ops/alerts').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Recent alerts</span>
          {body && !body.reachable ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              alertmanager unreachable
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!body ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : body.alerts.length === 0 ? (
          <div className="text-xs text-muted-foreground">No active alerts.</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {body.alerts.map((a, i) => (
              <li key={`${a.name}-${i}`} className="rounded border p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {a.severity}
                  </Badge>
                </div>
                <div className="text-muted-foreground">{a.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PreflightCard() {
  const [body, setBody] = useState<PreflightBody | null>(null);
  useEffect(() => {
    void getJson<PreflightBody>('/api/ops/preflight').then(setBody).catch(() => {});
  }, []);
  const headline = useMemo<string>(() => body?.overall ?? 'unknown', [body]);
  const cls =
    headline === 'ok'
      ? 'bg-green-100 text-green-800'
      : headline === 'degraded'
        ? 'bg-yellow-100 text-yellow-800'
        : headline === 'failing'
          ? 'bg-red-100 text-red-800'
          : 'bg-gray-100 text-gray-700';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Preflight</span>
          <Badge variant="outline" className={`text-xs ${cls}`}>
            {headline}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!body ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {body.checks.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-center justify-between rounded border p-2">
                <span className="font-mono">{c.name}</span>
                <span className="font-mono text-muted-foreground">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OperatorPage() {
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">Operator console</h1>
      <ServiceStatusCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReplicatorLagCard />
        <DriftCountsCard />
        <XpioLoopsCard />
        <AlertsCard />
        <PreflightCard />
      </div>

      {/* Phase 6 (T-ANALYSIS-SLO) — operator SLO views on the obs plane
          (rebuilt after Grafana/Prometheus were retired). */}
      <h2 className="pt-2 text-base font-semibold">SLO &amp; fleet</h2>
      <SloRollupCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FleetCard />
        <FillQualityCard />
      </div>
      <PnlReconCard />

      <p className="text-xs text-muted-foreground">
        HSM rotation drill, replicator restart, and alert silence ship in Phase 2 (T-UI-013).
        SLO-breach highlighting is client-side; a server-side alert rule is a documented follow-up.
      </p>
    </div>
  );
}

export default OperatorPage;
