// In-Studio markdown editor for an installed app's UI surface.
//
// Route: /studio/a/:app/edit[/:surface]
//
// Fetches the current surface via me.appUI(), lets the user edit in a
// split-pane (textarea left, live LumidMarkdown preview right), and saves
// via me.updateAppUI() (PUT /me/apps/:app/ui[/:surface]).
//
// For @fork_of / @shared surfaces, the backend writes a local override and
// patches xpcloud.yaml — the editor shows a banner explaining this before save.
//
// Native surfaces (no markdown path) show an info panel; no editor is shown.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Pencil, Eye, EyeOff, Save, X, AlertTriangle, Info, Sparkles, Loader2 } from "lucide-react";
import { me, MeApiError } from "@/api/me";
import { LumidMarkdown } from "./LumidMarkdown";
import { cn } from "@/lib/utils";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// Client-side mirror of the server's compilePageSpec — page-spec drafts
// preview as the RENDERED page, not raw YAML. Best-effort: a half-typed spec
// returns a parse-error note instead of throwing.
function compileSpecPreview(spec: string): string {
	try {
		const doc = parseYaml(spec) as {
			title?: string; intro?: string;
			sections?: { heading?: string; prose?: string; columns?: number; widgets?: Record<string, unknown>[] }[];
		} | null;
		if (!doc || typeof doc !== "object") return "_Empty spec._";
		let out = "";
		if (doc.title) out += `# ${doc.title}\n\n`;
		if (doc.intro) out += `${doc.intro}\n\n`;
		for (const sec of doc.sections ?? []) {
			if (sec.heading) out += `## ${sec.heading}\n\n`;
			if (sec.prose) out += `${sec.prose}\n\n`;
			const widgets = (sec.widgets ?? []).filter((w) => typeof w?.type === "string");
			if (!widgets.length) continue;
			if ((sec.columns ?? 0) > 1) {
				out += "```lumid:columns\n" + stringifyYaml({ columns: sec.columns, blocks: widgets }) + "```\n\n";
				continue;
			}
			for (const w of widgets) {
				const { type, ...body } = w as { type: string } & Record<string, unknown>;
				out += "```lumid:" + type + "\n" + stringifyYaml(body) + "```\n\n";
			}
		}
		return out.trim() || "_Spec has no sections yet._";
	} catch (e) {
		return `_Spec not parseable yet: ${(e as Error)?.message ?? e}_`;
	}
}

export function AppSurfaceEditor() {
  const { app = "", surface } = useParams<{ app: string; surface?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?generate=1 → AI-generate the page (predefined prompt, kvrun LLM) before
  // showing the editor. Drives the "customize during install" step. Only the
  // default "home" surface is generatable.
  const wantGenerate = searchParams.get("generate") === "1" && !surface;
  // ?back=<path> — where cancel/save returns to. Set by AppSurface's Edit link
  // so a PARAM surface (e.g. competition-detail opened at /competition/28)
  // round-trips to the same URL instead of the bare /a/<app>/<surface> route,
  // which has no param to inject and renders every widget as "waiting".
  // Internal /studio/ paths only — anything else falls back to the bare URL.
  const rawBack = searchParams.get("back") ?? "";
  const backTo = rawBack.startsWith("/studio/") && !rawBack.startsWith("//")
    ? rawBack
    : `/studio/a/${encodeURIComponent(app)}${surface ? "/" + encodeURIComponent(surface) : ""}`;

  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [isTemplate, setIsTemplate] = useState(false); // @fork_of or @shared/<name>
  // Structured page surface: the draft is the raw page.yaml SPEC (the served
  // markdown is compiled output) — saves go up as {spec}, validated by the
  // server-side compiler.
  const [isPageSpec, setIsPageSpec] = useState(false);
  // Optimistic-lock token from the load; sent as base_sha so a stale tab
  // can't silently clobber edits made elsewhere (409 → conflict toast).
  const [baseSha, setBaseSha] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const dirty = original !== null && draft !== original;

  // Load current surface content (or generate it first when wantGenerate).
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(null);

    const loadExisting = () => me.appUI(app, surface)
      .then((data) => {
        if (!live) return;
        if (data.native) {
          setIsNative(true);
          setLoading(false);
          return;
        }
        // Page surfaces: edit the spec, not the compiled markdown.
        const body = data.format === "page" ? (data.spec ?? "") : (data.markdown ?? "");
        setIsPageSpec(data.format === "page");
        setBaseSha(data.sha);
        setOriginal(body);
        setDraft(body);
        if (data.path?.startsWith("@")) setIsTemplate(true);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        // 404 → treat as a new file (will be created on first save).
        if (e instanceof MeApiError && e.ret_code === 1404) {
          setOriginal("");
          setDraft("");
          setLoading(false);
          return;
        }
        setLoadError(String(e?.message ?? e));
        setLoading(false);
      });

    if (wantGenerate) {
      setGenerating(true);
      me.generateAppUI(app)
        .then((res) => {
          if (!live) return;
          const md = res.markdown ?? "";
          setOriginal(md);
          setDraft(md);
          setGenerating(false);
          setLoading(false);
          toast.success("Page generated — tweak it and save, or use as-is.");
        })
        .catch((e) => {
          if (!live) return;
          // Generation failed → fall back to whatever surface exists (or empty).
          setGenerating(false);
          toast.error("Couldn't generate a page: " + String((e as Error)?.message ?? e));
          loadExisting();
        });
      return () => { live = false; };
    }

    loadExisting();
    return () => { live = false; };
  }, [app, surface, wantGenerate]);

  // Warn on browser close/refresh when dirty.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const handleCancel = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    navigate(backTo);
  }, [dirty, navigate, backTo]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await me.updateAppUI(app, surface, isPageSpec
        ? { spec: draft, baseSha }
        : { markdown: draft, baseSha });
      setOriginal(draft);
      setBaseSha(res.sha);
      if (isTemplate) setIsTemplate(false); // now a local override
      toast.success("Surface saved");
      navigate(backTo);
    } catch (e) {
      if (e instanceof MeApiError && e.ret_code === 1409) {
        // Someone else saved since this tab loaded — don't clobber them.
        toast.error("This page changed since you opened it (another tab or the Manage panel). Copy your edits, reload, and reapply.", { duration: 10000 });
      } else {
        toast.error("Save failed: " + String((e as Error)?.message ?? e));
      }
    } finally {
      setSaving(false);
    }
  }, [app, surface, draft, isPageSpec, baseSha, isTemplate, navigate, backTo]);

  const handleRegenerate = useCallback(async () => {
    if (dirty && !window.confirm("Regenerating will overwrite your unsaved changes. Continue?")) return;
    setGenerating(true);
    try {
      const res = await me.generateAppUI(app);
      const md = res.markdown ?? "";
      setOriginal(md);
      setDraft(md);
      if (isTemplate) setIsTemplate(false);
      toast.success("Regenerated — review and save");
    } catch (e) {
      toast.error("Regenerate failed: " + String((e as Error)?.message ?? e));
    } finally {
      setGenerating(false);
    }
  }, [app, dirty, isTemplate]);

  const bytes = new Blob([draft]).size;
  const maxBytes = 256 * 1024;

  // ── Loading / error states ──────────────────────────────────────────────

  if (loading) {
    if (generating) {
      // Dismissable — keep a visible exit so generation never feels like a
      // full-screen block. The user can leave to the app at any time.
      return (
        <div className="p-10 flex flex-col items-center justify-center text-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white flex items-center justify-center shadow-sm animate-pulse">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-sm font-medium text-slate-800">Generating your app page…</div>
          <div className="text-xs text-slate-400 max-w-xs">Designing a page for <span className="font-mono">{app}</span> from its config + skills.</div>
          <Link
            to={`/studio/a/${encodeURIComponent(app)}`}
            className="mt-1 text-[12px] text-slate-500 hover:text-slate-800 underline underline-offset-2"
          >
            Cancel and go to the app
          </Link>
        </div>
      );
    }
    return <div className="p-8 text-sm text-slate-400">Loading {app}…</div>;
  }

  if (loadError) {
    return (
      <div className="p-8">
        <div className="text-sm text-rose-600">Couldn't load surface.</div>
        <div className="mt-1 text-xs text-slate-400">{loadError}</div>
      </div>
    );
  }

  // ── Native surface notice ───────────────────────────────────────────────

  if (isNative) {
    return (
      <div className="p-8 max-w-xl">
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <Info className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-slate-700 leading-relaxed">
            <p className="font-medium mb-1">Native surface</p>
            <p>
              This app renders a built-in component. To enable markdown
              customization, add the following to the app's{" "}
              <code className="text-[12px] bg-white border border-slate-200 rounded px-1">xpcloud.yaml</code>:
            </p>
            <pre className="mt-2 text-[12px] bg-white border border-slate-200 rounded p-2 overflow-x-auto">{`ui:
  surface:
    markdown: "ui/home.md"`}</pre>
          </div>
        </div>
        <Link
          to={backTo}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700"
        >
          ← Back to {app}
        </Link>
      </div>
    );
  }

  // ── Full editor ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-white flex-shrink-0">
        <Link
          to={backTo}
          className="text-[12px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
        >
          ← {app}
        </Link>
        <span className="text-slate-300">/</span>
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
          <Pencil className="w-3.5 h-3.5 text-slate-400" />
          {surface || "home"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Preview toggle */}
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors"
            title={showPreview ? "Hide preview" : "Show preview"}
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPreview ? "Hide preview" : "Preview"}
          </button>

          {/* Use as-is — only in the generate/customize flow. The generated
              page is already saved, so this just opens it. */}
          {wantGenerate && (
            <button
              onClick={() => navigate(`/studio/a/${encodeURIComponent(app)}`)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Use as-is →
            </button>
          )}

          {/* Regenerate */}
          {!isNative && (
            <button
              onClick={handleRegenerate}
              disabled={generating}
              title="Regenerate this page with AI"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 text-[12px] text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
            >
              {generating
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                : <><Sparkles className="w-3.5 h-3.5" /> Regenerate</>
              }
            </button>
          )}

          {/* Cancel */}
          <button
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
              dirty && !saving
                ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm shadow-emerald-100"
                : "bg-slate-100 text-slate-400 cursor-not-allowed",
            )}
          >
            {saving
              ? "Saving…"
              : <><Save className="w-3.5 h-3.5" /> Save</>
            }
          </button>
        </div>
      </div>

      {/* Page-spec banner — the textarea holds the structured spec */}
      {isPageSpec && (
        <div className="flex items-start gap-2 px-4 py-2 bg-sky-50 border-b border-sky-200 text-[12px] text-sky-800 flex-shrink-0">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          This is a <strong>structured page spec</strong> (title / intro / sections / widgets in YAML).
          The page is generated from it deterministically — the preview shows the result. Saves are
          validated, so a broken spec can&apos;t ship.
        </div>
      )}

      {/* Fork template banner */}
      {isTemplate && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-800 flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          This surface inherits from a shared template. Saving will create an
          independent copy in this app's <code>ui/home.md</code> and detach it
          from the template.
        </div>
      )}

      {/* Editor body */}
      <div className="flex flex-1 min-h-0">
        {/* Textarea */}
        <div className={cn("flex flex-col min-h-0", showPreview ? "w-1/2 border-r border-slate-200" : "w-full")}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder={`# ${app}\n\nWrite your surface markdown here…\n\n\`\`\`lumid:stat\nsource: me://today\nlabel: Today's runs\n\`\`\``}
            className="flex-1 w-full font-mono text-[13px] leading-relaxed p-4 resize-none border-0 focus:outline-none bg-white text-slate-800 placeholder:text-slate-300"
          />
        </div>

        {/* Live preview — page specs compile client-side first (mirror of the
            server's compilePageSpec) so the preview shows the rendered page,
            not raw YAML. */}
        {showPreview && (
          <div className="w-1/2 overflow-y-auto">
            <div className="px-6 py-4">
              <LumidMarkdown source={(isPageSpec ? compileSpecPreview(draft) : draft) || "_Nothing to preview yet._"} />
            </div>
          </div>
        )}
      </div>

      {/* Footer: byte counter */}
      <div className="flex items-center px-4 py-1.5 border-t border-slate-100 bg-white flex-shrink-0">
        <span className={cn("text-[11px] tabular-nums", bytes > maxBytes * 0.9 ? "text-amber-600" : "text-slate-400")}>
          {draft.length.toLocaleString()} chars · {bytes.toLocaleString()} bytes / 256 KB
        </span>
        {bytes > maxBytes && (
          <span className="ml-2 text-[11px] text-rose-600 font-medium">
            Over limit — save will be rejected
          </span>
        )}
      </div>
    </div>
  );
}

export default AppSurfaceEditor;
