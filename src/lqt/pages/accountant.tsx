/**
 * Accountant workbench — `/app/lqt/accountant`.
 *
 * Five cards (per `plans/fizzy-humming-quasar.md` §"6 thin slices"):
 *  1. Treasury balances strip (per rail)
 *  2. Treasury ledger paginated
 *  3. Tearsheets table (30d)
 *  4. TCA decomposition (today, per equivalence class)
 *  5. Regulatory export receipts
 *
 * Plus: cross-venue compliance card (P2-K surface).
 *
 * Thin slice — read-only MVP. Manual reconciliation trigger and
 * on-demand regulatory export ship in Phase 2 (T-UI-014).
 */

import { useEffect, useState } from 'react';

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
import { TreasuryLedgerTable } from '../components/TreasuryLedgerTable';
import type {
  CrossVenueComplianceBody,
  ExportsBody,
  TcaBody,
  TearsheetsBody,
  TreasuryBalancesBody,
  TreasuryLedgerBody,
} from '../types';

function fmtMicros(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  const abs = Math.abs(amount);
  const units = Math.floor(abs / 1_000_000);
  return `${sign}${units.toLocaleString()}`;
}

function BalancesCard() {
  const [body, setBody] = useState<TreasuryBalancesBody | null>(null);
  useEffect(() => {
    void getJson<TreasuryBalancesBody>('/api/treasury/balances').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Treasury balances</CardTitle>
      </CardHeader>
      <CardContent>
        {!body ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : body.balances.length === 0 ? (
          <div className="text-xs text-muted-foreground">No balances.</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {body.balances.map((b) => (
              <div key={`${b.rail}-${b.currency}`} className="rounded-md border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {b.rail}
                  </Badge>
                  <span className="text-muted-foreground">{b.currency.toUpperCase()}</span>
                </div>
                <div className="mt-1 font-mono text-base font-medium">
                  {fmtMicros(b.balance_micros)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  last move{' '}
                  {b.last_movement_at_ns == null
                    ? '—'
                    : new Date(Math.floor(b.last_movement_at_ns / 1_000_000))
                        .toISOString()
                        .slice(0, 19)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LedgerCard() {
  const [body, setBody] = useState<TreasuryLedgerBody | null>(null);
  const [rail, setRail] = useState<string | undefined>(undefined);
  async function load() {
    const resp = await getJson<TreasuryLedgerBody>('/api/treasury/ledger', {
      limit: 100,
      ...(rail ? { rail } : {}),
    });
    setBody(resp);
  }
  useEffect(() => {
    void load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rail]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Treasury ledger</span>
          <div className="flex gap-1">
            {[undefined, 'polygon-usdc', 'polygon-pusd', 'ledgerx-usd'].map((r) => (
              <Badge
                key={r ?? 'all'}
                variant={r === rail ? 'default' : 'outline'}
                className="cursor-pointer text-[10px]"
                onClick={() => setRail(r)}
              >
                {r ?? 'all'}
              </Badge>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TreasuryLedgerTable entries={body?.entries ?? []} isLoading={body == null} />
      </CardContent>
    </Card>
  );
}

function TearsheetsCard() {
  const [body, setBody] = useState<TearsheetsBody | null>(null);
  useEffect(() => {
    void getJson<TearsheetsBody>('/api/attrib/tearsheets').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tearsheets (30d)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>day</TableHead>
                <TableHead>strategy</TableHead>
                <TableHead className="text-right">sharpe</TableHead>
                <TableHead className="text-right">sortino</TableHead>
                <TableHead className="text-right">DD (lots)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!body || body.tearsheets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                    {body ? 'No tearsheets.' : 'Loading…'}
                  </TableCell>
                </TableRow>
              ) : (
                body.tearsheets.map((t) => (
                  <TableRow key={`${t.day}-${t.strategy_id}`}>
                    <TableCell className="font-mono text-xs">{t.day}</TableCell>
                    <TableCell className="font-mono text-xs">{t.strategy_id}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {t.sharpe?.toFixed(2) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {t.sortino?.toFixed(2) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {t.max_drawdown_lots ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function TcaCard() {
  const [body, setBody] = useState<TcaBody | null>(null);
  useEffect(() => {
    void getJson<TcaBody>('/api/attrib/tca').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>TCA decomposition</span>
          {body ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {body.day}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-64 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>class</TableHead>
                <TableHead>venue</TableHead>
                <TableHead className="text-right">spread</TableHead>
                <TableHead className="text-right">tick</TableHead>
                <TableHead className="text-right">time</TableHead>
                <TableHead className="text-right">fee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!body || body.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                    {body ? 'No TCA rows.' : 'Loading…'}
                  </TableCell>
                </TableRow>
              ) : (
                body.rows.map((r, i) => (
                  <TableRow key={`${r.equivalence_class_id}-${i}`}>
                    <TableCell className="font-mono text-xs">{r.equivalence_class_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.venue ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.spread_cost_lots}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.tick_impact_lots}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.time_impact_lots}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.fee_lots}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ExportsCard() {
  const [body, setBody] = useState<ExportsBody | null>(null);
  useEffect(() => {
    void getJson<ExportsBody>('/api/compliance/exports', { limit: 50 })
      .then(setBody)
      .catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Regulatory export receipts</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
          {!body ? (
            <li className="text-muted-foreground">Loading…</li>
          ) : body.exports.length === 0 ? (
            <li className="text-muted-foreground">No export receipts.</li>
          ) : (
            body.exports.map((e) => (
              <li key={`${e.seq}-${e.kind}`} className="rounded border p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono">seq {e.seq}</span>
                  <span className="font-mono text-muted-foreground">
                    {new Date(Math.floor(e.ts_ns / 1_000_000)).toISOString().slice(0, 19)}
                  </span>
                </div>
                <div className="font-mono text-[10px]">{e.kind}</div>
                <div className="text-[10px] text-muted-foreground">
                  workflow: {e.workflow_name ?? '—'} · day: {e.day_covered ?? '—'}
                </div>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function CrossVenueComplianceCard() {
  const [body, setBody] = useState<CrossVenueComplianceBody | null>(null);
  useEffect(() => {
    void getJson<CrossVenueComplianceBody>('/api/compliance/cross-venue').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Cross-venue compliance</span>
          {body ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {body.day}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-64 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>class</TableHead>
                <TableHead className="text-right">pm notional</TableHead>
                <TableHead className="text-right">ks notional</TableHead>
                <TableHead>aligned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!body || body.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                    {body ? 'No cross-venue rows.' : 'Loading…'}
                  </TableCell>
                </TableRow>
              ) : (
                body.rows.map((r) => (
                  <TableRow key={r.class_id}>
                    <TableCell className="font-mono text-xs">{r.class_id}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtMicros(r.polymarket_notional_micros)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtMicros(r.kalshi_notional_micros)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.resolution_aligned == null
                        ? '—'
                        : r.resolution_aligned
                          ? 'yes'
                          : `no${r.divergence_kind ? ` (${r.divergence_kind})` : ''}`}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function AccountantPage() {
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">Accountant</h1>
      <BalancesCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LedgerCard />
        <TearsheetsCard />
        <TcaCard />
        <ExportsCard />
        <CrossVenueComplianceCard />
      </div>
      <p className="text-xs text-muted-foreground">
        Manual reconciliation trigger and on-demand regulatory export ship in Phase 2 (T-UI-014).
      </p>
    </div>
  );
}

export default AccountantPage;
