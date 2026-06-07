// Route component for an app-defined UI surface: /studio/a/:app[/:surface]
//
// Fetches the app's declared surface from me.appUI(). If the response carries
// a `native` key, render the registered first-party component; otherwise
// render the runtime-loaded Markdown body via <LumidMarkdown>.

import { Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { me, type MeAppSurface } from "@/api/me";
import { LumidMarkdown } from "./LumidMarkdown";
import { resolveNativeSurface } from "./native-registry";

export function AppSurface() {
  const { app = "", surface } = useParams();
  const [state, setState] = useState<{ data?: MeAppSurface; loading: boolean; error?: string }>(
    { loading: true },
  );

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    me.appUI(app, surface)
      .then((data) => { if (live) setState({ data, loading: false }); })
      .catch((e) => { if (live) setState({ loading: false, error: String(e?.message ?? e) }); });
    return () => { live = false; };
  }, [app, surface]);

  if (state.loading) {
    return <div className="p-8 text-sm text-slate-400">Loading {app}…</div>;
  }
  if (state.error || !state.data) {
    return (
      <div className="p-8">
        <div className="text-sm text-rose-600">Couldn't load this app's surface.</div>
        <div className="mt-1 text-xs text-slate-400">{state.error}</div>
      </div>
    );
  }

  const { native, markdown } = state.data;

  if (native) {
    const Native = resolveNativeSurface(native);
    if (!Native) {
      return <div className="p-8 text-sm text-rose-600">Unknown native surface: {native}</div>;
    }
    return (
      <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
        <Native />
      </Suspense>
    );
  }

  return (
    <div className="px-6 py-6">
      <LumidMarkdown source={markdown ?? "_This app declares no surface content._"} />
    </div>
  );
}

export default AppSurface;
