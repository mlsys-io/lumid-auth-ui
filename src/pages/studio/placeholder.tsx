// Phase S1 placeholders for the five workspaces that ship their
// real surfaces in S2+. Each renders a labeled empty state with the
// roadmap context — keeps the shell complete and the user oriented.

import { type LucideIcon } from 'lucide-react';

export function StudioPlaceholder({
	icon: Icon,
	title,
	description,
	phase,
	bridgeTo,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	phase: string;
	bridgeTo?: { label: string; href: string };
}) {
	return (
		<div className="max-w-2xl mx-auto pt-12">
			<div className="text-center space-y-4">
				<div className="inline-flex w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 items-center justify-center">
					<Icon className="w-7 h-7" />
				</div>
				<div>
					<h1 className="text-xl font-semibold text-slate-900">{title}</h1>
					<p className="mt-2 text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
						{description}
					</p>
				</div>
				<div className="text-[11px] uppercase tracking-wider text-slate-400">
					{phase}
				</div>
				{bridgeTo && (
					<div className="pt-2">
						<a
							href={bridgeTo.href}
							className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
						>
							{bridgeTo.label}
						</a>
					</div>
				)}
			</div>
		</div>
	);
}

import { Inbox, Wrench, Layers, Brain, Settings, Shield } from 'lucide-react';

export function StudioInbox() {
	return (
		<StudioPlaceholder
			icon={Inbox}
			title="Inbox"
			description="One chronological feed for drafts your AI proposes, invitations, system messages, and the audit trail. Today the drafts live inline on Today; this surface unifies them with everything else that needs your attention."
			phase="Studio Phase S2"
			bridgeTo={{ label: 'See pending drafts on Today', href: '/studio/today' }}
		/>
	);
}

export function StudioSkills() {
	return (
		<StudioPlaceholder
			icon={Wrench}
			title="Skills"
			description="Browse the curated skill catalog, pick what you want your AI to have, and add to a running app. Replaces xp.io/go — same composer, same data, no cross-domain hop. Per-skill detail pages land in Phase S2."
			phase="Studio Phase S2"
			bridgeTo={{ label: 'Open composer (xp.io/go) for now', href: 'https://xp.io/go/' }}
		/>
	);
}

export function StudioApps() {
	return (
		<StudioPlaceholder
			icon={Layers}
			title="Apps"
			description="Your installed apps + inline editor for power users. Edit a loop's schedule, swap skill_imports, tune prompts — all without dropping to the CLI or YAML. The xp.io marketspace keeps the anonymous-browse story."
			phase="Studio Phase S3"
		/>
	);
}

export function StudioKnowledge() {
	return (
		<StudioPlaceholder
			icon={Brain}
			title="Knowledge"
			description="What your AI has learned about you — memories per agent, principles, patterns, with a per-agent sharing toggle. The privacy contract surfaces here cleanly: watcher bank stays local by default; assistant + philosophy banks can be published."
			phase="Studio Phase S3"
		/>
	);
}

export function StudioSettings() {
	return (
		<StudioPlaceholder
			icon={Settings}
			title="Settings"
			description="One page for profile, API tokens, app secrets, OAuth grants, sharing, and billing. Currently scattered across five sub-paths; consolidating in Phase S1.5."
			phase="Studio Phase S1.5"
			bridgeTo={{ label: 'Go to /dashboard/tokens', href: '/dashboard/tokens' }}
		/>
	);
}

export function StudioAdmin() {
	return (
		<StudioPlaceholder
			icon={Shield}
			title="Admin"
			description="Single shell with tabs for Users, Tenants, Clusters, Loops, Audit, Build, and SysResearch. Folds in the three current entry points (/app/admin-*, /dashboard/admin/*, /dashboard/super-admin)."
			phase="Studio Phase S4"
			bridgeTo={{ label: 'Open the existing super-admin dashboard', href: '/dashboard/super-admin' }}
		/>
	);
}
