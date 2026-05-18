/**
 * `HopsBreadcrumb` — entry_hash → prev_hash drill.
 *
 * Shown when an auditor expands a row in `AuditRowTable`. Each hop
 * is the truncated head of the blake3 hex digest; the full digest is
 * available in a tooltip + can be copied with a click. The
 * navigation forward/backward through the chain is a Phase-2 surface
 * — this component just *displays* the chain heads.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface HopsBreadcrumbProps {
  chainHeads: string[];
  /**
   * When a hop is clicked, the parent can navigate to that row.
   * Phase-1 default is a no-op.
   */
  onHopClick?: (hash: string) => void;
  className?: string;
}

function truncate(hash: string, head = 12): string {
  if (hash.length <= head + 2) return hash;
  return `${hash.slice(0, head)}…`;
}

function copyToClipboard(s: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(s);
  }
}

export function HopsBreadcrumb({
  chainHeads,
  onHopClick,
  className,
}: HopsBreadcrumbProps) {
  const [copied, setCopied] = useState<string | null>(null);

  if (chainHeads.length === 0) {
    return (
      <div className={`text-sm text-muted-foreground ${className ?? ''}`}>
        No chain heads available.
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-1 font-mono text-xs ${className ?? ''}`}
    >
      {chainHeads.map((hash, i) => {
        const isLast = i === chainHeads.length - 1;
        return (
          <span key={`${hash}-${i}`} className="inline-flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              title={hash}
              onClick={() => {
                copyToClipboard(hash);
                setCopied(hash);
                onHopClick?.(hash);
                setTimeout(() => setCopied(null), 1200);
              }}
            >
              {copied === hash ? 'copied' : truncate(hash)}
            </Button>
            {!isLast && (
              <span className="text-muted-foreground" aria-hidden="true">
                →
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default HopsBreadcrumb;
