/**
 * `TreasuryLedgerTable` — paginated treasury ledger view.
 *
 * Columns: ts | rail | entry_type | amount | currency | entry_uuid
 *
 * Amounts are stored as micros (1e-6 currency unit) and rendered as
 * decimal in the wire-currency. Sign convention matches the
 * `treasury.{usdc,usd}_ledger.amount_micros` column — negative is a
 * debit on the accountant's view.
 */

import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { TreasuryEntry } from '../types';

interface TreasuryLedgerTableProps {
  entries: TreasuryEntry[];
  onLoadMore?: () => void;
  /** Filter the table to a specific rail (UI-side; the gateway also accepts ?rail=). */
  rail?: string;
  isLoading?: boolean;
  className?: string;
}

function fmtAmount(amount_micros: number, currency: string): string {
  const sign = amount_micros < 0 ? '−' : '';
  const abs = Math.abs(amount_micros);
  const units = Math.floor(abs / 1_000_000);
  const frac = abs % 1_000_000;
  // 4 decimal places is sufficient for USDC + USD reporting (down
  // to 0.0001 currency unit); micros precision is preserved in the
  // entry_uuid drill.
  const fracStr = frac.toString().padStart(6, '0').slice(0, 4);
  return `${sign}${units.toLocaleString()}.${fracStr} ${currency.toUpperCase()}`;
}

function fmtTs(ts_ns: number): string {
  const ms = Math.floor(ts_ns / 1_000_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ts_ns);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function truncate(s: string, head = 12): string {
  return s.length > head + 2 ? `${s.slice(0, head)}…` : s;
}

export function TreasuryLedgerTable({
  entries,
  onLoadMore,
  rail,
  isLoading,
  className,
}: TreasuryLedgerTableProps) {
  const filtered = useMemo(() => {
    if (!rail) return entries;
    return entries.filter((e) => e.rail === rail);
  }, [entries, rail]);

  return (
    <div className={className ?? ''}>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[10rem]">ts</TableHead>
              <TableHead className="w-[8rem]">rail</TableHead>
              <TableHead className="w-[8rem]">entry_type</TableHead>
              <TableHead className="text-right">amount</TableHead>
              <TableHead className="w-[5rem]">currency</TableHead>
              <TableHead className="w-[10rem]">entry_uuid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  {isLoading ? 'Loading…' : 'No entries in window.'}
                </TableCell>
              </TableRow>
            ) : null}
            {filtered.map((e) => (
              <TableRow key={e.entry_uuid}>
                <TableCell className="font-mono text-xs">{fmtTs(e.ts_ns)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">
                    {e.rail}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{e.entry_type}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fmtAmount(e.amount_micros, e.currency)}
                </TableCell>
                <TableCell className="text-xs">{e.currency.toUpperCase()}</TableCell>
                <TableCell className="font-mono text-xs" title={e.entry_uuid}>
                  {truncate(e.entry_uuid)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <span className="text-xs text-muted-foreground">
          {filtered.length} entry{filtered.length === 1 ? '' : 'ies'}
        </span>
        {onLoadMore ? (
          <Button variant="outline" size="sm" disabled={isLoading} onClick={onLoadMore}>
            Load more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default TreasuryLedgerTable;
