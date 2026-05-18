/**
 * `ServiceStatusGrid` — 4×4 grid of the 16 pinned LQT services
 * (per T-UI-002 operator handler). Each cell:
 *  - name
 *  - status pill (ok/degraded/down/unknown)
 *  - container status text
 *  - last audit-emit timestamp (relative)
 *
 * Cardinality is constant (always 16 cells) so we render the names
 * even when the Docker socket isn't reachable; the cells just show
 * `unknown`.
 */

import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { ServiceStatus, ServiceHealth } from '../types';

interface ServiceStatusGridProps {
  services: ServiceStatus[];
  dockerReachable?: boolean;
  className?: string;
}

function healthClass(h: ServiceHealth): string {
  switch (h) {
    case 'ok':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'degraded':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'down':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'unknown':
    default:
      return 'bg-gray-100 text-gray-700 border-gray-300';
  }
}

function relativeAge(ns: number | null): string {
  if (ns == null) return '—';
  const ageMs = Date.now() - Math.floor(ns / 1_000_000);
  if (!Number.isFinite(ageMs) || ageMs < 0) return '—';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h`;
  return `${Math.floor(ageMs / 86_400_000)}d`;
}

export function ServiceStatusGrid({
  services,
  dockerReachable = true,
  className,
}: ServiceStatusGridProps) {
  const sorted = useMemo(
    () => [...services].sort((a, b) => a.name.localeCompare(b.name)),
    [services],
  );

  return (
    <Card className={className ?? ''}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Service status</span>
          {!dockerReachable ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              docker unreachable
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="text-sm text-muted-foreground">No services registered.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {sorted.map((s) => (
              <div
                key={s.name}
                className="rounded-md border p-2 text-xs"
                title={`${s.name} — ${s.container_status}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="outline" className={`text-[10px] ${healthClass(s.healthy)}`}>
                    {s.healthy}
                  </Badge>
                </div>
                <div className="mt-1 text-muted-foreground">{s.container_status}</div>
                <div className="text-muted-foreground">
                  audit {relativeAge(s.last_audit_emit_at_ns)} ago
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ServiceStatusGrid;
