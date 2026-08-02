// /onboarding/ready — landing pad after domain pick. Polls for the
// first cycle artifact for ~3 minutes, then redirects to /studio/apps
// when it appears. Falls back to /studio/runs if nothing lands by the
// deadline so the user has something to look at.

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Sparkles, ArrowRight } from "lucide-react";
import { me } from "@/api/me";

const POLL_EVERY_MS = 4_000;
const TIMEOUT_MS    = 180_000;

export default function OnboardingReady() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const app  = params.get("app")  ?? "";
  const loop = params.get("loop") ?? "";
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState<"installing" | "waiting" | "done" | "timeout">("installing");

  useEffect(() => {
    const start = Date.now();
    let cancelled = false;
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    const poll = async () => {
      while (!cancelled) {
        try {
          // Poor man's "first artifact" detection: look at apps list +
          // loops health and see if there's a completed cycle for our
          // target loop. The full /me/cycles list lands in P1.
          const apps = await me.listApps();
          const installed = apps.apps.some((a) => a.name === app || a.name.endsWith(`/${app}`));
          if (installed && stage === "installing") setStage("waiting");
        } catch { /* keep trying */ }
        if (Date.now() - start > TIMEOUT_MS) {
          if (!cancelled) setStage("timeout");
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      }
    };
    poll();
    return () => { cancelled = true; clearInterval(tick); };
  }, [app, loop, stage]);

  const goResults = () => navigate("/studio/apps");
  const goLoops   = () => navigate("/studio/runs");

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="max-w-md w-full mx-auto px-6 text-center">
        {stage !== "done" && stage !== "timeout" && (
          <>
            <div className="inline-flex p-3 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg mb-6">
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {stage === "installing" ? "Setting things up…" : "Running your first cycle…"}
            </h1>
            <p className="text-sm text-slate-600 mt-3">
              {stage === "installing"
                ? `Installing ${app || "your agent"}. This takes a moment.`
                : `${app}/${loop} is running its first observe → hypothesize → act → analyze → learn cycle. Usually 1–3 minutes.`}
            </p>
            <p className="text-xs text-slate-400 mt-6 tabular-nums">{elapsed}s elapsed</p>
            <button
              onClick={goLoops}
              className="mt-6 text-sm text-indigo-600 hover:underline"
            >
              Skip ahead — open my dashboard
            </button>
          </>
        )}
        {stage === "timeout" && (
          <>
            <div className="inline-flex p-3 rounded-full bg-amber-100 text-amber-700 mb-6">
              <Sparkles className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Still cooking.</h1>
            <p className="text-sm text-slate-600 mt-3">
              Your first cycle is taking longer than usual. It'll appear on My Loops once it lands.
              Don't worry — your account is set up and your loop is scheduled.
            </p>
            <button
              onClick={goResults}
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
            >
              Open my dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
