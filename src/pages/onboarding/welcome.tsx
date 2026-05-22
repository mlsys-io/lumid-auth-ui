// /onboarding/welcome — first thing a new signup sees after OTP. Two
// sentences + a single big button. No nav chrome on purpose; the
// wizard is its own context.

import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";

export default function OnboardingWelcome() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="max-w-lg w-full mx-auto px-6 text-center">
        <div className="inline-flex p-3 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg mb-6">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Lumid.</h1>
        <p className="text-lg text-slate-600 mt-3">
          Pick what you want done. We'll set it up. You'll see your first result in about five minutes.
        </p>
        <button
          onClick={() => navigate("/onboarding/domain")}
          className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 shadow-md"
        >
          Get started
          <ArrowRight className="w-4 h-4" />
        </button>
        <p className="text-xs text-slate-500 mt-6">
          You can always change your mind. We don't lock you in.
        </p>
      </div>
    </div>
  );
}
