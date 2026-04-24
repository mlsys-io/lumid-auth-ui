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
		// max-w-6xl (72rem ≈ 1152px) caps content so a 1-card grid
		// doesn't float inside a 2000px void on wide monitors. Density
		// matches Vercel / HF dashboards.
		<div className="max-w-6xl">
			<header className="mb-5">
				<h1 className="text-2xl font-semibold text-slate-900">Workflow Builder</h1>
				<p className="mt-1 text-sm text-slate-600">
					Design and edit workflows. Build visually in n8n or paste a
					YAML / JSON definition. Submit any workflow to FlowMesh or
					Lumilake from the Submit pages on the left.
				</p>
			</header>

			{/* New-workflow row — primary CTA (n8n) with a subtle
			    'or paste YAML' alternative beside it. Replaces the
			    two-card picker which was visually heavy. */}
			<div className="mb-6 flex items-center gap-4 flex-wrap">
				<Link
					to="/dashboard/n8n"
					className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
				>
					<Sparkles className="w-4 h-4" />
					New workflow
				</Link>
				<Link
					to="/dashboard/workflow/yaml"
					className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-indigo-600 transition-colors"
				>
					<FileCode2 className="w-4 h-4" />
					or paste YAML
				</Link>
			</div>

			{/* Existing workflow list — UserDashboard owns its internal
			    filters + grid + actions. It now renders inside the shell's
			    padding so cards align with the header above them. */}
			<UserDashboard />
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
