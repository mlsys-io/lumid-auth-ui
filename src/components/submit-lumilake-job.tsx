import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Send, Upload, X } from 'lucide-react';

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

	type InputRow = { name: string; queries: string };
	type OutputType = 's3' | 'db';

	const [workflowJson, setWorkflowJson] = useState('');
	const [fileName, setFileName] = useState('');
	const [runName, setRunName] = useState('');
	const [inputRows, setInputRows] = useState<InputRow[]>([{ name: '', queries: '' }]);
	const [outputType, setOutputType] = useState<OutputType>('s3');
	const [outputPrefix, setOutputPrefix] = useState('');
	const [outputTable, setOutputTable] = useState('');
	const [outputColumn, setOutputColumn] = useState('');
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

	// Build the {name: [queries...]} object that lumilake expects.
	// Empty-name rows are skipped (so trailing blank rows are harmless).
	// Comma is the separator; whitespace around each value is trimmed.
	const builtInputs = useMemo(() => {
		const obj: Record<string, string[]> = {};
		let dupName = '';
		for (const row of inputRows) {
			const name = row.name.trim();
			if (!name) continue;
			if (name in obj) {
				dupName = name;
				break;
			}
			const values = row.queries
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			if (values.length === 0) {
				return { ok: false as const, error: `Input "${name}" has no values.` };
			}
			obj[name] = values;
		}
		if (dupName) return { ok: false as const, error: `Duplicate input name "${dupName}".` };
		return { ok: true as const, value: obj };
	}, [inputRows]);

	const builtOutput = useMemo(() => {
		if (outputType === 's3') {
			const prefix = outputPrefix.trim();
			if (!prefix) return { ok: false as const, error: 'Output prefix is required for s3.' };
			return { ok: true as const, value: { type: 's3', prefix } };
		}
		const table = outputTable.trim();
		const column = outputColumn.trim();
		if (!table || !column) {
			return { ok: false as const, error: 'Output table and column are required for db.' };
		}
		return { ok: true as const, value: { type: 'db', table, column } };
	}, [outputType, outputPrefix, outputTable, outputColumn]);

	const addInputRow = () => setInputRows((rows) => [...rows, { name: '', queries: '' }]);
	const updateInputRow = (i: number, patch: Partial<InputRow>) =>
		setInputRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
	const removeInputRow = (i: number) =>
		setInputRows((rows) => (rows.length === 1 ? [{ name: '', queries: '' }] : rows.filter((_, idx) => idx !== i)));

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
		if (!builtInputs.ok) {
			setErr(builtInputs.error);
			return;
		}
		if (Object.keys(builtInputs.value).length === 0) {
			setErr('Add at least one input row.');
			return;
		}
		if (!builtOutput.ok) {
			setErr(builtOutput.error);
			return;
		}

		setBusy(true);
		try {
			await RunningJobService.submitJob(
				{
					data: [
						{
							workflow: workflowJson,
							inputs: builtInputs.value,
							output_location: builtOutput.value,
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
							<div className="mt-2 text-xs text-gold-700">
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
						<div className="flex items-center justify-between mb-1">
							<Label>Inputs</Label>
							<button
								type="button"
								onClick={addInputRow}
								className="text-xs text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
							>
								<Plus className="w-3 h-3" />
								Add input
							</button>
						</div>
						<div className="space-y-2">
							{inputRows.map((row, i) => (
								<div key={i} className="flex items-center gap-2">
									<Input
										value={row.name}
										onChange={(e) => updateInputRow(i, { name: e.target.value })}
										placeholder="Name (e.g. Stock)"
										className="w-1/3 text-xs"
									/>
									<Input
										value={row.queries}
										onChange={(e) => updateInputRow(i, { queries: e.target.value })}
										placeholder="value1, value2, value3"
										className="flex-1 text-xs"
									/>
									<button
										type="button"
										onClick={() => removeInputRow(i)}
										className="text-slate-400 hover:text-red-600 p-1"
										aria-label="Remove input row"
									>
										<X className="w-4 h-4" />
									</button>
								</div>
							))}
						</div>
						<p className="mt-1 text-[11px] text-slate-500">
							Comma-separated values per input. Matches <code>--input Name=v1,v2</code> on the CLI.
						</p>
					</div>
					<div>
						<Label htmlFor="outputType">Output location</Label>
						<Select
							value={outputType}
							onValueChange={(v: OutputType) => setOutputType(v)}
						>
							<SelectTrigger id="outputType">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="s3">s3 (object storage)</SelectItem>
								<SelectItem value="db">db (lakehouse table)</SelectItem>
							</SelectContent>
						</Select>
						{outputType === 's3' ? (
							<Input
								value={outputPrefix}
								onChange={(e) => setOutputPrefix(e.target.value)}
								placeholder="e.g. runs/news-pltr-meta-nflx"
								className="mt-2 text-xs"
							/>
						) : (
							<div className="mt-2 flex gap-2">
								<Input
									value={outputTable}
									onChange={(e) => setOutputTable(e.target.value)}
									placeholder="table"
									className="text-xs"
								/>
								<Input
									value={outputColumn}
									onChange={(e) => setOutputColumn(e.target.value)}
									placeholder="column"
									className="text-xs"
								/>
							</div>
						)}
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
