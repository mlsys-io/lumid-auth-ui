import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

type Target = 'runmesh';

/**
 * Where a saved workflow stands. Saving never publishes: a new workflow is a
 * private draft, runnable here by its owner, and reaches the marketplace only
 * through review. `publishStatus` codes as the Runmesh owner view uses them
 * (UserDashboard getPublishBadgeMap): 3 draft, 0 in review, 1 published,
 * 2 rejected. Unknown/absent reads as a draft — it is not published.
 */
export function workflowState(publishStatus?: string): { label: string; cls: string; hint: string } {
	switch (publishStatus) {
		case '1':
			return { label: 'Published', cls: 'bg-green-50 text-green-700 border-green-200', hint: 'listed in the workflow marketplace' };
		case '0':
			return { label: 'In review', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', hint: 'submitted for marketplace review; still runnable by you' };
		case '2':
			return { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200', hint: 'marketplace review rejected it; still runnable by you' };
		default:
			return { label: 'Draft', cls: 'bg-blue-50 text-blue-700 border-blue-200', hint: 'private to you; runnable here, not listed in the marketplace' };
	}
}

interface Props {
	target: Target;
	title?: string;
	onSuccessPath?: string;
}

/**
 * Pick-an-existing-workflow + configure-params + submit to Runmesh.
 *
 * Runmesh has no first-party run-now endpoint, so submission is a
 * one-shot schedule (maxExecutions=1, intervalSeconds=1) that the
 * scheduler picks up immediately. The Lumilake target lives in
 * `submit-lumilake-job.tsx` and consumes the n8n JSON directly.
 */
export function SubmitWorkflow({ target, title, onSuccessPath }: Props) {
	const nav = useNavigate();
	const [params] = useSearchParams();
	const wantId = params.get('id') || '';
	const justSaved = params.get('saved') === '1';
	const [workflows, setWorkflows] = useState<WorkflowItem[] | null>(null);
	const [err, setErr] = useState<string>('');

	const [selected, setSelected] = useState<WorkflowItem | null>(null);
	const [runName, setRunName] = useState('');
	const [inputsJson, setInputsJson] = useState('{}');
	const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
	const [busy, setBusy] = useState(false);

	const [loadErr, setLoadErr] = useState<string>('');
	useEffect(() => {
		getWorkflowList({ pageNum: 1, pageSize: 100, onlyMine: true })
			.then((p) => {
				const rows = (p as { rows?: WorkflowItem[]; list?: WorkflowItem[] } | null | undefined);
				const list = rows?.rows || rows?.list || [];
				setWorkflows(list);
				// ?id= — arriving from a save: preselect it so it is visibly THE
				// workflow just saved, not one card among many.
				if (wantId) {
					const hit = list.find((w) => String(w.workflowId || w.id) === wantId);
					if (hit) setSelected(hit);
				}
			})
			.catch((e: unknown) => {
				const msg = e instanceof Error ? e.message : String(e);
				// eslint-disable-next-line no-console
				console.error('[SubmitWorkflow] getWorkflowList failed:', e);
				setLoadErr(msg || 'failed to load workflows');
				setWorkflows([]);
			});
	}, [wantId]);

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
		setBusy(true);
		try {
			await createSchedule({
				workflowId: String(selected.workflowId || selected.id),
				scheduleName: runName || undefined,
				intervalSeconds: 1,
				maxExecutions: 1,
				remark: `one-shot submit · priority=${priority}`,
			});
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
				{justSaved && (
					<div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
						Saved{wantId ? <> as workflow <b>#{wantId}</b></> : null} — a private <b>Draft</b>.
						It is selected below: set inputs and submit to run it.
					</div>
				)}
				<div className="mb-3 text-sm text-slate-600">
					Your saved workflows. Saving never publishes: a new workflow is a
					private <b>Draft</b> you can run from here; it reaches the marketplace
					only after review. These are Runmesh workflows — an app's own loops
					(e.g. Quant Research) are listed in that app's Manage tab instead.{' '}
					<a
						href="/studio/workflows/new"
						className="text-indigo-600 hover:underline"
					>
						New workflow
					</a>
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
								href="/studio/workflows/new"
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
									<div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
										{(() => {
											const st = workflowState(w.publishStatus);
											return (
												<span title={st.hint} className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${st.cls}`}>
													{st.label}
												</span>
											);
										})()}
										<span>#{id}</span>
										<span>· {w.typeName || w.type || 'workflow'}</span>
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
					<CardTitle>{title || 'Submit to FlowMesh'}</CardTitle>
					<CardDescription>
						Fires a one-shot run on the FlowMesh compute backend.
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
