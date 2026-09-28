import { SubmitWorkflow } from '@/components/submit-workflow';

export default function AppRunmeshSubmit() {
	return (
		<div className="max-w-6xl">
			<header className="mb-5">
				<h1 className="text-2xl font-semibold text-slate-900">My workflows</h1>
				<p className="mt-1 text-sm text-slate-600">
					Every workflow you have saved, with where it stands (Draft, In review,
					Published, Rejected). Pick one to run it.
				</p>
			</header>
			<SubmitWorkflow target="runmesh" title="Run workflow" onSuccessPath="/studio/runs" />
		</div>
	);
}
