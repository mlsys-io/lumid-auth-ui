// /onboarding/domain — 3 cards (Trading / Daily Life / Research). Click
// installs the domain's default app + triggers an immediate one-shot
// cycle. On success: navigate to /onboarding/ready which polls until
// the first artifact lands.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Sun, FlaskConical, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { me, MeApiError, waitForIntent } from "@/api/me";
import { cn } from "@/lib/utils";

interface DomainCard {
  id: "trading" | "daily" | "research";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  blurb: string;
  // Default app to install for this domain.
  appSlug: string;
  // Loop to one-shot immediately after install.
  firstLoop: { app: string; loop: string };
  needsGoogle?: boolean;
}

const DOMAINS: DomainCard[] = [
  {
    id: "trading",
    icon: TrendingUp,
    title: "Trading",
    blurb: "Auto-research crypto markets, draft trades, watch a daily leaderboard.",
    appSlug: "auto-quant",
    firstLoop: { app: "auto-quant", loop: "crypto_lqa" },
  },
  {
    id: "daily",
    icon: Sun,
    title: "Daily Life",
    blurb: "Morning brief over your email + calendar. A philosopher reflection over coffee.",
    appSlug: "personal-agent",
    firstLoop: { app: "personal-agent", loop: "morning_brief" },
    needsGoogle: true,
  },
  {
    id: "research",
    icon: FlaskConical,
    title: "Research",
    blurb: "Active-learning loop over consulting cases. Sharpens with each cycle.",
    appSlug: "mbb-ai",
    firstLoop: { app: "mbb-ai", loop: "case_cycle" },
  },
];

export default function OnboardingDomain() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (d: DomainCard) => {
    setBusy(d.id);
    setError(null);
    try {
      // 1. Install the app (intent queue → scheduler picks it up).
      const { intent_id } = await me.installApp(d.appSlug, "local");
      await waitForIntent(intent_id, { timeoutMs: 90_000 });

      // 2. Fire a one-shot of the first loop so the user has a real
      //    artifact when they land on /onboarding/ready.
      try {
        await me.runLoopNow(d.firstLoop.app, d.firstLoop.loop);
      } catch {
        // Non-fatal — the next scheduled cycle will fire anyway.
      }

      // 3. If the app needs an external connection (Google for daily),
      //    detour to that flow before /ready. P0 routes through the
      //    existing /dashboard/account/connect/google page.
      if (d.needsGoogle) {
        navigate("/dashboard/account/connect/google?return_to=/onboarding/ready");
        return;
      }
      navigate(`/onboarding/ready?app=${encodeURIComponent(d.appSlug)}&loop=${encodeURIComponent(d.firstLoop.loop)}`);
    } catch (e) {
      setError(e instanceof MeApiError ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-semibold tracking-tight">What do you want Lumid to do for you?</h1>
          <p className="text-slate-600 mt-2">Pick a starting point. You can install more later.</p>
        </div>

        {error && (
          <div className="mb-6 text-sm rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Couldn't set that up: {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {DOMAINS.map((d) => {
            const isBusy = busy === d.id;
            const isLocked = busy !== null && busy !== d.id;
            const Icon = d.icon;
            return (
              <button
                key={d.id}
                disabled={busy !== null}
                onClick={() => pick(d)}
                className={cn(
                  "text-left rounded-lg bg-white border-2 p-5 transition-all",
                  "hover:border-indigo-400 hover:shadow-md",
                  "disabled:cursor-not-allowed",
                  isBusy && "border-indigo-500 shadow-lg",
                  isLocked && "border-slate-200 opacity-40",
                  !isBusy && !isLocked && "border-slate-200",
                )}
              >
                <div className="inline-flex p-2 rounded-md bg-indigo-100 text-indigo-700 mb-3">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-medium">{d.title}</h3>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{d.blurb}</p>
                {d.needsGoogle && (
                  <p className="text-[11px] text-amber-700 mt-2">Connects to Gmail + Calendar</p>
                )}
                <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700">
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Setting up…
                    </>
                  ) : (
                    <>
                      Set me up
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-slate-500 text-center mt-8">
          Or <a
            href={`/app?ask=${encodeURIComponent("Help me set up Lumid for my situation — ask me a few questions about what I want to automate, then install what fits.")}`}
            className="text-indigo-600 hover:underline"
          >
            tell me what you want done in your own words
          </a>{" "}
          — I'll set it up via chat. Or <a href="/app" className="text-slate-600 hover:underline">skip and browse the marketplace</a>.
        </p>
      </div>
    </div>
  );
}
