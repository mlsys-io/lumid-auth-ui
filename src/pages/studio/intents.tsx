// /studio/today — fresh-user onboarding hub + returning-user dashboard.
//
// Fresh users (no tenant apps yet) see a streamlined hero:
//   - One clear ask: "What should we set up for you?"
//   - Concrete starter chips — each dispatches a studio:ask event so
//     the chat agent handles compose+install
//   - One quiet escape hatch: "Or browse the marketplace"
//
// Returning users see AppLoops (recent cycles + headlines), with the
// QuickStarters launcher pinned above as the permanent Stage-1 surface.

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import WorkflowComposer from '@/components/WorkflowComposer';
import AppLoops from '../app-revamp/loops';
import { me } from '@/api/me';
import { useAuth } from '@/hooks/useAuth';
import { QuickStarters, FreshUserHero } from '@/components/studio/QuickStarters';

export default function StudioToday() {
	const { user } = useAuth();
	const [empty, setEmpty] = useState<boolean | null>(null);
	const name = useMemo(() => {
		const raw = user?.username || user?.email?.split('@')[0] || '';
		const first = raw.split(/[\s.]+/)[0];
		return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
	}, [user?.username, user?.email]);
	useEffect(() => {
		me.listApps()
			.then((r: any) => {
				const tenantApps = (r.apps || []).filter((a: any) => a.tenant);
				setEmpty(tenantApps.length === 0);
			})
			.catch(() => setEmpty(false));
	}, []);

	// Compose host — the modal opens only on an explicit `?compose=1`
	// deep-link now. It no longer auto-opens when the chat agent finishes a
	// compose_workflow: that build renders inline in the chat (AssemblyCard),
	// not as a popup. See StudioChat's compose_workflow handler.
	const [composerOpen, setComposerOpen] = useState(false);
	const [searchParams, setSearchParams] = useSearchParams();
	useEffect(() => {
		if (searchParams.get('compose') === '1') {
			setComposerOpen(true);
			const sp = new URLSearchParams(searchParams);
			sp.delete('compose');
			setSearchParams(sp, { replace: true });
		}
	}, [searchParams, setSearchParams]);

	return (
		<>
			<WorkflowComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
			{empty === true && <div className="space-y-6"><FreshUserHero name={name} /></div>}
			{empty === false && (
				// Stage 1 — "given an intent, assemble a workflow (from the
				// workspace or AI-generated)" — is the standing, recurring
				// action, not a first-run-only thing. So the quick starters
				// STICK here above the user's existing apps, as a permanent
				// "start a new app" launcher.
				<div className="space-y-6">
					<QuickStarters heading="Start a new app" />
					<AppLoops />
				</div>
			)}
		</>
	);
}
