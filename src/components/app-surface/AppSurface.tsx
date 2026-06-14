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
import { createPortal } from "react-dom";
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
import { setStudioSelection } from "@/components/StudioContext";
import { LumidMarkdown } from "./LumidMarkdown";
import { resolveNativeSurface } from "./native-registry";

// Pull a leading "# Title" (+ the first plain paragraph as subtitle) out of
// a surface markdown. When the top-strip slot is available, that header
// renders up there as the page identity — same place every other Studio
// page puts it — instead of re-stating it inside the scroll area.
function splitSurfaceHeader(md: string): { title?: string; subtitle?: string; body: string } {
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (!lines[i]?.startsWith("# ")) return { body: md };
  const title = lines[i].slice(2).trim();
  i++;
  while (i < lines.length && !lines[i].trim()) i++;
  let subtitle: string | undefined;
  const l = lines[i] ?? "";
  // Only a plain prose line qualifies as the subtitle — never a heading,
  // directive fence, list, table, or quote.
  if (l.trim() && !/^(#|```|[-*]\s|\||>)/.test(l.trim())) {
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) { para.push(lines[i].trim()); i++; }
    subtitle = para.join(" ");
  }
  return { title, subtitle, body: lines.slice(i).join("\n") };
}

// Last-seen H1 per app — surfaces without their own H1 (native tabs,
// secondary markdowns) reuse it so the strip identity never blanks out.
const lastSurfaceTitle = new Map<string, string>();

export function AppSurface({
  app: appProp,
  surface: surfaceProp,
  embedded,
}: {
  // When mounted on an explicit route (e.g. the lumid-market competition
  // surfaces), the app + named surface come in as props and the URL's own
  // params (competitionId, strategyId) are forwarded to the markdown for
  // `{token}` injection. When mounted on the generic /studio/a/:app/:surface
  // route, both come from useParams().
  app?: string;
  surface?: string;
  // When rendered inside the app workspace, the AppSwitcher already shows the
  // app name in the top strip — suppress this surface's portaled title to avoid
  // printing the name twice. Standalone /studio/a/* routes keep the title.
  embedded?: boolean;
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

  // Declare the open app surface as the chat's selection — "this app"
  // resolves to the surface's owner even though the /studio/a/:app route
  // isn't one of the observability pages.
  useEffect(() => {
    if (!app) return;
    setStudioSelection({
      kind: "app",
      id: app,
      label: surface ? `${app} · ${surface}` : app,
      affordances: ["app_detail", "run_loop_now", "list_loops", "edit surface"],
    });
    return () => setStudioSelection(null);
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
          // Embedded in the workspace → switch surfaces WITHIN the middle panel
          // (?surface=) so the left nav + right chat stay mounted. Standalone →
          // the dedicated /studio/a/:app/:surface route.
          const to = embedded
            ? `/studio/apps/${encodeURIComponent(app)}?surface=${encodeURIComponent(n.surface)}`
            : `/studio/a/${encodeURIComponent(app)}/${encodeURIComponent(n.surface)}`;
          return (
            <Link
              key={n.surface}
              to={to}
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
  // When the shell's top strip exposes its slot, the whole row portals up
  // there — the strip sat empty on app surfaces while the tabs burned a row.
  const [stripSlot, setStripSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setStripSlot(document.getElementById("topstrip-app-slot"));
  }, []);
  const actionBarInner = (hasMd: boolean, nav?: { surface: string; label?: string }[]) => (
    <>
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
    </>
  );
  const actionBar = (hasMd: boolean, nav?: { surface: string; label?: string }[], title?: string) =>
    stripSlot
      ? createPortal(
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {title && (
              <h1 className="text-[15px] font-semibold text-slate-900 truncate leading-tight flex-shrink min-w-0">{title}</h1>
            )}
            {actionBarInner(hasMd, nav)}
          </div>,
          stripSlot,
        )
      : (
        <div className="flex items-center gap-2 px-6 pt-3 pb-2 border-b border-slate-100 flex-shrink-0">
          {actionBarInner(hasMd, nav)}
        </div>
      );

  // The extracted title is the page identity — remember it per app (other
  // surfaces of the same app may have no H1) and keep the browser tab in
  // sync (runs after TopStatusStrip's route effect, so the richer name wins).
  const extracted = state.data?.markdown ? splitSurfaceHeader(state.data.markdown).title : undefined;
  if (extracted && app) lastSurfaceTitle.set(app, extracted);
  const headerTitle = extracted ?? (app ? lastSurfaceTitle.get(app) : undefined) ?? app;
  // Title goes into the strip only when standalone (not embedded in the workspace).
  const stripTitle = embedded ? undefined : headerTitle;
  useEffect(() => {
    if (stripSlot && headerTitle) document.title = `${headerTitle} · Lumid`;
  }, [stripSlot, headerTitle]);

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
              <Sparkles className="w-4 h-4 text-gold-500" />
              <span className="text-sm font-medium">No page yet for {app}</span>
            </div>
            <p className="mt-1.5 text-[12px] text-slate-500 leading-relaxed">
              Generate one automatically from the app&apos;s config + skills — you can tweak it before saving. Or author it by hand from <strong>Edit</strong>.
            </p>
            <Link
              to={`${editTo}&generate=1`}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg bg-gradient-to-br from-gold-500 to-gold-600 text-white shadow-sm shadow-gold-100 hover:from-gold-600 hover:to-gold-700 transition"
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

  // Header extraction only applies when we can portal it up — without the
  // slot the markdown renders untouched (embedded mounts).
  const header = stripSlot && markdown ? splitSurfaceHeader(markdown) : { body: markdown ?? "" };

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
        {actionBar(!!path, state.data.nav, stripTitle)}
        <div className="px-6 py-2">
          <LumidMarkdown source={header.body} params={surfaceParams} appConfig={state.data.config} wide />
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
        {actionBar(false, state.data.nav, stripTitle)}
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
