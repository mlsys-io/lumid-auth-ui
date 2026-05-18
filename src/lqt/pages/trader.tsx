/**
 * Trader workbench — `/app/lqt/trader`.
 *
 * Five cards (per `plans/fizzy-humming-quasar.md` §"6 thin slices"):
 *  1. Current positions
 *  2. Recent 50 fills
 *  3. Equivalence-class P&L
 *  4. Kill-switch indicator (read-only)
 *  5. Risk decisions tail
 *
 * Thin slice — read-only MVP, 200-400 LOC. Order entry, cancel, and
 * kill-switch flip are Phase-2 deepening (T-UI-010).
 */

import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { getJson, LqtGatewayError } from '../utils/axios';
import { KillSwitchIndicator } from '../components/KillSwitchIndicator';
import type {
  EquivalencePnlBody,
  FillsBody,
  MeBody,
  PositionsBody,
  RiskDecisionsBody,
} from '../types';

function fmtTs(ts_ns: number | null | undefined): string {
  if (ts_ns == null) return '—';
  const ms = Math.floor(ts_ns / 1_000_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function PositionsCard() {
  const [body, setBody] = useState<PositionsBody | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getJson<PositionsBody>('/api/portfolio/positions')
      .then(setBody)
      .catch((e) =>
        setErr(e instanceof LqtGatewayError ? `${e.message} (${e.status ?? 'net'})` : String(e)),
      );
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Open positions</CardTitle>
      </CardHeader>
      <CardContent>
        {err ? <div className="text-xs text-red-600">{err}</div> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>instrument</TableHead>
              <TableHead className="text-right">lots</TableHead>
              <TableHead className="text-right">avg ticks</TableHead>
              <TableHead className="text-right">buy / sell</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.positions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                  {body ? 'No open positions.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.positions.map((p) => (
                <TableRow key={p.instrument_id}>
                  <TableCell className="font-mono text-xs">{p.instrument_id}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{p.position_lots}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {p.avg_entry_price_ticks ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {p.cum_buys_lots} / {p.cum_sells_lots}
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

function FillsCard() {
  const [body, setBody] = useState<FillsBody | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getJson<FillsBody>('/api/portfolio/fills', { limit: 50 })
      .then(setBody)
      .catch((e) =>
        setErr(e instanceof LqtGatewayError ? `${e.message} (${e.status ?? 'net'})` : String(e)),
      );
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent 50 fills</CardTitle>
      </CardHeader>
      <CardContent>
        {err ? <div className="text-xs text-red-600">{err}</div> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ts</TableHead>
              <TableHead>instrument</TableHead>
              <TableHead>side</TableHead>
              <TableHead className="text-right">qty</TableHead>
              <TableHead className="text-right">px ticks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.fills.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                  {body ? 'No fills in window.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.fills.map((f) => (
                <TableRow key={f.fill_id}>
                  <TableCell className="font-mono text-xs">{fmtTs(f.executed_at_ns)}</TableCell>
                  <TableCell className="font-mono text-xs">{f.instrument_id}</TableCell>
                  <TableCell className="font-mono text-xs">{f.side}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{f.qty_lots}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{f.price_ticks}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EquivalencePnlCard() {
  const [body, setBody] = useState<EquivalencePnlBody | null>(null);
  useEffect(() => {
    void getJson<EquivalencePnlBody>('/api/portfolio/equivalence-pnl').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Equivalence-class P&amp;L</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>class</TableHead>
              <TableHead className="text-right">realized</TableHead>
              <TableHead className="text-right">unrealized</TableHead>
              <TableHead>status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.classes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                  {body ? 'No equivalence-class P&L rows.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.classes.map((c) => (
                <TableRow key={c.class_id}>
                  <TableCell className="font-mono text-xs">{c.class_id}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {c.realized_pnl_lots}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {c.unrealized_pnl_lots}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.resolution_status}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RiskTailCard() {
  const [body, setBody] = useState<RiskDecisionsBody | null>(null);
  useEffect(() => {
    void getJson<RiskDecisionsBody>('/api/risk/decisions/recent', { limit: 20 })
      .then(setBody)
      .catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Risk decisions (last 20)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ts</TableHead>
              <TableHead>intent</TableHead>
              <TableHead>decision</TableHead>
              <TableHead>reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!body || body.decisions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                  {body ? 'No risk decisions in window.' : 'Loading…'}
                </TableCell>
              </TableRow>
            ) : (
              body.decisions.map((d) => (
                <TableRow key={`${d.seq}-${d.intent_id}`}>
                  <TableCell className="font-mono text-xs">{fmtTs(d.ts_ns)}</TableCell>
                  <TableCell className="font-mono text-xs">{d.intent_id.slice(0, 12)}…</TableCell>
                  <TableCell className="font-mono text-xs">{d.decision}</TableCell>
                  <TableCell className="font-mono text-xs">{d.reject_reason ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function TraderPage() {
  const [me, setMe] = useState<MeBody | null>(null);
  useEffect(() => {
    void getJson<MeBody>('/api/me').then(setMe).catch(() => {});
  }, []);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Trader workbench</h1>
        {me ? <KillSwitchIndicator tenantId={me.tenant_id} /> : null}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PositionsCard />
        <FillsCard />
        <EquivalencePnlCard />
        <RiskTailCard />
      </div>
      <p className="text-xs text-muted-foreground">
        Order entry, cancel, and kill-switch flip ship in Phase 2 (T-UI-010).
      </p>
    </div>
  );
}

export default TraderPage;
