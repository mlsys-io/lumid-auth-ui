/**
 * Researcher workbench — `/app/lqt/researcher`.
 *
 * Five cards (per `plans/fizzy-humming-quasar.md` §"6 thin slices"):
 *  1. Recent backtests
 *  2. Signal IC line chart (90d)
 *  3. Regime snapshot
 *  4. Bandit weights heatmap (rendered as table for thin slice)
 *  5. Promotions
 *
 * Thin slice — read-only MVP. "Promote signal" wizard is Phase 2
 * (T-UI-012).
 */

import { useEffect, useMemo, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { getJson } from '../utils/axios';
import { IcLineChart } from '../components/IcLineChart';
import type {
  BacktestsBody,
  BanditWeightsBody,
  PromotionsBody,
  RegimeBody,
  SignalIcBody,
  SignalsBody,
} from '../types';

function fmtTs(ts_ns: number | null | undefined): string {
  if (ts_ns == null) return '—';
  const d = new Date(Math.floor(ts_ns / 1_000_000));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 19);
}

function BacktestsCard() {
  const [body, setBody] = useState<BacktestsBody | null>(null);
  useEffect(() => {
    void getJson<BacktestsBody>('/api/research/backtests', { limit: 50 })
      .then(setBody)
      .catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent backtests</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>run</TableHead>
                <TableHead>signal</TableHead>
                <TableHead className="text-right">sharpe</TableHead>
                <TableHead className="text-right">IC</TableHead>
                <TableHead>outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!body || body.backtests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                    {body ? 'No backtests in window.' : 'Loading…'}
                  </TableCell>
                </TableRow>
              ) : (
                body.backtests.map((b) => (
                  <TableRow key={b.run_id}>
                    <TableCell className="font-mono text-xs">{b.run_id.slice(0, 12)}…</TableCell>
                    <TableCell className="font-mono text-xs">
                      {b.signal_name}@{b.signal_version}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {b.sharpe?.toFixed(2) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {b.ic?.toFixed(4) ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{b.outcome}</TableCell>
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

function SignalIcCard() {
  const [signals, setSignals] = useState<SignalsBody | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [points, setPoints] = useState<SignalIcBody | null>(null);

  useEffect(() => {
    void getJson<SignalsBody>('/api/research/signals').then(setSignals).catch(() => {});
  }, []);

  useEffect(() => {
    if (signals && !active && signals.signals.length > 0) {
      setActive(signals.signals[0].name);
    }
  }, [signals, active]);

  useEffect(() => {
    if (!active) return;
    const until = BigInt(Date.now()) * 1_000_000n;
    const since = until - 90n * 24n * 3600n * 1_000_000_000n;
    void getJson<SignalIcBody>('/api/research/signal-ic', {
      signal: active,
      since: since.toString(),
      until: until.toString(),
    })
      .then(setPoints)
      .catch(() => {});
  }, [active]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Signal IC (90d)</span>
          {signals && signals.signals.length > 0 ? (
            <Select value={active ?? undefined} onValueChange={setActive}>
              <SelectTrigger className="h-7 w-[14rem] text-xs">
                <SelectValue placeholder="select signal" />
              </SelectTrigger>
              <SelectContent>
                {signals.signals.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}@{s.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <IcLineChart signalName={active ?? '—'} points={points?.points ?? []} />
      </CardContent>
    </Card>
  );
}

function RegimeCard() {
  const [body, setBody] = useState<RegimeBody | null>(null);
  useEffect(() => {
    void getJson<RegimeBody>('/api/research/regime').then(setBody).catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Current regime</CardTitle>
      </CardHeader>
      <CardContent>
        {!body ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : !body.vol_bucket ? (
          <div className="text-xs text-muted-foreground">No regime snapshot.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded border p-2 text-center">
              <div className="text-muted-foreground">vol</div>
              <div className="font-mono">{body.vol_bucket}</div>
            </div>
            <div className="rounded border p-2 text-center">
              <div className="text-muted-foreground">spread</div>
              <div className="font-mono">{body.spread_bucket}</div>
            </div>
            <div className="rounded border p-2 text-center">
              <div className="text-muted-foreground">oi</div>
              <div className="font-mono">{body.oi_bucket}</div>
            </div>
          </div>
        )}
        {body?.computed_at_ns ? (
          <div className="pt-2 text-[10px] text-muted-foreground">
            computed {fmtTs(body.computed_at_ns)}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BanditWeightsCard() {
  const [body, setBody] = useState<BanditWeightsBody | null>(null);
  useEffect(() => {
    void getJson<BanditWeightsBody>('/api/research/bandit-weights').then(setBody).catch(() => {});
  }, []);

  const grouped = useMemo<Record<string, BanditWeightsBody['cells']>>(() => {
    const out: Record<string, BanditWeightsBody['cells']> = {};
    if (!body) return out;
    for (const c of body.cells) {
      (out[c.alpha_id] ??= []).push(c);
    }
    return out;
  }, [body]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Bandit weights (Beta-Bernoulli)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto">
          {Object.keys(grouped).length === 0 ? (
            <div className="text-xs text-muted-foreground">No bandit cells observed yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>alpha</TableHead>
                  <TableHead>regime</TableHead>
                  <TableHead className="text-right">α</TableHead>
                  <TableHead className="text-right">β</TableHead>
                  <TableHead className="text-right">n</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(grouped).flatMap(([alpha, cells]) =>
                  cells.map((c) => (
                    <TableRow key={`${alpha}-${c.regime_context}`}>
                      <TableCell className="font-mono text-xs">{alpha}</TableCell>
                      <TableCell className="font-mono text-xs">{c.regime_context}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.posterior_alpha.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.posterior_beta.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.observation_count}
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PromotionsCard() {
  const [body, setBody] = useState<PromotionsBody | null>(null);
  useEffect(() => {
    void getJson<PromotionsBody>('/api/research/promotions', { limit: 50 })
      .then(setBody)
      .catch(() => {});
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent promotions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ts</TableHead>
                <TableHead>signal</TableHead>
                <TableHead>from → to</TableHead>
                <TableHead>PR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!body || body.promotions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                    {body ? 'No promotion runs.' : 'Loading…'}
                  </TableCell>
                </TableRow>
              ) : (
                body.promotions.map((p) => (
                  <TableRow key={`${p.seq}-${p.signal_name}`}>
                    <TableCell className="font-mono text-xs">{fmtTs(p.ts_ns)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.signal_name}@{p.signal_version}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.from_stage} → {p.to_stage}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.pr_branch ?? '—'}</TableCell>
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

export function ResearcherPage() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Researcher</h1>
        <Badge variant="outline" className="text-xs text-muted-foreground">
          read-only · Phase 1
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BacktestsCard />
        <SignalIcCard />
        <RegimeCard />
        <BanditWeightsCard />
        <PromotionsCard />
      </div>
      <p className="text-xs text-muted-foreground">
        Signal promotion wizard ships in Phase 2 (T-UI-012).
      </p>
    </div>
  );
}

export default ResearcherPage;
