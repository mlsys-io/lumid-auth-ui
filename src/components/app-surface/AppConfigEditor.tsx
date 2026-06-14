// In-Studio YAML config editor for an installed app's xpcloud.yaml.
//
// Route: /studio/a/:app/config
//
// Fetches the current xpcloud.yaml via GET /me/apps/:app/config, lets the
// user edit in a full-width textarea, and saves via PUT /me/apps/:app/config.
// The server validates YAML before writing — a syntax error is surfaced as a
// toast without touching the file.
//
// Key fields (name, version, sidebar, loop count) are parsed and displayed as
// read-only chips above the editor so the user has quick orientation without
// reading the whole file.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Settings, Save, X, AlertTriangle } from "lucide-react";
import { me, MeApiError } from "@/api/me";
import { cn } from "@/lib/utils";

// Lightweight YAML key extractor — avoids a full YAML parser dependency.
// Extracts top-level and one-level-deep string/number values by regex.
function extractYamlField(yaml: string, ...keys: string[]): string {
  for (const key of keys) {
    const m = yaml.match(new RegExp(`^\\s*${key}:\\s*["']?([^\\n"'#]+)["']?`, "m"));
    if (m) return m[1].trim();
  }
  return "";
}

function countYamlListItems(yaml: string, key: string): number {
  // Count list items under a top-level key (lines starting with "  -").
  const start = yaml.indexOf(`\n${key}:`);
  if (start < 0) return 0;
  const block = yaml.slice(start + 1);
  const end = block.search(/\n[a-z]/);
  const region = end >= 0 ? block.slice(0, end) : block;
  return (region.match(/^\s+-/gm) || []).length;
}

interface ConfigChip {
  label: string;
  value: string;
  accent?: string;
}

function parseChips(yaml: string): ConfigChip[] {
  const chips: ConfigChip[] = [];
  const name    = extractYamlField(yaml, "name");
  const version = extractYamlField(yaml, "version");
  const kind    = extractYamlField(yaml, "kind");
  const sidebarLabel   = extractYamlField(yaml, "label");
  const sidebarSection = extractYamlField(yaml, "section");
  const sidebarShow    = extractYamlField(yaml, "show");
  const loops   = countYamlListItems(yaml, "loops");

  if (name)    chips.push({ label: "name",    value: name });
  if (version) chips.push({ label: "version", value: `v${version}` });
  if (kind)    chips.push({ label: "kind",    value: kind });
  if (loops > 0) chips.push({ label: "loops", value: String(loops), accent: "text-amber-700 bg-amber-50 border-amber-200" });
  if (sidebarLabel)   chips.push({ label: "sidebar label",   value: sidebarLabel });
  if (sidebarSection) chips.push({ label: "sidebar section", value: sidebarSection });
  if (sidebarShow === "false") chips.push({ label: "sidebar", value: "hidden", accent: "text-slate-500 bg-slate-50 border-slate-200" });

  return chips;
}

export function AppConfigEditor() {
  const { app = "" } = useParams<{ app: string }>();
  // ?back=<path> — return target for cancel/save (set by AppSurface so a param
  // surface round-trips to its full URL). Internal /studio/ paths only.
  const [searchParams] = useSearchParams();
  const rawBack = searchParams.get("back") ?? "";
  const backTo = rawBack.startsWith("/studio/") && !rawBack.startsWith("//")
    ? rawBack
    : `/studio/a/${encodeURIComponent(app)}`;
  const navigate = useNavigate();

  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft]       = useState<string>("");
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  // Optimistic-lock token — a save based on a stale read 409s instead of
  // silently clobbering edits made elsewhere (Manage panel, another tab).
  const [baseSha, setBaseSha]   = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const dirty = original !== null && draft !== original;
  const chips = draft ? parseChips(draft) : [];

  useEffect(() => {
    let live = true;
    setLoading(true);
    me.appConfig(app)
      .then((data) => {
        if (!live) return;
        setOriginal(data.yaml);
        setDraft(data.yaml);
        setBaseSha(data.sha);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof MeApiError && e.ret_code === 1404) {
          setOriginal("");
          setDraft("# xpcloud.yaml not found for this app\n");
          setLoading(false);
          return;
        }
        setLoadError(String(e?.message ?? e));
        setLoading(false);
      });
    return () => { live = false; };
  }, [app]);

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
      const res = await me.updateAppConfig(app, draft, baseSha);
      setOriginal(draft);
      setBaseSha(res.sha);
      toast.success("Config saved");
      navigate(backTo);
    } catch (e) {
      if (e instanceof MeApiError && e.ret_code === 1409) {
        toast.error("The config changed since you opened it (another tab or the Manage panel). Copy your edits, reload, and reapply.", { duration: 10000 });
      } else {
        // Surface YAML validation errors inline (the server rejects bad YAML).
        toast.error("Save failed: " + String((e as Error)?.message ?? e));
      }
    } finally {
      setSaving(false);
    }
  }, [app, draft, baseSha, navigate, backTo]);

  // (UI generation lives on the page view, not here — xpcloud.yaml is app
  // config, the page is generated/edited from /studio/a/:app.)

  if (loading) return <div className="p-8 text-sm text-slate-400">Loading {app}…</div>;
  if (loadError) {
    return (
      <div className="p-8">
        <div className="text-sm text-rose-600">Couldn't load config.</div>
        <div className="mt-1 text-xs text-slate-400">{loadError}</div>
      </div>
    );
  }

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
          <Settings className="w-3.5 h-3.5 text-slate-400" />
          xpcloud.yaml
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
              dirty && !saving
                ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm shadow-amber-100"
                : "bg-slate-100 text-slate-400 cursor-not-allowed",
            )}
          >
            {saving ? "Saving…" : <><Save className="w-3.5 h-3.5" /> Save</>}
          </button>
        </div>
      </div>

      {/* Parsed field chips */}
      {chips.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5 px-4 py-2 border-b border-slate-100 bg-slate-50/60 flex-shrink-0">
          {chips.map((ch) => (
            <span
              key={ch.label}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border",
                ch.accent ?? "text-slate-600 bg-white border-slate-200",
              )}
            >
              <span className="text-slate-400">{ch.label}</span>
              <span className="font-medium">{ch.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* YAML warning banner */}
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700 flex-shrink-0">
        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
        Editing xpcloud.yaml directly. Invalid YAML will be rejected on save. Changes take effect immediately for UI/sidebar; loop schedule changes require a scheduler restart.
      </div>

      {/* Editor */}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="flex-1 w-full font-mono text-[13px] leading-relaxed p-4 resize-none border-0 focus:outline-none bg-white text-slate-800"
      />

      {/* Footer */}
      <div className="flex items-center px-4 py-1.5 border-t border-slate-100 bg-white flex-shrink-0">
        <span className="text-[11px] text-slate-400 tabular-nums">
          {draft.length.toLocaleString()} chars · {new Blob([draft]).size.toLocaleString()} bytes / 64 KB
        </span>
      </div>
    </div>
  );
}

export default AppConfigEditor;
