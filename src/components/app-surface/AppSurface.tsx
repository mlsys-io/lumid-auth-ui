// Route component for an app-defined UI surface: /studio/a/:app[/:surface]
//
// All app UIs are configured through markdown — there is no native escape
// hatch. A surface is always a markdown file declared in xpcloud.yaml under
// `ui.surface.markdown` or `ui.surfaces.<name>`. Interactive components are
// embedded via `lumid:iframe` directives pointing to same-origin routes.
//
// The chrome row (nav tabs + "⋯" actions menu) is always rendered so any app
// can be edited/managed directly from Studio, including apps with no surface yet.

import { useEffect, useState, Suspense } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MoreHorizontal, Pencil, Settings, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { me, type MeAppSurface, MeApiError } from "@/api/me";
import { LumidMarkdown } from "./LumidMarkdown";
import { resolveNativeSurface } from "./native-registry";

export function AppSurface({
  app: appProp,
  surface: surfaceProp,
}: {
  // When mounted on an explicit route (e.g. the lumid-market competition
  // surfaces), the app + named surface come in as props and the URL's own
  // params (competitionId, strategyId) are forwarded to the markdown for
  // `{token}` injection. When mounted on the generic /studio/a/:app/:surface
  // route, both come from useParams().
  app?: string;
  surface?: string;
} = {}) {
  const routeParams = useParams();
  const app = appProp ?? routeParams.app ?? "";
  const surface = surfaceProp ?? routeParams.surface;
  const navigate = useNavigate();
  const [state, setState] = useState<{
    data?: MeAppSurface;
    loading: boolean;
    error?: string;
    noSurface?: boolean;
  }>({ loading: true });
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    me.appUI(app, surface)
      .then((data) => { if (live) setState({ data, loading: false }); })
      .catch((e) => {
        if (!live) return;
        if (e instanceof MeApiError && e.ret_code === 1404) {
          // No surface yet — show an opt-in empty state. We do NOT auto-
          // generate here: it blocked the whole surface for up to 90s and
          // would clobber a native app's component. Generation is an explicit
          // user action (button → the editor's generate flow).
          setState({ loading: false, noSurface: true });
        } else {
          setState({ loading: false, error: String(e?.message ?? e) });
        }
      });
    return () => { live = false; };
  }, [app, surface]);

  // Thread the CURRENT path through the editors so cancel/save returns here —
  // critical for param surfaces (/competition/28), whose bare /a/<app>/<surface>
  // URL has no param and renders every widget as "waiting for context".
  const location = useLocation();
  const backQ = `?back=${encodeURIComponent(location.pathname)}`;
  const configTo = `/studio/a/${encodeURIComponent(app)}/config${backQ}`;
  const editTo   = `/studio/a/${encodeURIComponent(app)}/edit${surface ? "/" + encodeURIComponent(surface) : ""}${backQ}`;

  const removeApp = async () => {
    if (!window.confirm(`Remove "${app}"? It will be archived (recoverable).`)) return;
    setRemoving(true);
    try {
      await me.uninstallApp(app);
      toast.success(`Removing ${app}…`);
      navigate("/studio/apps");
    } catch (e) {
      toast.error("Remove failed: " + String((e as Error)?.message ?? e));
      setRemoving(false);
    }
  };

  // Surface switcher — a tab bar from xpcloud `ui.nav`, so a multi-surface app's
  // surfaces are pickable from any of them (not just home-page links). Only the
  // app's declared, param-free surfaces appear here.
  const surfaceTabs = (nav?: { surface: string; label?: string }[]) => {
    if (!nav || nav.length === 0) return null;
    const current = surface || "home";
    return (
      <div className="flex flex-wrap gap-1 min-w-0">
        {nav.map((n) => {
          const active = n.surface === current;
          return (
            <Link
              key={n.surface}
              to={`/studio/a/${encodeURIComponent(app)}/${encodeURIComponent(n.surface)}`}
              className={[
                "px-2.5 py-1 rounded-lg text-[12px] transition-colors",
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-100",
              ].join(" ")}
            >
              {n.label || n.surface}
            </Link>
          );
        })}
      </div>
    );
  };

  // Slim chrome row: nav tabs left (when the app declares `ui.nav`), a single
  // "⋯" actions menu right. Edit / Manage / Advanced / Remove live in the menu.
  const actionBar = (hasMd: boolean, nav?: { surface: string; label?: string }[]) => (
    <div className="flex items-center gap-2 px-6 pt-3 pb-2 border-b border-slate-100 flex-shrink-0">
      {surfaceTabs(nav)}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300 shadow-sm transition-all"
            title="App actions"
            aria-label="App actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {hasMd && (
            <DropdownMenuItem asChild>
              <Link to={editTo}>
                <Pencil className="w-3.5 h-3.5" /> Edit this page
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to={`/studio/a/${encodeURIComponent(app)}/manage`} title="name, workflows, skills">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="flex flex-col">
                <span>Manage app</span>
                <span className="text-[11px] text-slate-400">name, workflows, skills</span>
              </span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={configTo}>
              <Settings className="w-3.5 h-3.5" /> Advanced (YAML)
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={removing}
            onSelect={() => removeApp()}
            className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> {removing ? "Removing…" : "Remove app…"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  if (state.loading) {
    return <div className="p-8 text-sm text-slate-400">Loading {app}…</div>;
  }

  if (state.noSurface) {
    return (
      <div className="flex flex-col">
        {actionBar(false)}
        <div className="px-6 py-6 max-w-lg">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 text-slate-800">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-medium">No page yet for {app}</span>
            </div>
            <p className="mt-1.5 text-[12px] text-slate-500 leading-relaxed">
              Generate one automatically from the app&apos;s config + skills — you can tweak it before saving. Or author it by hand from <strong>Edit</strong>.
            </p>
            <Link
              to={`${editTo}&generate=1`}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-100 hover:from-emerald-600 hover:to-teal-700 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate a page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="flex flex-col">
        {actionBar(false)}
        <div className="px-6 py-4">
          <div className="text-sm text-rose-600">Couldn&apos;t load this app&apos;s surface.</div>
          <div className="mt-1 text-xs text-slate-400">{state.error}</div>
        </div>
      </div>
    );
  }

  const { markdown, path, native } = state.data;

  // Prefer markdown when present (even for apps that also declare a native key).
  // The markdown surface is the public harness showcase; the native component
  // handles the authenticated user UX at sub-paths.
  if (markdown && markdown.trim()) {
    // Forward the URL's own params (competitionId, strategyId, …) so directive
    // sources like qa://competition/{competitionId}/leaderboard resolve. The
    // app's xpcloud `config:` is flattened in as `{config.<key>}` tokens —
    // surfaces stay generic templates, per-install values live in Config.
    const surfaceParams = Object.fromEntries(
      Object.entries(routeParams).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
    for (const [k, v] of Object.entries(state.data.config ?? {})) {
      if (["string", "number", "boolean"].includes(typeof v)) surfaceParams[`config.${k}`] = String(v);
    }
    return (
      <div className="flex flex-col">
        {actionBar(!!path, state.data.nav)}
        <div className="px-6 py-2">
          <LumidMarkdown source={markdown} params={surfaceParams} appConfig={state.data.config} wide />
        </div>
      </div>
    );
  }

  // Native surface — render the first-party interactive component (resolved
  // strictly against the compiled allowlist; the server never serves code).
  if (native) {
    const Native = resolveNativeSurface(native);
    return (
      <div className="flex flex-col">
        {actionBar(false, state.data.nav)}
        <div className="px-2 py-2">
          {Native ? (
            <Suspense fallback={<div className="p-8 text-sm text-slate-400">Loading…</div>}>
              <Native config={state.data.config} />
            </Suspense>
          ) : (
            <div className="px-4 text-sm text-rose-600">Unknown native surface: {native}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {actionBar(false)}
      <div className="px-6 py-2">
        <LumidMarkdown source="_This app declares no surface content._" />
      </div>
    </div>
  );
}

export default AppSurface;
