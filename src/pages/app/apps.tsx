import { UserDashboard } from '@/runmesh/pages/user/UserDashboard';

export default function AppApps() {
	return <UserDashboard />;
}

// Stub helper kept so tasks.tsx / billing.tsx imports don't break during
// phased rollout — will disappear once every page has its real port.
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
