import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Send } from 'lucide-react';

import { Button } from './ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';

import {
	getWorkflowList,
	type WorkflowItem,
} from '@/runmesh/api/user/workflow';
import { createSchedule } from '@/runmesh/api/user/scheduleApi';
import { RunningJobService } from '@/lumilake/services/runningJobService';

type Target = 'runmesh' | 'lumilake';

interface Props {
	target: Target;
	/** The heading shown at the top of the form side. Defaults vary by target. */
	title?: string;
	/** On-success destination; defaults to /dashboard/jobs/<target>. */
	onSuccessPath?: string;
}

/**
 * Pick-an-existing-workflow + configure-params + submit.
 *
 * Shared between `/dashboard/runmesh/submit` (the tab-1 of Runmesh Submit)
 * and `/dashboard/lumilake-submit`. The workflow list comes from the
 * Runmesh workflow store (`getWorkflowList`) for both — one DAG, two
 * execution backends.
 *
 * Submission:
 *   - Runmesh  → `createSchedule({ intervalSeconds: 1, maxExecutions: 1 })`
 *                 (fire-once hack; the backend has no direct run-now RPC yet)
 *   - Lumilake → `RunningJobService.submitJob(...)` with the workflow JSON
 *                 as the payload's `workflow` field.
 */
export function SubmitWorkflow({ target, title, onSuccessPath }: Props) {
	const nav = useNavigate();
	const [workflows, setWorkflows] = useState<WorkflowItem[] | null>(null);
	const [err, setErr] = useState<string>('');

	const [selected, setSelected] = useState<WorkflowItem | null>(null);
	const [runName, setRunName] = useState('');
	const [inputsJson, setInputsJson] = useState('{}');
	const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
	const [outputJson, setOutputJson] = useState('{"type": "db"}');
	const [busy, setBusy] = useState(false);

	const [loadErr, setLoadErr] = useState<string>('');
	useEffect(() => {
		// Match UserDashboard's default filter: user's own workflows only.
		// Mirrors /runmesh/workflows/list?onlyMine=1 — the exact call the
		// Workflow Builder page already uses, so whatever shows up there
		// will show up here.
		getWorkflowList({ pageNum: 1, pageSize: 100, onlyMine: true })
			.then((p) => {
				// Response is `{ rows, total }` after unwrap; some Runmesh
				// endpoints also come back as `{ list }` — accept either.
				const rows = (p as { rows?: WorkflowItem[]; list?: WorkflowItem[] } | null | undefined);
				setWorkflows(rows?.rows || rows?.list || []);
			})
			.catch((e: unknown) => {
				const msg = e instanceof Error ? e.message : String(e);
				// eslint-disable-next-line no-console
				console.error('[SubmitWorkflow] getWorkflowList failed:', e);
				setLoadErr(msg || 'failed to load workflows');
				setWorkflows([]);
			});
	}, []);

	useEffect(() => {
		if (!runName && selected) {
			const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
			setRunName(`${selected.workflowName || selected.name || 'run'} · ${stamp}`);
		}
	}, [selected, runName]);

	const parsedInputs = useMemo(() => {
		if (!inputsJson.trim()) return {};
		try {
			return JSON.parse(inputsJson);
		} catch {
			return null;
		}
	}, [inputsJson]);

	const parsedOutput = useMemo(() => {
		if (!outputJson.trim()) return { type: 'db' };
		try {
			return JSON.parse(outputJson);
		} catch {
			return null;
		}
	}, [outputJson]);

	const onSubmit = async () => {
		setErr('');
		if (!selected) {
			setErr('Pick a workflow first.');
			return;
		}
		if (parsedInputs === null) {
			setErr('Inputs field is not valid JSON.');
			return;
		}
		if (target === 'lumilake' && parsedOutput === null) {
			setErr('Output location is not valid JSON.');
			return;
		}
		setBusy(true);
		try {
			if (target === 'runmesh') {
				// No first-party "run now" endpoint in Runmesh backend yet;
				// a one-shot schedule (maxExecutions=1, intervalSeconds=1)
				// is the closest equivalent that the scheduler will pick up.
				await createSchedule({
					workflowId: String(selected.workflowId || selected.id),
					scheduleName: runName || undefined,
					intervalSeconds: 1,
					maxExecutions: 1,
					remark: `one-shot submit · priority=${priority}`,
				});
			} else {
				// Lumilake submitJob expects the workflow as a stringified JSON
				// blob. We pass the workflow name as a lightweight label — the
				// actual workflow definition is resolved server-side from the
				// selected workflowId.
				await RunningJobService.submitJob(
					{
						data: [
							{
								workflow: String(selected.workflowId || selected.id),
								inputs: parsedInputs,
								output_location: parsedOutput,
								input_batch_size: 1,
								name: runName,
							},
						],
						priority,
					},
					'lumid/v1',
				);
			}
			nav(onSuccessPath || `/dashboard/jobs/${target}`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'submission failed';
			setErr(msg);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="grid lg:grid-cols-[1fr_28rem] gap-6">
			{/* Workflow picker */}
			<div>
				<div className="mb-3 text-sm text-slate-600">
					Pick a workflow you've built. Not sure which one?{' '}
					<a
						href="/dashboard"
						className="text-indigo-600 hover:underline"
					>
						Back to the Workflow Builder
					</a>
					.
				</div>
				{workflows === null ? (
					<div className="py-10 text-center text-sm text-slate-400">loading…</div>
				) : loadErr ? (
					<Card>
						<CardContent className="py-8 text-center">
							<div className="text-sm text-red-600 mb-3">
								Couldn't load workflows: {loadErr}
							</div>
							<div className="text-xs text-slate-500">
								Reload the page or check the browser console for details.
								If this persists, the bearer to runmesh.ai may not have
								refreshed — try signing out and back in.
							</div>
						</CardContent>
					</Card>
				) : workflows.length === 0 ? (
					<Card>
						<CardContent className="py-8 text-center text-sm text-slate-500">
							No workflows yet.{' '}
							<a
								href="/dashboard"
								className="text-indigo-600 hover:underline"
							>
								Build one
							</a>{' '}
							first.
						</CardContent>
					</Card>
				) : (
					<div className="grid sm:grid-cols-2 gap-2">
						{workflows.map((w) => {
							const id = w.workflowId || w.id;
							const isActive = selected && (selected.workflowId || selected.id) === id;
							return (
								<button
									key={id}
									type="button"
									onClick={() => setSelected(w)}
									className={`text-left rounded-lg border p-3 transition-colors ${
										isActive
											? 'border-indigo-500 bg-indigo-50'
											: 'border-slate-200 bg-white hover:border-slate-300'
									}`}
								>
									<div className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
										{isActive && <Check className="w-3.5 h-3.5 text-indigo-600" />}
										{w.workflowName || w.name || `#${id}`}
									</div>
									{w.description && (
										<div className="mt-1 text-xs text-slate-600 line-clamp-2">
											{w.description}
										</div>
									)}
									<div className="mt-1 text-[11px] text-slate-400">
										{w.typeName || w.type || 'workflow'}
									</div>
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* Configure + submit */}
			<Card>
				<CardHeader>
					<CardTitle>
						{title ||
							(target === 'runmesh'
								? 'Submit to FlowMesh'
								: 'Submit to Lumilake')}
					</CardTitle>
					<CardDescription>
						{target === 'runmesh'
							? 'Fires a one-shot run on the FlowMesh compute backend.'
							: 'Runs the workflow as a Lumilake analytics job.'}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div>
						<Label htmlFor="runName">Run name</Label>
						<Input
							id="runName"
							value={runName}
							onChange={(e) => setRunName(e.target.value)}
							placeholder="auto-generated from workflow + timestamp"
						/>
					</div>
					<div>
						<Label htmlFor="inputs">Inputs (JSON)</Label>
						<Textarea
							id="inputs"
							rows={4}
							value={inputsJson}
							onChange={(e) => setInputsJson(e.target.value)}
							className="font-mono text-xs"
						/>
					</div>
					{target === 'lumilake' && (
						<div>
							<Label htmlFor="output">Output location (JSON)</Label>
							<Textarea
								id="output"
								rows={2}
								value={outputJson}
								onChange={(e) => setOutputJson(e.target.value)}
								className="font-mono text-xs"
							/>
						</div>
					)}
					<div>
						<Label htmlFor="priority">Priority</Label>
						<Select
							value={priority}
							onValueChange={(v: 'low' | 'medium' | 'high') => setPriority(v)}
						>
							<SelectTrigger id="priority">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="low">low</SelectItem>
								<SelectItem value="medium">medium</SelectItem>
								<SelectItem value="high">high</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{err && <div className="text-xs text-red-600">{err}</div>}
					<Button
						onClick={onSubmit}
						disabled={busy || !selected}
						className="w-full"
					>
						{busy ? (
							<>
								<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								submitting…
							</>
						) : (
							<>
								<Send className="w-4 h-4 mr-2" />
								Submit
							</>
						)}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
