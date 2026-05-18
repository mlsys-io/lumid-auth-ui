/**
 * `TenantSwitcher` — dropdown of tenants for super_admin and admin
 * personas to scope per-tenant views.
 *
 * Hidden for ordinary users. The selection is persisted in
 * `localStorage["lqt:active-tenant"]` so it survives navigation
 * within the SPA. The parent receives the chosen tenant_id via the
 * `onTenantChange` callback and is responsible for re-fetching.
 */

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { getJson, LqtGatewayError } from '../utils/axios';
import type { MeBody, TenantsBody, Tenant } from '../types';

interface TenantSwitcherProps {
  /** Notify the parent when the user picks a tenant. */
  onTenantChange?: (tenantId: string) => void;
  /** Optional pre-fetched `/api/me` body to avoid an extra round-trip. */
  meCache?: MeBody | null;
  className?: string;
}

const STORAGE_KEY = 'lqt:active-tenant';

function readSavedTenant(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSavedTenant(s: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (s == null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, s);
  } catch {
    // ignore quota / private-browsing errors
  }
}

export function TenantSwitcher({
  onTenantChange,
  meCache,
  className,
}: TenantSwitcherProps) {
  const [me, setMe] = useState<MeBody | null>(meCache ?? null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [degraded, setDegraded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(readSavedTenant());

  // Fetch /api/me if not provided.
  useEffect(() => {
    let cancelled = false;
    if (me) return;
    void (async () => {
      try {
        const resp = await getJson<MeBody>('/api/me');
        if (!cancelled) setMe(resp);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof LqtGatewayError ? `me_${e.status ?? 'net'}: ${e.message}` : String(e),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me]);

  const role = me?.role;
  const isPrivileged = role === 'admin' || role === 'super_admin';

  // Fetch tenant list only when privileged.
  useEffect(() => {
    if (!isPrivileged) return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await getJson<TenantsBody>('/api/admin/tenants');
        if (!cancelled) {
          setTenants(resp.tenants);
          setDegraded(resp.degraded);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof LqtGatewayError
              ? `tenants_${e.status ?? 'net'}: ${e.message}`
              : String(e),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPrivileged]);

  const options = useMemo<Tenant[]>(() => tenants ?? [], [tenants]);

  if (!me) return null;
  if (!isPrivileged) return null; // hidden for ordinary users

  function handleChange(next: string) {
    setActive(next);
    writeSavedTenant(next);
    onTenantChange?.(next);
  }

  function handleClear() {
    setActive(null);
    writeSavedTenant(null);
    onTenantChange?.(me?.tenant_id ?? '');
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="text-xs text-muted-foreground">tenant</span>
      <Select value={active ?? me.tenant_id} onValueChange={handleChange}>
        <SelectTrigger className="h-8 w-[18rem] text-xs">
          <SelectValue placeholder="self" />
        </SelectTrigger>
        <SelectContent>
          {options.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {degraded ? 'lum.id bridge unavailable' : 'No tenants visible'}
            </div>
          ) : (
            options.map((t) => (
              <SelectItem key={t.tenant_id} value={t.tenant_id}>
                <span className="font-mono text-xs">
                  {t.email || t.tenant_id} <span className="text-muted-foreground">({t.role})</span>
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {active && active !== me.tenant_id ? (
        <Button variant="outline" size="sm" onClick={handleClear}>
          self
        </Button>
      ) : null}
      {degraded ? (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          degraded
        </Badge>
      ) : null}
      {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
    </div>
  );
}

export default TenantSwitcher;
