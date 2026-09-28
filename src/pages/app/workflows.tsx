import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { WorkflowMarket } from '@/runmesh/pages/user/WorkflowMarket';

export default function AppWorkflows() {
	return (
		<div>
			{/* xp.io banner — knowledge+loop marketplace lives there, not here */}
			<div className="mb-6 rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-4">
				<div className="flex items-start gap-3">
					<div className="w-8 h-8 rounded-md bg-white border border-indigo-200 flex items-center justify-center text-lg shrink-0">⟁</div>
					<div className="flex-1 min-w-0">
						<div className="text-sm font-semibold text-slate-900">
							Looking for knowledge + research loops?
						</div>
						<p className="mt-0.5 text-xs text-slate-600">
							xp.io/marketplace lists knowledge agents and auto-research workflow bundles.
						</p>
					</div>
					<a
						href="https://xp.io/marketplace"
						target="_blank"
						rel="noopener noreferrer"
						className="shrink-0 inline-flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-indigo-700 hover:text-indigo-900"
					>
						visit xp.io
						<ExternalLink className="w-3 h-3" />
					</a>
				</div>
			</div>

			{/* The market below lists PUBLISHED workflows only — a workflow you
			    just saved is a private draft and never appears in it. */}
			<div className="mb-6 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
				<div className="text-sm text-slate-700">
					<div className="font-semibold text-slate-900">My workflows</div>
					<div className="text-xs text-slate-500">
						Drafts you saved (private until published) — open to see their state and run them.
					</div>
				</div>
				<Link to="/studio/workflows/mine" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
					Open my workflows →
				</Link>
			</div>

			<WorkflowMarket />
		</div>
	);
}
