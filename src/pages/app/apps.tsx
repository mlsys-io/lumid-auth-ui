import { Link } from 'react-router-dom';
import { FileCode2, Sparkles } from 'lucide-react';

import { UserDashboard } from '@/runmesh/pages/user/UserDashboard';

/**
 * Workflow Builder page at /dashboard.
 *
 * Two authoring modes:
 *   1. n8n canvas — visual DAG editor at /dashboard/n8n (N8nIntegration)
 *   2. YAML       — paste-or-upload at /dashboard/workflow/yaml
 *
 * Below the mode picker is the existing Runmesh UserDashboard — the
 * list of workflows the user has already built. Clicking any row opens
 * the n8n editor on that workflow.
 */
export default function AppApps() {
	return (
		<div>
			<header className="mb-5">
				<h1 className="text-2xl font-semibold text-slate-900">Workflow Builder</h1>
				<p className="mt-1 text-sm text-slate-600">
					Design and edit workflows. Build visually in n8n or paste a
					YAML / JSON definition. Submit any workflow to FlowMesh or
					Lumilake from the Submit pages on the left.
				</p>
			</header>

			<div className="mb-6 grid md:grid-cols-2 gap-3">
				<Link
					to="/dashboard/n8n"
					className="rounded-xl border border-slate-200 bg-white hover:border-indigo-400 hover:shadow-md transition-all p-4 flex items-start gap-3"
				>
					<div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
						<Sparkles className="w-5 h-5 text-indigo-600" />
					</div>
					<div className="min-w-0">
						<div className="text-sm font-semibold text-slate-900">New workflow · n8n</div>
						<div className="mt-0.5 text-xs text-slate-600">
							Visual DAG editor. Drag nodes, wire them, hit save.
						</div>
					</div>
				</Link>
				<Link
					to="/dashboard/workflow/yaml"
					className="rounded-xl border border-slate-200 bg-white hover:border-indigo-400 hover:shadow-md transition-all p-4 flex items-start gap-3"
				>
					<div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
						<FileCode2 className="w-5 h-5 text-amber-600" />
					</div>
					<div className="min-w-0">
						<div className="text-sm font-semibold text-slate-900">New workflow · YAML</div>
						<div className="mt-0.5 text-xs text-slate-600">
							Paste or upload a text definition. For when you prefer
							code to clicks.
						</div>
					</div>
				</Link>
			</div>

			{/* Existing workflow list — UserDashboard owns its internal
			    filters + grid + actions. Negative margins pull it out of
			    the main shell's horizontal padding so the list breathes
			    across the full width; UserDashboard's own p-6 handles
			    inner padding. */}
			<div className="-mx-4 md:-mx-8">
				<UserDashboard />
			</div>
		</div>
	);
}

// Kept so older imports from tasks.tsx / billing.tsx don't break during
// the porting phase. Deprecated; don't use.
export function StubPage({ title, icon, description, cliHint }: {
	title: string;
	icon: React.ReactNode;
	description: string;
	cliHint: string;
}) {
	return (
		<div>
			<div className="flex items-center gap-2 mb-2">
				{icon}
				<h1 className="text-xl font-semibold text-slate-900">{title}</h1>
				<span className="ml-2 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] uppercase tracking-wide text-amber-700">
					porting in progress
				</span>
			</div>
			<p className="text-sm text-slate-600 max-w-xl">{description}</p>
			<div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6">
				<p className="text-sm text-slate-700">
					The Runmesh {title.toLowerCase()} UI is being ported here from <code className="px-1 py-0.5 rounded bg-white border border-slate-200 text-xs">runmesh.ai/app</code>.
					In the meantime, use <code className="px-1 py-0.5 rounded bg-white border border-slate-200 text-xs">{cliHint}</code> from Claude Code, or visit the Runmesh app directly.
				</p>
				<a
					href="https://runmesh.ai/app"
					target="_blank"
					rel="noopener noreferrer"
					className="mt-4 inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700"
				>
					Open runmesh.ai/app →
				</a>
			</div>
		</div>
	);
}
