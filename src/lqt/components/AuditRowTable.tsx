/**
 * `AuditRowTable` — paginated audit chain table.
 *
 * Columns: seq | ts | kind | actor | tenant_id | (expand)
 *
 * Row expansion reveals the full payload_hash + entry_hash and the
 * `HopsBreadcrumb` if the parent supplies a chain-heads list. The
 * payload itself is not in the wire response — full payload decode
 * is a Phase-2 surface (per T-UI-002 documented Future Work).
 *
 * Live toggle is owned by the parent (auditor page); this component
 * just renders rows and signals "load more" upward.
 */

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { AuditRow } from '../types';
import { HopsBreadcrumb } from './HopsBreadcrumb';
import { KindBadge } from './KindBadge';

interface AuditRowTableProps {
  rows: AuditRow[];
  /** Called when "Load more" is clicked; receives the cursor. */
  onLoadMore?: (next_seq: number | null) => void;
  /** When the auditor toggles "live", parent wires the SSE stream. */
  liveOn?: boolean;
  onToggleLive?: (next: boolean) => void;
  /** Per-row chain-heads lookup for expanded view (optional). */
  chainHeadsByEntryHash?: (entryHashHex: string) => string[];
  isLoading?: boolean;
  className?: string;
}

function formatTs(ts_ns: number): string {
  // Convert nanos to ms; ECMAScript Date is millis-precision.
  const ms = Math.floor(ts_ns / 1_000_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ts_ns);
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

function truncateUuid(s: string, head = 8): string {
  return s.length > head + 2 ? `${s.slice(0, head)}…` : s;
}

function truncateHash(s: string, head = 10): string {
  return s.length > head + 2 ? `${s.slice(0, head)}…` : s;
}

interface RowKey {
  seq: number;
}

/**
 * React keys are stable on the immutable `(seq, entry_hash)` pair.
 * Audit rows are append-only by chain rule so this is safe.
 */
function rowKey(r: AuditRow): string {
  return `${r.seq}-${r.entry_hash_hex.slice(0, 16)}`;
}

export function AuditRowTable({
  rows,
  onLoadMore,
  liveOn,
  onToggleLive,
  chainHeadsByEntryHash,
  isLoading,
  className,
}: AuditRowTableProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const nextSeq = useMemo<number | null>(() => {
    if (rows.length === 0) return null;
    // The gateway returns rows ascending by seq and a separate
    // `next_seq` value. As a fallback, derive from the tail.
    return rows[rows.length - 1].seq;
  }, [rows]);

  function toggleExpand(seq: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  return (
    <div className={className ?? ''}>
      <div className="flex items-center justify-between pb-2">
        <h3 className="text-sm font-medium">Audit chain</h3>
        {onToggleLive ? (
          <Button
            variant={liveOn ? 'default' : 'outline'}
            size="sm"
            onClick={() => onToggleLive(!liveOn)}
          >
            {liveOn ? 'Live (on)' : 'Live'}
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[5.5rem]">seq</TableHead>
              <TableHead className="w-[12rem]">ts</TableHead>
              <TableHead>kind</TableHead>
              <TableHead className="w-[10rem]">actor</TableHead>
              <TableHead className="w-[10rem]">tenant_id</TableHead>
              <TableHead className="w-[4rem]">expand</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  {isLoading ? 'Loading…' : 'No audit rows in window.'}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((r) => {
              const isOpen = expanded.has(r.seq);
              return (
                <>
                  <TableRow key={rowKey(r)}>
                    <TableCell className="font-mono text-xs">{r.seq}</TableCell>
                    <TableCell className="font-mono text-xs">{formatTs(r.ts_ns)}</TableCell>
                    <TableCell>
                      <KindBadge kind={r.kind} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.actor}</TableCell>
                    <TableCell className="font-mono text-xs" title={r.tenant_id}>
                      {truncateUuid(r.tenant_id)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpand(r.seq)}
                        aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                      >
                        {isOpen ? '−' : '+'}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow key={`${rowKey(r)}-detail`}>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <div className="space-y-2 py-2 text-xs">
                          <div className="grid grid-cols-2 gap-2 font-mono">
                            <div>
                              <div className="text-muted-foreground">payload_hash</div>
                              <div title={r.payload_hash_hex}>
                                {truncateHash(r.payload_hash_hex, 24)}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">entry_hash</div>
                              <div title={r.entry_hash_hex}>
                                {truncateHash(r.entry_hash_hex, 24)}
                              </div>
                            </div>
                          </div>
                          {chainHeadsByEntryHash ? (
                            <div>
                              <div className="text-muted-foreground">chain</div>
                              <HopsBreadcrumb
                                chainHeads={chainHeadsByEntryHash(r.entry_hash_hex)}
                              />
                            </div>
                          ) : null}
                          <div className="text-muted-foreground">
                            Full payload decode is a Phase-2 surface — see
                            T-UI-002 §Future work.
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <span className="text-xs text-muted-foreground">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </span>
        {onLoadMore ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => onLoadMore(nextSeq)}
          >
            Load more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Re-export the row key helper for parent components that need it.
export type { RowKey };
export default AuditRowTable;
