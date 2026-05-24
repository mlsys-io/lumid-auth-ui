// /app — succinct, signal-dense home.
//
// Two earlier complaints:
//   1. "too busy" — we'd cut the explore section + dev-signal pills
//   2. "long list but not informative" — the row was just avatar + name +
//      arrow, repeated 26 times because /me/apps returned every install
//      including skill libraries (lumid-claude, lumid-knowledge, …)
//
// Fix: pull from /me/loops/health instead of /me/apps. The health
// endpoint returns only kind=app entries (10 instead of 26) AND carries
// per-app version + sync status, so every row earns its line.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Sparkles, Command, ListChecks, Lightbulb,
  GraduationCap, ShoppingBag,
} from "lucide-react";
import { me, type MeAppHealth } from "@/api/me";
import { cn } from "@/lib/utils";

function ask(prompt: string) {
  window.dispatchEvent(new CustomEvent("lumid:open-chat", { detail: { prompt } }));
}

const CHIPS: { label: string; prompt: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: "What ran today?",        prompt: "Show me a digest of what my loops produced today, with the most interesting result first.", icon: ListChecks },
  { label: "What should I do next?", prompt: "Look at my recent cycles and suggest one concrete next action I should take.",           icon: Lightbulb },
];

export default function AppHome() {
  const [apps, setApps] = useState<MeAppHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    me.loopsHealth()
      .then((r) => setApps(r.apps))
      .catch((e) => setError(String(e)));
  }, []);

  const empty = apps !== null && apps.length === 0;
  const visible = apps ?? [];

  return (
    <div className="space-y-6">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-900/10">
        <div aria-hidden className="absolute -top-16 -right-12 w-64 h-64 rounded-full bg-white/10 blur-3xl" />

        <div className="relative px-6 sm:px-8 py-6 sm:py-7">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            {empty ? "Tell me what to automate." : "Welcome back."}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => ask("")}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/15 backdrop-blur hover:bg-white/25 text-sm font-medium ring-1 ring-white/20 transition"
            >
              <Sparkles className="w-4 h-4" />
              Ask Lumid
              <kbd className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-black/20 ring-1 ring-white/20">
                <Command className="w-3 h-3" />K
              </kbd>
            </button>
            {CHIPS.map(({ label, prompt, icon: Icon }) => (
              <button
                key={label}
                onClick={() => ask(prompt)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur ring-1 ring-white/20 text-sm hover:bg-white/20 transition"
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
            <Link
              to="/onboarding/welcome"
              className="inline-flex items-center gap-1.5 text-xs text-white/80 hover:text-white hover:underline ml-1"
            >
              <GraduationCap className="w-3 h-3" />
              welcome tour
            </Link>
          </div>
        </div>
      </section>

      {error && (
        <div className="text-sm rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">
          {error}
        </div>
      )}

      {/* ── Apps ──────────────────────────────────────────────────────── */}
      {empty && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 text-center">
          <ShoppingBag className="w-6 h-6 text-indigo-600 mx-auto mb-2" />
          <p className="text-sm text-slate-700">Pick something from the marketplace.</p>
          <Link
            to="/app/marketplace"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Browse marketplace <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>
      )}

      {visible.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Your apps · {visible.length}
            </h2>
            <Link to="/app/marketplace" className="text-xs text-indigo-600 hover:underline">
              + add more
            </Link>
          </div>
          <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
            {visible.map((a) => <AppRow key={a.app} app={a} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

// Each row carries: avatar, name, version, sync state. The four together
// answer "is this app a real thing that's working?" in a single glance —
// which is what the old avatar-only row didn't do.
function AppRow({ app }: { app: MeAppHealth }) {
  const palette = [
    "from-indigo-500 to-blue-500",
    "from-purple-500 to-pink-500",
    "from-emerald-500 to-teal-500",
    "from-amber-500 to-orange-500",
    "from-rose-500 to-fuchsia-500",
    "from-cyan-500 to-sky-500",
  ];
  let hash = 0;
  for (let i = 0; i < app.app.length; i++) hash = (hash * 31 + app.app.charCodeAt(i)) | 0;
  const tint = palette[Math.abs(hash) % palette.length];

  // Status semantics (from /admin/loops handler):
  //   in_sync     — local repo matches published xp.io HEAD → ready
  //   unpublished — never pushed to xp.io (local-only or pre-publish)
  //   behind / ahead / dirty — repo drift
  const STATUS: Record<string, { dot: string; label: string }> = {
    in_sync:     { dot: "bg-emerald-500", label: "in sync"     },
    unpublished: { dot: "bg-slate-300",   label: "local only"  },
    behind:      { dot: "bg-amber-500",   label: "behind"      },
    ahead:       { dot: "bg-amber-500",   label: "ahead"       },
    dirty:       { dot: "bg-amber-500",   label: "dirty"       },
  };
  const status = STATUS[app.status] ?? { dot: "bg-slate-300", label: app.status };

  return (
    <li>
      <Link
        to="/app/loops"
        className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition"
        title={`${app.app} v${app.version} — ${status.label}`}
      >
        <div className={cn(
          "shrink-0 w-7 h-7 rounded-md bg-gradient-to-br grid place-items-center text-white text-[11px] font-semibold",
          tint,
        )}>
          {app.app.slice(0, 1).toUpperCase()}
        </div>
        <span className="text-sm text-slate-800 group-hover:text-indigo-700 flex-1 truncate">
          {app.app}
        </span>
        <span className="text-[10px] font-mono text-slate-400 shrink-0">
          v{app.version}
        </span>
        <span className="inline-flex items-center gap-1 shrink-0" title={status.label}>
          <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
        </span>
        <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 transition shrink-0" />
      </Link>
    </li>
  );
}
