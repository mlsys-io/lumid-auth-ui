// BrandLoader — the canonical waiting indicator. Contextual gray placeholder
// boxes (the shape content will take) with the Lumid spiral mark resting ON
// them, slowly rotating — on-brand and in-context. Used full-screen on cold
// load / the auth check.
//
// SpiralOverlay is the same spinning mark as an absolutely-positioned overlay,
// to drop onto ANY existing skeleton/gray-box loading state (Library grid, app
// workflows, …) so the logo sits on those context boxes too — wrap the skeleton
// container in `relative` and render <SpiralOverlay/> inside it.

// Small (22KB) spiral so the loader paints instantly even cold (the 512 variant
// is the favicon — fine for the tab, too heavy for a loader).
const SPIRAL = "/auth/spiral.png";

export function SpiralOverlay({ size = "w-9 h-9" }: { size?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
      <img src={SPIRAL} alt="Loading" className={`spiral-rise ${size} drop-shadow-sm`} />
    </div>
  );
}

export default function BrandLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="relative w-full max-w-3xl">
        <div className="space-y-3 opacity-70" aria-hidden="true">
          <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
        </div>
        <SpiralOverlay size="w-11 h-11" />
      </div>
    </div>
  );
}
