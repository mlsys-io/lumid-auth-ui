// /studio/today — Phase S1 home + Phase S5 onboarding nudge.
//
// Renders the AppLoops content inside the Studio shell. For brand-
// new users (no apps installed yet) prepends a welcome card that
// bridges to the composer — closes the "fresh signup lands on empty
// page" gap from the audit (finding #7).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import AppLoops from '../app-revamp/loops';
import { me } from '@/api/me';
import PageHints from '@/components/PageHints';

export default function StudioToday() {
	const [empty, setEmpty] = useState<boolean | null>(null);
	useEffect(() => {
		me.listApps()
			.then((r) => {
				const tenantApps = (r.apps || []).filter((a: any) => a.tenant);
				setEmpty(tenantApps.length === 0);
			})
			.catch(() => setEmpty(false));
	}, []);
	return (
		<div className="space-y-6">
			{empty === true && <OnboardingNudge />}
			{empty === false && (
				<PageHints prompts={[
					"what's pending right now?",
					'summarize what my AI did today',
					'run my morning brief now',
				]} />
			)}
			<AppLoops />
		</div>
	);
}

function OnboardingNudge() {
	return (
		<div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6">
			<div className="flex items-start gap-4">
				<div className="w-12 h-12 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
					<Sparkles className="w-6 h-6" />
				</div>
				<div className="flex-1 min-w-0">
					<h2 className="text-lg font-semibold text-slate-900">Welcome to Lumid Studio</h2>
					<p className="mt-1 text-sm text-slate-700 leading-relaxed">
						Set up your AI by telling us what you want it to do — we&apos;ll
						suggest the right skills + knowledge, you&apos;ll connect what&apos;s
						needed, and it starts working for you.
					</p>
					<div className="mt-4">
						<Link
							to="/studio/skills"
							className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
						>
							Set up your AI <ArrowRight className="w-4 h-4" />
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}
