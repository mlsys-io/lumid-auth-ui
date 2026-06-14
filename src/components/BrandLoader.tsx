// BrandLoader — the canonical waiting indicator. Contextual gray placeholder
// boxes (the shape content will take) with the Lumid spiral mark resting ON
// them, slowly rotating about its axis (the coil "turning"). On-brand and
// in-context — replaces the off-brand spinning ring shown on cold load and
// during the auth check.

export default function BrandLoader() {
  // Small (22KB) spiral so the loader paints instantly even cold/throttled
  // (the 512 variant is the favicon — fine for the tab, too heavy for a loader).
  const spiral = "/auth/spiral.png";
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="relative w-full max-w-3xl">
        <div className="space-y-3 opacity-70" aria-hidden="true">
          <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={spiral} alt="Loading" className="spiral-spin w-11 h-11 drop-shadow-sm" />
        </div>
      </div>
    </div>
  );
}
