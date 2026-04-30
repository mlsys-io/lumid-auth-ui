import { Suspense, lazy, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

// One Running-jobs surface, replacing the prior FlowMesh / Lumilake
// tab split. Source filter values are URL-driven (?source=...) so
// links and bookmarks survive. Lumilake analytics jobs aren't in the
// dropdown — they live at /dashboard/jobs/lumilake (and the Lumilake
// section in Datasets) since they're a different operator audience.

type Source = 'all' | 'quant' | 'lumid';

const SOURCE_LABELS: Record<Source, string> = {
	all: 'All',
	quant: 'Quant',
	lumid: 'Lumid',
};

const TaskList = lazy(() =>
	import('@/runmesh/pages/user/TaskList').then((m) => ({ default: m.TaskList })),
);
const QuantJobs = lazy(() => import('@/quantarena/pages/flowmesh-jobs'));

function SectionDivider({ label }: { label: string }) {
	return (
		<div className="my-6 flex items-center gap-3">
			<span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
				{label}
			</span>
			<div className="flex-1 h-px bg-slate-200" />
		</div>
	);
}

export default function Jobs() {
	const [params, setParams] = useSearchParams();
	const raw = (params.get('source') || 'all').toLowerCase();
	const source: Source = (['all', 'quant', 'lumid'] as Source[]).includes(raw as Source)
		? (raw as Source)
		: 'all';

	const setSource = (next: Source) => {
		const p = new URLSearchParams(params);
		if (next === 'all') p.delete('source');
		else p.set('source', next);
		setParams(p, { replace: true });
	};

	const showQuant = useMemo(() => source === 'all' || source === 'quant', [source]);
	const showLumid = useMemo(() => source === 'all' || source === 'lumid', [source]);

	return (
		<div>
			<header className="flex items-end justify-between gap-4 mb-5 flex-wrap">
				<div>
					<h1 className="text-2xl font-semibold text-slate-900">Running jobs</h1>
					<p className="text-sm text-slate-500">
						Workflow runs across the Lumid platform — FlowMesh tasks and
						QuantArena trading bots.
					</p>
				</div>
				<label className="inline-flex items-center gap-2 text-sm text-slate-600">
					<span>Source:</span>
					<div className="relative">
						<select
							value={source}
							onChange={(e) => setSource(e.target.value as Source)}
							className="appearance-none border border-slate-300 rounded-md bg-white pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
						>
							{(Object.keys(SOURCE_LABELS) as Source[]).map((s) => (
								<option key={s} value={s}>
									{SOURCE_LABELS[s]}
								</option>
							))}
						</select>
						<ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
					</div>
				</label>
			</header>

			{showQuant && (
				<section>
					{source === 'all' && <SectionDivider label="Quant — trading bots" />}
					<Suspense fallback={<div className="text-sm text-slate-400 py-6">Loading Quant jobs…</div>}>
						<QuantJobs />
					</Suspense>
				</section>
			)}

			{showLumid && (
				<section>
					{source === 'all' && <SectionDivider label="Lumid — FlowMesh tasks" />}
					<Suspense fallback={<div className="text-sm text-slate-400 py-6">Loading Lumid jobs…</div>}>
						<TaskList />
					</Suspense>
				</section>
			)}
		</div>
	);
}
