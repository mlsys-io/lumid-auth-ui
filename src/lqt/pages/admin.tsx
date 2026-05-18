/**
 * Admin console — `/app/lqt/admin`.
 *
 * Five cards (per `plans/fizzy-humming-quasar.md` §"6 thin slices"):
 *  1. Tenant grid (bridged from lum.id/api/v1/admin/users)
 *  2. Per-tenant audit-chain head
 *  3. Kill-switch column per tenant
 *  4. HSM key inventory
 *  5. Tenant switcher (super_admin only)
 *
 * Route is gated by `AdminGuard` in `App.tsx`. Tenant provisioning
 * and kill-switch flip ship in Phase 2 (T-UI-015).
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

import { getJson, LqtGatewayError } from '../utils/axios';
import { KillSwitchIndicator } from '../components/KillSwitchIndicator';
import { TenantSwitcher } from '../components/TenantSwitcher';
import type {
  HsmKeysBody,
  MeBody,
  Tenant,
  TenantAuditHeadBody,
  TenantsBody,
} from '../types';

function truncate(s: string, head = 12): string {
  return s.length > head + 2 ? `${s.slice(0, head)}…` : s;
}

interface TenantsTableProps {
  tenants: Tenant[];
  auditHeads: Record<string, TenantAuditHeadBody | 'pending' | 'unavailable'>;
}

function TenantsTable({ tenants, auditHeads }: TenantsTableProps) {
  if (tenants.length === 0) {
    return <div className="text-xs text-muted-foreground">No tenants visible.</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>tenant_id</TableHead>
          <TableHead>email</TableHead>
          <TableHead>role</TableHead>
          <TableHead>audit head</TableHead>
          <TableHead>kill-switch</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tenants.map((t) => {
          const head = auditHeads[t.tenant_id];
          return (
            <TableRow key={t.tenant_id}>
              <TableCell className="font-mono text-xs" title={t.tenant_id}>
                {truncate(t.tenant_id)}
              </TableCell>
              <TableCell className="font-mono text-xs">{t.email || '—'}</TableCell>
              <TableCell className="font-mono text-xs">{t.role || '—'}</TableCell>
              <TableCell className="font-mono text-xs">
                {head == null
                  ? '—'
                  : head === 'pending'
                    ? 'loading…'
                    : head === 'unavailable'
                      ? '—'
                      : `#${head.head_seq} (${head.head_hash_hex.slice(0, 10)}…)`}
              </TableCell>
              <TableCell>
                <KillSwitchIndicator tenantId={t.tenant_id} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function HsmKeysCard() {
  const [body, setBody] = useState<HsmKeysBody | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getJson<HsmKeysBody>('/api/admin/hsm-keys')
      .then(setBody)
      .catch((e) =>
        setErr(
          e instanceof LqtGatewayError ? `${e.message} (${e.status ?? 'net'})` : String(e),
        ),
      );
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">HSM key inventory</CardTitle>
      </CardHeader>
      <CardContent>
        {err ? <div className="text-xs text-red-600">{err}</div> : null}
        {!body ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : body.tenants.length === 0 ? (
          <div className="text-xs text-muted-foreground">No HSM key emits observed.</div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {body.tenants.map((row) => (
              <div key={row.tenant_id} className="rounded border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono" title={row.tenant_id}>
                    {truncate(row.tenant_id)}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {row.keys.length} key{row.keys.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                <ul className="mt-1 space-y-1">
                  {row.keys.map((k) => (
                    <li key={`${row.tenant_id}-${k.key_id}`} className="font-mono text-[10px]">
                      {k.label} · {k.status} · rotated{' '}
                      {new Date(Math.floor(k.last_rotated_at_ns / 1_000_000))
                        .toISOString()
                        .slice(0, 10)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminPage() {
  const [me, setMe] = useState<MeBody | null>(null);
  const [tenants, setTenants] = useState<TenantsBody | null>(null);
  const [auditHeads, setAuditHeads] = useState<
    Record<string, TenantAuditHeadBody | 'pending' | 'unavailable'>
  >({});

  useEffect(() => {
    void getJson<MeBody>('/api/me').then(setMe).catch(() => {});
    void getJson<TenantsBody>('/api/admin/tenants').then(setTenants).catch(() => {});
  }, []);

  const visibleTenants = useMemo<Tenant[]>(() => tenants?.tenants ?? [], [tenants]);

  // Fetch audit-head per tenant (one at a time so we don't shotgun
  // the gateway when the tenant list grows; bounded by the visible
  // page size).
  useEffect(() => {
    let cancelled = false;
    async function loadHeads() {
      for (const t of visibleTenants) {
        if (cancelled) return;
        setAuditHeads((prev) =>
          prev[t.tenant_id] ? prev : { ...prev, [t.tenant_id]: 'pending' },
        );
        try {
          const head = await getJson<TenantAuditHeadBody>(
            `/api/admin/tenant/${encodeURIComponent(t.tenant_id)}/audit-head`,
          );
          if (cancelled) return;
          setAuditHeads((prev) => ({ ...prev, [t.tenant_id]: head }));
        } catch {
          if (cancelled) return;
          setAuditHeads((prev) => ({ ...prev, [t.tenant_id]: 'unavailable' }));
        }
      }
    }
    void loadHeads();
    return () => {
      cancelled = true;
    };
  }, [visibleTenants]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Admin</h1>
        <TenantSwitcher meCache={me} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-sm">
            <span>Tenants</span>
            {tenants?.degraded ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                lum.id bridge degraded
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!tenants ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : (
            <TenantsTable tenants={visibleTenants} auditHeads={auditHeads} />
          )}
        </CardContent>
      </Card>
      <HsmKeysCard />
      <p className="text-xs text-muted-foreground">
        Tenant provisioning, kill-switch flip, and access-grant editor ship in Phase 2 (T-UI-015).
      </p>
    </div>
  );
}

export default AdminPage;
