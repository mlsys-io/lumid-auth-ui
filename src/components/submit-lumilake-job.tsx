import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Send, Upload } from 'lucide-react';

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

import { RunningJobService } from '@/lumilake/services/runningJobService';

interface Props {
	title?: string;
	onSuccessPath?: string;
}

/**
 * Lumilake submit — upload or paste an n8n workflow JSON, then send it
 * inline to /api/v1/jobs with `Workflow-Format: n8n`. Mirrors the shape
 * of `lumilake job submit` (see lumilake_cli/commands/job.py).
 *
 * The Runmesh workflow library is not consulted here on purpose: Lumilake
 * needs the n8n graph itself, not a Runmesh workflow id. Users who want
 * to pick from a library should use the n8n editor + export, then paste.
 */
export function SubmitLumilakeJob({ title, onSuccessPath }: Props) {
	const nav = useNavigate();
	const fileRef = useRef<HTMLInputElement>(null);

	const [workflowJson, setWorkflowJson] = useState('');
	const [fileName, setFileName] = useState('');
	const [runName, setRunName] = useState('');
	const [inputsJson, setInputsJson] = useState('{}');
	const [outputJson, setOutputJson] = useState('{"type": "db"}');
	const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState('');

	const parsedWorkflow = useMemo(() => {
		if (!workflowJson.trim()) return { ok: false as const, reason: 'empty' };
		try {
			const parsed = JSON.parse(workflowJson);
			if (!parsed || typeof parsed !== 'object' || !parsed.nodes || !parsed.connections) {
				return { ok: false as const, reason: 'shape' };
			}
			return { ok: true as const, value: parsed };
		} catch {
			return { ok: false as const, reason: 'json' };
		}
	}, [workflowJson]);

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

	const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setFileName(file.name);
		const reader = new FileReader();
		reader.onload = (ev) => {
			const text = (ev.target?.result as string) ?? '';
			setWorkflowJson(text);
			if (!runName) {
				const stem = file.name.replace(/\.json$/i, '');
				const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
				setRunName(`${stem} · ${stamp}`);
			}
		};
		reader.readAsText(file);
	};

	const onSubmit = async () => {
		setErr('');
		if (!parsedWorkflow.ok) {
			if (parsedWorkflow.reason === 'empty') {
				setErr('Paste or upload an n8n workflow JSON first.');
			} else if (parsedWorkflow.reason === 'json') {
				setErr('Workflow is not valid JSON.');
			} else {
				setErr(
					'Workflow JSON is missing `nodes` or `connections`. Export from the n8n editor (top-right menu → Download), not a workload definition file.',
				);
			}
			return;
		}
		if (!runName.trim()) {
			setErr('Run name is required.');
			return;
		}
		if (parsedInputs === null) {
			setErr('Inputs field is not valid JSON.');
			return;
		}
		if (parsedOutput === null) {
			setErr('Output location is not valid JSON.');
			return;
		}

		setBusy(true);
		try {
			await RunningJobService.submitJob(
				{
					data: [
						{
							workflow: workflowJson,
							inputs: parsedInputs,
							output_location: parsedOutput,
							input_batch_size: 1,
							name: runName.trim(),
						},
					],
					priority,
				},
				'n8n',
			);
			nav(onSuccessPath || '/dashboard/jobs/lumilake');
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'submission failed';
			setErr(msg);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="grid lg:grid-cols-[1fr_28rem] gap-6">
			{/* Workflow JSON */}
			<div>
				<div className="mb-3 text-sm text-slate-600">
					Paste an n8n workflow export, or upload the JSON file. Inputs and
					output location follow the same shape as <code className="text-xs">lumilake job submit</code>.
				</div>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
						<div>
							<CardTitle className="text-base">Workflow (n8n JSON)</CardTitle>
							<CardDescription>
								{fileName ? `from ${fileName}` : 'paste below or browse for a .json file'}
							</CardDescription>
						</div>
						<div>
							<input
								ref={fileRef}
								type="file"
								accept=".json,application/json"
								className="hidden"
								onChange={onFileChange}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => fileRef.current?.click()}
							>
								<Upload className="w-3.5 h-3.5 mr-1.5" />
								Upload
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						<Textarea
							value={workflowJson}
							onChange={(e) => {
								setWorkflowJson(e.target.value);
								if (fileName) setFileName('');
							}}
							rows={20}
							placeholder='{"nodes": [...], "connections": {...}, "pinData": {}, "meta": {...}}'
							className="font-mono text-xs"
							spellCheck={false}
						/>
						{workflowJson.trim() && !parsedWorkflow.ok && (
							<div className="mt-2 text-xs text-amber-700">
								{parsedWorkflow.reason === 'json'
									? 'Not valid JSON yet.'
									: 'Missing `nodes` / `connections` — this looks like a workload definition, not an n8n workflow.'}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Configure + submit */}
			<Card>
				<CardHeader>
					<CardTitle>{title || 'Submit to Lumilake'}</CardTitle>
					<CardDescription>
						Runs the workflow as a Lumilake analytics job.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div>
						<Label htmlFor="runName">Run name</Label>
						<Input
							id="runName"
							value={runName}
							onChange={(e) => setRunName(e.target.value)}
							placeholder="auto-fills from filename · timestamp"
						/>
					</div>
					<div>
						<Label htmlFor="inputs">Inputs (JSON)</Label>
						<Textarea
							id="inputs"
							rows={4}
							value={inputsJson}
							onChange={(e) => setInputsJson(e.target.value)}
							placeholder='{"Stock": ["PLTR", "META", "NFLX"]}'
							className="font-mono text-xs"
						/>
					</div>
					<div>
						<Label htmlFor="output">Output location (JSON)</Label>
						<Textarea
							id="output"
							rows={3}
							value={outputJson}
							onChange={(e) => setOutputJson(e.target.value)}
							placeholder='{"type": "s3", "prefix": "runs/my-output"}'
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
						disabled={busy || !parsedWorkflow.ok}
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
