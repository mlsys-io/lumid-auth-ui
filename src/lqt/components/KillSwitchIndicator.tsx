/**
 * `KillSwitchIndicator` — green/yellow/red pill summarising the
 * kill-switch state for a tenant.
 *
 * Reads `/api/admin/tenant/:id/kill-switch` every 30s (admin role)
 * or the trader's own `kill-switch` slice (TBD endpoint for
 * Phase 2). This component is the **read-only display**; the flip
 * surface is operator-strategic Phase-2 work.
 *
 * Three states (per T-UI-002 spec):
 *  - DISABLED: any scope is "set" → red
 *  - PARTIAL : some scopes set, others clear → yellow (Phase 2 — the
 *              current gateway surface only returns set rows so we
 *              never see this today; reserved for future scope-aware
 *              shape)
 *  - ACTIVE  : no scopes set → green
 */

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { getJson, LqtGatewayError } from '../utils/axios';
import type { TenantKillSwitchBody, KillSwitchSummary } from '../types';

interface KillSwitchIndicatorProps {
  tenantId: string;
  /** Poll cadence; defaults to 30s. */
  refreshMs?: number;
  className?: string;
}

function summarise(body: TenantKillSwitchBody | null): KillSwitchSummary {
  if (!body) return 'UNKNOWN';
  if (body.scopes.length === 0) return 'ACTIVE';
  // Today the gateway only returns "set" rows. When the Phase-2
  // payload decoder lands we can distinguish PARTIAL.
  return 'DISABLED';
}

function pillClass(s: KillSwitchSummary): string {
  switch (s) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'DISABLED':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'PARTIAL':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'UNKNOWN':
    default:
      return 'bg-gray-100 text-gray-700 border-gray-300';
  }
}

export function KillSwitchIndicator({
  tenantId,
  refreshMs = 30_000,
  className,
}: KillSwitchIndicatorProps) {
  const [body, setBody] = useState<TenantKillSwitchBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        const resp = await getJson<TenantKillSwitchBody>(
          `/api/admin/tenant/${encodeURIComponent(tenantId)}/kill-switch`,
        );
        if (!cancelled) {
          setBody(resp);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof LqtGatewayError ? `${e.message} (${e.status ?? 'net'})` : String(e);
          setError(msg);
        }
      }
    }

    void tick();
    timer = setInterval(tick, refreshMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [tenantId, refreshMs]);

  const summary = summarise(body);
  const klass = pillClass(summary);

  return (
    <div className={`inline-flex flex-col items-start gap-0.5 ${className ?? ''}`}>
      <Badge
        variant="outline"
        className={`font-mono text-xs ${klass}`}
        title={error ?? `Kill-switch state for ${tenantId}`}
      >
        kill-switch: {summary}
      </Badge>
      {body && body.scopes.length > 0 ? (
        <span className="text-[10px] text-muted-foreground">
          {body.scopes.length} scope{body.scopes.length === 1 ? '' : 's'} set
        </span>
      ) : null}
    </div>
  );
}

export default KillSwitchIndicator;
