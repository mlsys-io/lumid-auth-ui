/**
 * `KindBadge` — color-coded audit-kind pill.
 *
 * Kinds are namespaced like `lqt.<domain>.<event>.<version>`. We
 * color by the domain segment so an auditor scanning a 1000-row
 * table can see clusters by surface. The Tailwind classes follow
 * lumid_ui's shadcn `Badge` conventions (bg-* / text-*) and avoid
 * dynamic class concatenation that Tailwind's JIT can't see.
 */

import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';

interface KindBadgeProps {
  kind: string;
  /** Override the rendered text — useful for truncated displays. */
  label?: string;
  className?: string;
}

interface BadgeStyle {
  className: string;
  /** Human-readable label for the domain (for tooltips). */
  domainLabel: string;
}

const FALLBACK: BadgeStyle = {
  className: 'bg-gray-100 text-gray-800 border-gray-300',
  domainLabel: 'other',
};

function styleForKind(kind: string): BadgeStyle {
  // Strip the `lqt.` prefix and read the next segment.
  const trimmed = kind.startsWith('lqt.') ? kind.slice(4) : kind;
  const first = trimmed.split('.')[0] ?? '';

  // Static map so Tailwind's JIT picks up every class.
  switch (first) {
    case 'audit':
      return {
        className: 'bg-blue-100 text-blue-800 border-blue-300',
        domainLabel: 'audit',
      };
    case 'oms':
      return {
        className: 'bg-green-100 text-green-800 border-green-300',
        domainLabel: 'oms',
      };
    case 'portfolio':
      return {
        className: 'bg-purple-100 text-purple-800 border-purple-300',
        domainLabel: 'portfolio',
      };
    case 'compliance':
      return {
        className: 'bg-orange-100 text-orange-800 border-orange-300',
        domainLabel: 'compliance',
      };
    case 'venue':
      // Sub-discriminate polymarket vs kalshi.
      if (trimmed.startsWith('venue.polymarket')) {
        return {
          className: 'bg-violet-100 text-violet-800 border-violet-300',
          domainLabel: 'polymarket',
        };
      }
      if (trimmed.startsWith('venue.kalshi')) {
        return {
          className: 'bg-rose-100 text-rose-800 border-rose-300',
          domainLabel: 'kalshi',
        };
      }
      return {
        className: 'bg-pink-100 text-pink-800 border-pink-300',
        domainLabel: 'venue',
      };
    case 'hsm':
      return {
        className: 'bg-red-100 text-red-800 border-red-300',
        domainLabel: 'hsm',
      };
    case 'risk':
      return {
        className: 'bg-yellow-100 text-yellow-800 border-yellow-300',
        domainLabel: 'risk',
      };
    case 'treasury':
      return {
        className: 'bg-amber-100 text-amber-800 border-amber-300',
        domainLabel: 'treasury',
      };
    case 'alpha':
    case 'research':
      return {
        className: 'bg-indigo-100 text-indigo-800 border-indigo-300',
        domainLabel: 'research',
      };
    case 'umem':
    case 'workflow':
      return {
        className: 'bg-teal-100 text-teal-800 border-teal-300',
        domainLabel: 'workflow',
      };
    case 'kalshi':
    case 'uma':
    case 'attribution':
    case 'attrib':
    case 'router':
    case 'instrument':
    case 'kill_switch':
    case 'api_gateway':
    case 'app_emit':
    default:
      return FALLBACK;
  }
}

export function KindBadge({ kind, label, className }: KindBadgeProps) {
  const style = useMemo(() => styleForKind(kind), [kind]);
  const rendered = label ?? kind;
  return (
    <Badge
      variant="outline"
      className={`font-mono text-xs ${style.className} ${className ?? ''}`}
      title={kind}
    >
      {rendered}
    </Badge>
  );
}

export default KindBadge;
