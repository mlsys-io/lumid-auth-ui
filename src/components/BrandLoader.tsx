// BrandLoader — the canonical waiting indicator. Contextual placeholder boxes
// (the shape content will take) with the Lumid strand mark resting ON them —
// on-brand and in-context. Used full-screen on cold load / the auth check.
//
// SpiralOverlay is the same mark as an absolutely-positioned overlay, to drop
// onto ANY existing skeleton loading state (Library grid, app workflows, …) so
// the logo sits on those context boxes too — wrap the skeleton container in
// `relative` and render <SpiralOverlay/> inside it.
//
// Lumen (2026-11): the mark is the SVG StrandMark in its "thinking" state (a
// glint running along the strands) instead of the 22 KB spiral.png, and the
// boxes are the warm sheen skeleton instead of a slate pulse. Both are CSS-only
// and degrade to a slow fade under prefers-reduced-motion.

import { StrandMark } from "@/components/illustrations/StrandMark";

/** `size` is the legacy Tailwind class ("w-9 h-9") or a pixel height. */
function px(size: string | number): number {
  if (typeof size === "number") return size;
  const m = size.match(/w-(\d+)/);
  return m ? Number(m[1]) * 4 : 36;
}

export function SpiralOverlay({ size = "w-9 h-9" }: { size?: string | number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" role="status" aria-label="Loading">
      <StrandMark size={px(size)} state="thinking" className="drop-shadow-sm" />
    </div>
  );
}

export default function BrandLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="relative w-full max-w-3xl">
        <div className="space-y-3 opacity-80" aria-hidden="true">
          <div className="lumen-skeleton h-24 rounded-2xl" />
          <div className="lumen-skeleton h-40 rounded-2xl" />
          <div className="lumen-skeleton h-40 rounded-2xl" />
        </div>
        <SpiralOverlay size={44} />
      </div>
    </div>
  );
}
