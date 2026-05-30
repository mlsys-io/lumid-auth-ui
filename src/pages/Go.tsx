// Phase A1 — composer page.
//
// Lives in lumid_ui so it inherits same-origin auth (lm_session cookie on
// .lum.id is sent without a CORS dance). Routed at "/" when the bundle
// is built with VITE_ROUTER_BASE_PATH=/go (lumid-ui-go → xp.io/go/) and
// also reachable at /go from any lum.id-prefixed bundle. The xp.io
// landing CTA + lum.id hero CTA both point here.
//
// Two columns: Your AI (3 role tiles, live-updates) | Add a skill
// (curated catalog). Sticky footer with Connect + Start. The Start
// button is anonymous-tolerant — if no session, the AuthGuard upstream
// redirects through /auth/login first; composition is preserved in
// sessionStorage so the user lands back on /go with their picks intact.
//
// The "no machinery exposed" rule applies — SkillCard renders only
// name + summary + add/remove. Score, verified chip, kind glyph all
// stay server-side.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SkillCard, type SkillCardData } from "../components/SkillCard";
import { useAuth } from "../hooks/useAuth";
import { me } from "../api/me";

// ── Bootstrap catalog (8 entries, scoped to personal-agent + shared) ─
//
// Phase B6 swaps this for the live catalog endpoint. Until then the
// curation lives here so the funnel works end-to-end without the
// skill-roster crawler. Shape is the contract: {name, display_name,
// summary, tags, category, needs_secrets?, role_hint?}.

type SkillEntry = SkillCardData & {
  category: string;
  needs_secrets?: string[];
  role_hint?: "assistant" | "watcher" | "philosopher";
};

const BOOTSTRAP_CATALOG: SkillEntry[] = [
  {
    name: "gmail-mcp",
    display_name: "Gmail",
    summary: "Read, draft, and send email through your Google account.",
    tags: ["email", "google"],
    category: "email",
    needs_secrets: ["GOOGLE_OAUTH"],
    role_hint: "assistant",
  },
  {
    name: "gcal-mcp",
    display_name: "Google Calendar",
    summary: "Check availability, propose meeting times, book events.",
    tags: ["calendar", "google"],
    category: "calendar",
    needs_secrets: ["GOOGLE_OAUTH"],
    role_hint: "assistant",
  },
  {
    name: "tavily-search",
    display_name: "Tavily Search",
    summary: "Real-time web search for grounded answers.",
    tags: ["web", "search"],
    category: "web",
    needs_secrets: ["TAVILY_API_KEY"],
    role_hint: "assistant",
  },
  {
    name: "fetch",
    display_name: "Fetch URL",
    summary: "Read web pages on demand.",
    tags: ["web"],
    category: "web",
    role_hint: "assistant",
  },
  {
    name: "github-mcp",
    display_name: "GitHub",
    summary: "Read repos, issues, and PRs you have access to.",
    tags: ["code", "git"],
    category: "code",
    needs_secrets: ["GITHUB_TOKEN"],
    role_hint: "assistant",
  },
  {
    name: "slack-mcp",
    display_name: "Slack",
    summary: "Read your DMs and channels; post in your name.",
    tags: ["messaging"],
    category: "messaging",
    needs_secrets: ["SLACK_OAUTH"],
    role_hint: "assistant",
  },
  {
    name: "arxiv-search",
    display_name: "arXiv",
    summary: "Search research papers.",
    tags: ["research", "papers"],
    category: "web",
    role_hint: "philosopher",
  },
  {
    name: "wikipedia",
    display_name: "Wikipedia",
    summary: "Look up facts and background.",
    tags: ["research", "knowledge"],
    category: "web",
    role_hint: "philosopher",
  },
];

const TAG_FILTERS: { label: string; tag: string | null }[] = [
  { label: "All", tag: null },
  { label: "Email", tag: "email" },
  { label: "Calendar", tag: "calendar" },
  { label: "Web", tag: "web" },
  { label: "Code", tag: "code" },
  { label: "Research", tag: "research" },
];

const COMPOSER_STORAGE_KEY = "lumid_go_composition_v1";

const SECRET_LABELS: Record<string, { label: string; flow: "oauth" | "vault" }> = {
  GOOGLE_OAUTH: { label: "Connect Google", flow: "oauth" },
  SLACK_OAUTH: { label: "Connect Slack", flow: "oauth" },
  GITHUB_TOKEN: { label: "Add GitHub token", flow: "vault" },
  TAVILY_API_KEY: { label: "Add Tavily API key", flow: "vault" },
};

// Canonical owner-prefixed slug. xpcloud doesn't currently alias
// "lumid/" → operator UUID; tracked as a follow-up. Using the
// canonical slug avoids the 404 we saw in Phase 0 verification.
const PERSONAL_AGENT_SLUG =
  "a3f48236-ffe9-4fb9-9548-6e044d5cd9c7/personal-agent";

// Catalog endpoint — Phase B6. Same-origin when the bundle is served
// at xp.io/go (no CORS dance); cross-origin from lum.id falls back
// to the bootstrap list if the fetch errors out.
const CATALOG_URL =
  (import.meta.env.VITE_XPIO_BASE as string | undefined) ||
  (typeof window !== "undefined" && window.location.host === "lum.id"
    ? "https://xp.io"
    : "");  // empty → same-origin

async function fetchCatalog(forApp: string, includeUntrusted = false): Promise<SkillEntry[]> {
  const params = new URLSearchParams();
  params.set("for_app", forApp);
  if (includeUntrusted) params.set("include_untrusted", "1");
  const url = `${CATALOG_URL}/api/v1/skills/catalog?${params.toString()}`;
  try {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) return [];
    const data = await r.json();
    const cards = (data?.cards ?? []) as Array<{
      name: string;
      display_name: string;
      summary: string;
      category: string;
      tags?: string[];
      needs_secrets?: string[];
      // W3 — workflow vocabulary fields. Optional on the wire (older
      // xpcloud versions don't emit them yet).
      kind?: string;
      step_count?: number;
    }>;
    return cards.map((c) => ({
      name: c.name,
      display_name: c.display_name,
      summary: c.summary || c.display_name,
      tags: c.tags || [],
      category: c.category || "other",
      needs_secrets: c.needs_secrets,
      kind: c.kind,
      step_count: c.step_count,
      // Crude default: assistant role unless the category screams "watcher" territory.
      role_hint: "assistant" as const,
    }));
  } catch {
    return [];
  }
}

// Phase S3-A — intent → suggested skills + the knowledge they bring.
// Server-side scoring (token + tag match, no LLM cost); upgrade path
// to LLM-ranked is a one-endpoint swap with no UI change.
type Suggestion = {
  name: string;
  display_name: string;
  summary: string;
  category: string;
  needs_secrets?: string[];
  knowledge_paths?: string[];
  score: number;
  matched: string[];
  why: string;
};
async function fetchSuggestions(
  intent: string, forApp: string,
): Promise<Suggestion[]> {
  if (!intent.trim()) return [];
  const url = `${CATALOG_URL}/api/v1/skills/suggest`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, for_app: forApp, max: 6, use_llm: true }),
      credentials: "omit",
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.suggestions ?? []) as Suggestion[];
  } catch {
    return [];
  }
}

// ── Page ───────────────────────────────────────────────────────────

export function Go({ embedded = false }: { embedded?: boolean } = {}) {
  // When `embedded` is true the composer renders WITHOUT its own outer
  // chrome (nav bar, full-page background, fixed-bottom footer). The
  // hosting page is expected to provide them. Studio's /studio/skills
  // page passes embedded=true so the composer slots cleanly inside
  // the studio shell; standalone xp.io/go keeps the full chrome.
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Catalog state. Starts as the bootstrap list; fetchCatalog
  // promotes to live xpcloud data within a few ms. Live result
  // wins; the bootstrap is the failover for offline / 5xx.
  const [catalog, setCatalog] = useState<SkillEntry[]>(BOOTSTRAP_CATALOG);
  // Phase S3-A — intent-driven suggestions. The user types what they
  // want their AI to do; the server returns the skills (and the
  // knowledge they bring along) that fit. Suggestions render as
  // clickable chips above the catalog; clicking adds to selection.
  const [intent, setIntent] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedFor, setSuggestedFor] = useState("");
  // D1 — skill trust gate. Default to verified-only; advanced toggle
  // surfaces the rest. Persists in sessionStorage so the user's
  // preference survives page navigation.
  const [includeUntrusted, setIncludeUntrusted] = useState<boolean>(() => {
    try { return sessionStorage.getItem("studio:composer:include_untrusted") === "1"; } catch { return false; }
  });

  // Rehydrate composition on mount — the user may have round-tripped
  // through /auth/login and we don't want to lose their picks.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(COMPOSER_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setSelected(new Set(arr));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Pull live catalog (defaults to personal-agent lane). Refetches
  // when the trust-gate toggle flips.
  useEffect(() => {
    let cancelled = false;
    fetchCatalog("personal-agent", includeUntrusted).then((live) => {
      if (cancelled) return;
      if (live.length > 0) setCatalog(live);
    });
    return () => {
      cancelled = true;
    };
  }, [includeUntrusted]);

  // Persist the toggle.
  useEffect(() => {
    try { sessionStorage.setItem("studio:composer:include_untrusted", includeUntrusted ? "1" : "0"); } catch { /* ignore */ }
  }, [includeUntrusted]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        COMPOSER_STORAGE_KEY,
        JSON.stringify(Array.from(selected)),
      );
    } catch {
      /* quota / privacy mode — degrade silently */
    }
  }, [selected]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((s) => {
      if (tag && !(s.tags || []).includes(tag)) return false;
      if (!q) return true;
      const hay = [s.name, s.display_name, s.summary, ...(s.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, tag]);

  const requiredSecrets = useMemo(() => {
    const set = new Set<string>();
    for (const s of catalog) {
      if (selected.has(s.name)) {
        for (const k of s.needs_secrets || []) set.add(k);
      }
    }
    return Array.from(set);
  }, [selected, catalog]);

  const roleChips = useMemo(() => {
    const buckets: Record<"assistant" | "watcher" | "philosopher", SkillEntry[]> = {
      assistant: [],
      watcher: [],
      philosopher: [],
    };
    for (const s of catalog) {
      if (!selected.has(s.name)) continue;
      const r = s.role_hint || "assistant";
      buckets[r].push(s);
    }
    return buckets;
  }, [selected, catalog]);

  const start = async () => {
    if (selected.size === 0) return;
    setError(null);

    // Anonymous? Send them through /auth/login with a return path
    // back to this page; composition stays in sessionStorage.
    if (!isAuthenticated) {
      const me = window.location.pathname + window.location.search;
      navigate(`/auth/login?next=${encodeURIComponent(me)}`);
      return;
    }

    setStarting(true);
    try {
      // Install the personal-agent base. Picked skills get persisted in
      // sessionStorage and surface on /app/loops as suggested "add this
      // skill" affordances — once the catalog endpoint + picker
      // skill_imports support land (Phase B), this becomes one POST that
      // carries the picks. For now: clean MVP, install + redirect.
      const { intent_id } = await me.installApp(
        PERSONAL_AGENT_SLUG,
        "cloud",
        "pa",
      );
      // Stash the picks so /app/loops can show "want these added?" hints.
      try {
        sessionStorage.setItem(
          "lumid_go_pending_skills",
          JSON.stringify(Array.from(selected)),
        );
      } catch {
        /* ignore */
      }
      // Studio is the canonical post-install landing. The /app/loops
      // route still works (parallel-run during the Studio S1 cutover
      // window) but new flows land in Studio for visual consistency
      // with the composer the user just used.
      const land = embedded ? "/studio/intents" : "/app/loops";
      navigate(`${land}?installed=pa&intent=${intent_id}`);
    } catch (exc: any) {
      const msg =
        exc?.message ||
        exc?.response?.data?.message ||
        "Couldn't start your AI — try again.";
      setError(msg);
      setStarting(false);
    }
  };

  const openConnect = (key: string) => {
    // Quietly route to lum.id's own connect surfaces. /account/connect/google
    // is the existing Google OAuth wizard; for non-OAuth keys we drop to
    // /account/secrets where /me/apps/:app/secrets/:key already lives.
    const meta = SECRET_LABELS[key];
    if (meta?.flow === "oauth") {
      navigate(`/account/connect/google?then=${encodeURIComponent(window.location.pathname)}`);
    } else {
      navigate(`/account/secrets?need=${encodeURIComponent(key)}&app=pa&then=${encodeURIComponent(window.location.pathname)}`);
    }
  };

  const canStart = selected.size > 0 && !starting && !isLoading;

  const runSuggest = async () => {
    const q = intent.trim();
    if (!q || suggesting) return;
    setSuggesting(true);
    try {
      const sugs = await fetchSuggestions(q, "personal-agent");
      setSuggestions(sugs);
      setSuggestedFor(q);
    } finally {
      setSuggesting(false);
    }
  };

  // Suggested-skill names (used to badge cards + offer "add all").
  const suggestedNames = new Set(suggestions.map((s) => s.name));
  const knowledgeCount = suggestions.reduce(
    (n, s) => n + (s.knowledge_paths?.length || 0),
    0,
  );

  const addAllSuggested = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of suggestions) next.add(s.name);
      return next;
    });
  };

  // Body shared between standalone (Go) and Studio-embedded. The
  // chrome differs (nav bar + bg + fixed footer in standalone; sticky
  // footer inside studio main otherwise).
  const body = (
    <>
      <header className={embedded ? "mb-6" : "mb-8"}>
        <h1 className={embedded ? "text-2xl font-semibold text-slate-900" : "text-3xl font-semibold text-gray-900"}>
          Set up your AI
        </h1>
        <p className={embedded ? "mt-1 text-sm text-slate-600" : "mt-2 text-gray-600"}>
          Tell us what you want, or pick skills directly — your AI will
          come with the skills plus the knowledge each one ships with.
        </p>
      </header>

      {/* Phase S3-A — intent input. Implicitly answers "what skills
          and knowledge would I need?" by ranking the catalog against
          the user's plain-English intent. */}
      <section className="mb-6 rounded-xl border border-emerald-200/60 bg-emerald-50/40 p-4">
        <label className="block text-xs font-semibold text-emerald-800 uppercase tracking-wide mb-2">
          What do you want your AI to do?
        </label>
        <div className="flex items-start gap-2">
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runSuggest();
            }}
            placeholder="e.g. clean up my inbox in the morning, propose meeting times, never miss a follow-up"
            rows={2}
            maxLength={500}
            className="flex-1 px-3 py-2 text-sm rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 resize-none"
          />
          <button
            onClick={runSuggest}
            disabled={!intent.trim() || suggesting}
            className={[
              "px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
              !intent.trim() || suggesting
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-emerald-500 text-white hover:bg-emerald-600",
            ].join(" ")}
          >
            {suggesting ? "…" : "Suggest"}
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                Suggested {suggestions.length} skill{suggestions.length === 1 ? "" : "s"}
                {knowledgeCount > 0 && (
                  <> · {knowledgeCount} knowledge source{knowledgeCount === 1 ? "" : "s"}</>
                )}
                {" "}for <span className="italic">&ldquo;{suggestedFor.slice(0, 50)}{suggestedFor.length > 50 ? "…" : ""}&rdquo;</span>
              </span>
              <button
                onClick={addAllSuggested}
                className="text-emerald-700 hover:text-emerald-900 font-medium"
              >
                Add all
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {suggestions.map((s) => {
                const picked = selected.has(s.name);
                return (
                  <button
                    key={s.name}
                    onClick={() => toggle(s.name)}
                    title={s.why + (s.knowledge_paths?.length ? ` · brings ${s.knowledge_paths.length} doc(s)` : "")}
                    className={[
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors",
                      picked
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-100",
                    ].join(" ")}
                  >
                    <span aria-hidden="true">{picked ? "✓" : "+"}</span>
                    {s.display_name}
                    {(s.knowledge_paths?.length ?? 0) > 0 && (
                      <span className="opacity-60 text-[10px]">·{s.knowledge_paths!.length}📄</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {suggestedFor && suggestions.length === 0 && !suggesting && (
          <div className="mt-3 text-xs text-slate-600 italic">
            No matches yet — try fewer / different keywords, or pick directly from the catalog below.
          </div>
        )}
      </section>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left — "Your AI" preview ────────────────────────────── */}
          <section className="lg:col-span-2 space-y-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Your AI
            </h2>

            <RoleTile
              name="Assistant"
              description="Drafts emails, proposes meetings, summarises your day."
              skills={roleChips.assistant}
            />
            <RoleTile
              name="Watcher"
              description="Quietly learns from how you work so the assistant gets better."
              skills={roleChips.watcher}
              hint="Local-only · requires CLI"
            />
            <RoleTile
              name="Philosopher"
              description="Weekly reflection. Surfaces patterns the assistant should remember."
              skills={roleChips.philosopher}
              hint="Local-only · requires CLI"
            />
          </section>

          {/* Right — Marketplace ──────────────────────────────────── */}
          <section className="lg:col-span-3 space-y-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Add a workflow
            </h2>

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400"
            />

            <div className="flex items-center gap-2 flex-wrap">
              {TAG_FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => setTag(f.tag)}
                  className={[
                    "px-3 py-1 rounded-full text-xs transition-colors",
                    tag === f.tag
                      ? "bg-gray-900 text-white"
                      : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50",
                  ].join(" ")}
                >
                  {f.label}
                </button>
              ))}
              {/* D1 — skill trust gate. Default = verified only. */}
              <label className="ml-auto text-[11px] inline-flex items-center gap-1.5 text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeUntrusted}
                  onChange={(e) => setIncludeUntrusted(e.target.checked)}
                  className="rounded border-gray-300 text-emerald-500 focus:ring-emerald-400/30 w-3 h-3"
                />
                <span>Show unverified</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visible.map((s) => (
                <SkillCard
                  key={s.name}
                  skill={s}
                  selected={selected.has(s.name)}
                  onToggle={() => toggle(s.name)}
                />
              ))}
              {visible.length === 0 && (
                <div className="col-span-full text-sm text-gray-500 italic px-2 py-6 text-center">
                  No skills match — try a different filter.
                </div>
              )}
            </div>
          </section>
        </div>
    </>
  );

  // Footer is the same content either way; positioning differs.
  const footerInner = (
    <div className={embedded ? "flex items-center justify-between gap-4" : "mx-auto max-w-6xl px-8 py-4 flex items-center justify-between gap-4"}>
      <div className="text-sm min-w-0 flex-1">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : selected.size === 0 ? (
          <span className="text-slate-600">Pick at least one skill to start.</span>
        ) : (
          <span className="text-slate-600">
            <strong>{selected.size}</strong> skill{selected.size === 1 ? "" : "s"}
            {requiredSecrets.length > 0 && (
              <> · {requiredSecrets.length} to connect</>
            )}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-end">
        {requiredSecrets.map((k) => {
          const meta = SECRET_LABELS[k] || { label: k, flow: "vault" };
          return (
            <button
              key={k}
              onClick={() => openConnect(k)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              {meta.label}
            </button>
          );
        })}
        <button
          onClick={start}
          disabled={!canStart}
          className={[
            "px-5 py-2 text-sm font-semibold rounded-lg transition-colors",
            canStart
              ? "bg-emerald-500 text-white hover:bg-emerald-600"
              : "bg-slate-200 text-slate-400 cursor-not-allowed",
          ].join(" ")}
        >
          {starting ? "Starting…" : "Start"}
        </button>
      </div>
    </div>
  );

  if (embedded) {
    // Studio shell provides bg + nav + padding. We just render the body
    // and a sticky-bottom footer that hugs the workspace edge.
    return (
      <div className="pb-20 relative">
        {body}
        <footer
          className="sticky bottom-0 -mx-6 px-6 py-3 mt-6 bg-white border-t border-slate-200"
          role="contentinfo"
        >
          {footerInner}
        </footer>
      </div>
    );
  }

  // Standalone — xp.io/go (legacy until Phase S2 cuts xp.io/go over)
  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <nav className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-6xl px-8 py-5 flex items-center justify-between">
          <span className="text-emerald-500 font-display tracking-[0.35em] text-sm">
            <span className="w-1.5 h-1.5 inline-block align-middle rounded-full bg-emerald-500 mr-3" />
            set up your AI
          </span>
          {!isAuthenticated && !isLoading && (
            <a
              href="/auth/login"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Sign in
            </a>
          )}
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-8 py-10">
        {body}
      </main>

      <footer
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-1px_2px_rgba(0,0,0,0.03)]"
        role="contentinfo"
      >
        {footerInner}
      </footer>
    </div>
  );
}

// ── Role tile ──────────────────────────────────────────────────────

function RoleTile({
  name,
  description,
  skills,
  hint,
}: {
  name: string;
  description: string;
  skills: SkillEntry[];
  hint?: string;
}) {
  return (
    <div className="p-4 rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{name}</h3>
        {hint && (
          <span className="text-[10px] uppercase tracking-wide text-gray-400">
            {hint}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-600 leading-relaxed">{description}</p>
      {skills.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {skills.map((s) => (
            <span
              key={s.name}
              className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-300/40"
            >
              {s.display_name || s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default Go;
