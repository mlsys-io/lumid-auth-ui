// /app/marketplace — native React grid of xp.io apps.
//
// "Install" was originally a tiny indigo pill in the card corner — easy
// to miss, and the verb didn't say what actually happens. This rewrite:
//   - makes the action a full-width primary CTA at the bottom of the card
//   - renames "Install" → "Add to my account" (plain English)
//   - shows a one-line explainer at the top of the page so users know
//     what they're committing to before they click
//   - on success: "✓ Added — open" links to /app/loops so the next action
//     is obvious
//   - card itself: gradient avatar, hover-lift, version + kind chips
//
// Install mechanic (unchanged): POST /me/apps → scheduler clones the
// repo into ~/.tenants/<sub>/.xp/apps/<name>/ and registers its loops.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag, RefreshCw, Search, Check, Loader2, ExternalLink,
  Plus, ArrowRight, Info, AlertCircle, Sparkles,
} from "lucide-react";
import { me, MeApiError, waitForIntent } from "@/api/me";
import { cn } from "@/lib/utils";

interface XpRepo {
  owner_sub?: string;
  owner_name?: string;
  name: string;
  slug?: string;
  summary?: string;
  kind?: string;
  version?: string;
  stars?: number;
  visibility?: string;
}

type InstallState = "idle" | "installing" | "done" | "error" | "removing";

function ask(prompt: string) {
  window.dispatchEvent(new CustomEvent("lumid:open-chat", { detail: { prompt } }));
}

export default function AppMarketplace() {
  const [rows, setRows] = useState<XpRepo[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [installedSet, setInstalledSet] = useState<Set<string>>(new Set());
  const [installState, setInstallState] = useState<Map<string, InstallState>>(new Map());
  const [installError, setInstallError] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    me.listApps()
      .then((r) => setInstalledSet(new Set(r.apps.map((a) => a.name))))
      .catch(() => { /* non-fatal */ });
  }, []);

  const search = async () => {
    setError(null);
    try {
      const r = await fetch(`https://xp.io/api/v1/repos/search?kind=app&q=${encodeURIComponent(q)}&limit=50`);
      if (!r.ok) throw new Error(`xpcloud search ${r.status}`);
      const j = await r.json();
      setRows((j.repos ?? j.data?.repos ?? j.items ?? j.data?.items ?? []) as XpRepo[]);
    } catch (e) {
      setError(String(e));
      setRows([]);
    }
  };

  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setOne = <T,>(m: Map<string, T>, k: string, v: T) => {
    const next = new Map(m); next.set(k, v); return next;
  };

  const install = async (repo: XpRepo) => {
    const slug = repo.slug ?? (repo.owner_name ? `${repo.owner_name}/${repo.name}` : repo.name);
    setInstallState((m) => setOne(m, slug, "installing"));
    setInstallError((m) => { const n = new Map(m); n.delete(slug); return n; });
    try {
      const { intent_id } = await me.installApp(slug, "local");
      await waitForIntent(intent_id, { timeoutMs: 90_000 });
      setInstallState((m) => setOne(m, slug, "done"));
      setInstalledSet((s) => new Set(s).add(repo.name));
    } catch (e) {
      const msg = e instanceof MeApiError ? e.message : String(e);
      setInstallState((m) => setOne(m, slug, "error"));
      setInstallError((m) => setOne(m, slug, msg));
    }
  };

  const remove = async (repo: XpRepo) => {
    const slug = repo.slug ?? (repo.owner_name ? `${repo.owner_name}/${repo.name}` : repo.name);
    // Confirm because uninstall stops scheduled loops; the memories
    // survive but the operator should be deliberate.
    const ok = window.confirm(
      `Remove ${repo.name} from your account?\n\n` +
      `Its scheduled loops will stop running. The memories it accumulated stay in your knowledge bank — re-installing later will pick up where it left off.`,
    );
    if (!ok) return;
    setInstallState((m) => setOne(m, slug, "removing"));
    setInstallError((m) => { const n = new Map(m); n.delete(slug); return n; });
    try {
      const { intent_id } = await me.uninstallApp(repo.name);
      await waitForIntent(intent_id, { timeoutMs: 90_000 });
      setInstallState((m) => setOne(m, slug, "idle"));
      setInstalledSet((s) => {
        const n = new Set(s); n.delete(repo.name); return n;
      });
    } catch (e) {
      const msg = e instanceof MeApiError ? e.message : String(e);
      // Reset to done so the user can retry remove.
      setInstallState((m) => setOne(m, slug, "done"));
      setInstallError((m) => setOne(m, slug, msg));
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-700">
          <ShoppingBag className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Marketplace</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Apps and skills from xp.io. Pick one to add to your account.
          </p>
        </div>
      </div>

      {/* ── What "Add" and "Remove" mean. Surfaced once, top of page. ── */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
        <div className="text-xs text-slate-700 leading-relaxed">
          <strong className="font-medium text-slate-900">Add</strong> clones the app into your account and runs it on its schedule.
          <strong className="font-medium text-slate-900"> Remove</strong> stops it — your knowledge bank survives, so re-installing keeps the learning.
          See <Link to="/app/results" className="text-indigo-700 hover:underline">My Results</Link>,
          tune in <Link to="/app/loops" className="text-indigo-700 hover:underline">My Loops</Link>.
          Not sure which to pick?{" "}
          <button
            onClick={() => ask("Help me pick a marketplace app. Ask me what I want automated, then recommend something from the catalog.")}
            className="text-indigo-700 hover:underline font-medium"
          >
            Ask Lumid
          </button>.
        </div>
      </div>

      {/* ── Search ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
            placeholder="Search apps…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          />
        </div>
        <button
          onClick={search}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-sm rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Couldn't load: {error}
        </div>
      )}

      {/* ── Grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows === null && (
          <div className="col-span-full text-sm text-slate-500 text-center py-12">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-400" />
            Loading…
          </div>
        )}
        {rows?.map((r) => {
          const slug = r.slug ?? (r.owner_name ? `${r.owner_name}/${r.name}` : r.name);
          const state = installState.get(slug) ?? (installedSet.has(r.name) ? "done" : "idle");
          const errMsg = installError.get(slug);
          return <MarketplaceCard
            key={slug}
            repo={r}
            slug={slug}
            state={state}
            errMsg={errMsg}
            onInstall={() => install(r)}
            onRemove={() => remove(r)}
          />;
        })}
        {rows?.length === 0 && !error && (
          <div className="col-span-full text-sm text-slate-500 text-center py-12">
            No apps match "{q}". Try a different search.
          </div>
        )}
      </div>
    </div>
  );
}

function MarketplaceCard({
  repo, slug, state, errMsg, onInstall, onRemove,
}: {
  repo: XpRepo;
  slug: string;
  state: InstallState;
  errMsg: string | undefined;
  onInstall: () => void;
  onRemove: () => void;
}) {
  // Same hash-tinted avatar pattern as home.tsx.
  const palette = [
    "from-indigo-500 to-blue-500",
    "from-purple-500 to-pink-500",
    "from-emerald-500 to-teal-500",
    "from-amber-500 to-orange-500",
    "from-rose-500 to-fuchsia-500",
    "from-cyan-500 to-sky-500",
  ];
  let hash = 0;
  for (let i = 0; i < repo.name.length; i++) hash = (hash * 31 + repo.name.charCodeAt(i)) | 0;
  const tint = palette[Math.abs(hash) % palette.length];

  return (
    <div
      className={cn(
        "group rounded-xl border bg-white p-4 flex flex-col shadow-sm transition-all duration-200",
        state === "done"
          ? "border-emerald-200 bg-emerald-50/30"
          : "border-slate-200 hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className={cn(
          "shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br grid place-items-center text-white text-sm font-semibold shadow-inner",
          tint,
        )}>
          {repo.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate" title={repo.name}>{repo.name}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={slug}>
            {repo.owner_name ? `${repo.owner_name}/` : ""}{repo.name}
          </p>
        </div>
        <a
          href={`https://xp.io/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 -mr-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
          title="Open on xp.io"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Summary */}
      <p className="text-xs text-slate-600 mt-3 flex-1 line-clamp-3 leading-relaxed">
        {repo.summary || "No description provided."}
      </p>

      {/* Meta chips */}
      <div className="mt-3 flex items-center gap-1.5 flex-wrap text-[10px]">
        <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 uppercase tracking-wide">
          {repo.kind ?? "app"}
        </span>
        {repo.version && (
          <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-mono">
            v{repo.version}
          </span>
        )}
        {(repo.stars ?? 0) > 0 && (
          <span className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
            ★ {repo.stars}
          </span>
        )}
      </div>

      {/* Helper line above the CTA — what clicking will do. */}
      {state === "idle" && (
        <p className="mt-3 text-[10.5px] text-slate-500 leading-snug">
          <Sparkles className="inline w-2.5 h-2.5 mr-0.5 text-indigo-400" />
          Clones to your account · runs on its schedule · ~30s to first cycle
        </p>
      )}

      {/* Primary CTA */}
      <div className="mt-3 space-y-1.5">
        {state === "done" ? (
          <>
            <Link
              to="/app/loops"
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
            >
              <Check className="w-3.5 h-3.5" />
              Added · Open in My Loops
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={onRemove}
              className="w-full text-[11px] text-slate-500 hover:text-rose-600 hover:underline py-0.5 transition"
              title="Stop running this app and remove its files. Knowledge bank survives."
            >
              Remove from my account
            </button>
          </>
        ) : state === "removing" ? (
          <button
            disabled
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-slate-50 text-slate-500 cursor-wait"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Removing…
          </button>
        ) : state === "installing" ? (
          <button
            disabled
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-slate-50 text-slate-500 cursor-wait"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Setting up… (cloning + first cycle)
          </button>
        ) : state === "error" ? (
          <button
            onClick={onInstall}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 transition"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            Couldn't add · Retry
          </button>
        ) : (
          <button
            onClick={onInstall}
            className={cn(
              "w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg",
              "bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm",
              "hover:shadow-md hover:from-indigo-600 hover:to-purple-700 transition",
            )}
          >
            <Plus className="w-3.5 h-3.5" />
            Add to my account
          </button>
        )}
      </div>

      {errMsg && (
        <p className="text-[11px] text-rose-600 mt-2 leading-snug" title={errMsg}>
          {errMsg}
        </p>
      )}
    </div>
  );
}
