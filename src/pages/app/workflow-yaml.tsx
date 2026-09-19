import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Code2, Loader2, LayoutGrid, Save, Upload } from 'lucide-react';

import WorkflowEditor from '@/workflow/WorkflowEditor';

import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { createWorkflow } from '@/runmesh/api/user/workflow';

/**
 * YAML-mode Workflow Builder. Counterpart to the n8n canvas at
 * /dashboard/n8n. Lets the user paste or upload a YAML / JSON workflow
 * definition, name it, and save into the same /runmesh/workflows store
 * the rest of the app reads from.
 */
// The old placeholder advertised `apiVersion: lumid/v1` with `spec.stages`,
// which is not a format FlowMesh or Lumilake accepts — FlowMesh's router takes
// only `native` and `n8n`, and Lumilake's native shape is the ops graph below.
const LUMILAKE_PLACEHOLDER = `name: hello-world
inputs:
  Name: ["world"]
outputs:
  - name: reply
    ref: Reply
ops:
  - id: Greeting
    op: FormatOp
    inputs: [Name]
    template: "Hello, {name}!"
    format_kwargs: {name: Name}
  - id: Reply
    op: LLMChatOp
    inputs: [Greeting]
    messages:
      - {role: system, content: "Reply in one short sentence."}
      - {role: user, content: Greeting}
    config: {model: Qwen/Qwen2.5-7B-Instruct, max_tokens: 64, temperature: 0.2}
`;

export default function AppWorkflowYaml() {
	const nav = useNavigate();
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [body, setBody] = useState('');
	const [err, setErr] = useState('');
	// The canvas is the DEFAULT: this route is "new workflow", and landing on a
	// raw textarea with the editor hidden behind a button is how the canvas
	// shipped invisible the first time.
	const [design, setDesign] = useState(true);
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0];
		if (!f) return;
		if (!name) setName(f.name.replace(/\.(ya?ml|json)$/i, ''));
		const reader = new FileReader();
		reader.onload = () => setBody(String(reader.result || ''));
		reader.readAsText(f);
	};

	const onSave = async () => {
		setErr('');
		if (!name.trim()) {
			setErr('Name is required.');
			return;
		}
		if (!body.trim()) {
			setErr('Paste a workflow definition or upload a file.');
			return;
		}
		// Accept YAML or JSON — the backend parses both. We store the raw
		// text as definitionJson (the column is generic, not JSON-enforced).
		setBusy(true);
		try {
			await createWorkflow({
				name: name.trim(),
				description: description.trim() || undefined,
				definitionJson: body,
			});
			nav('/dashboard');
		} catch (e: unknown) {
			setErr(e instanceof Error ? e.message : 'save failed');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="max-w-6xl">
			<header className="mb-5">
				<h1 className="text-2xl font-semibold text-slate-900">New workflow</h1>
				<p className="mt-1 text-sm text-slate-600">
					Lay the workflow out on the canvas, or switch to YAML and write
					it directly — they are the same document. Saved workflows can be
					submitted to Runmesh or Lumilake.
				</p>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Workflow definition</CardTitle>
					<CardDescription>
						Lumilake ops, a FlowMesh spec, or an xpio loop — the dialect is
						read from the document itself. n8n and Dify exports can be
						imported, and are never written back.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div>
						<Label htmlFor="wfname">Name</Label>
						<Input
							id="wfname"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="my-workflow"
						/>
					</div>
					<div>
						<Label htmlFor="wfdesc">Description</Label>
						<Input
							id="wfdesc"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="(optional)"
						/>
					</div>
					<div>
						<div className="flex items-center justify-between mb-1.5">
							<Label htmlFor="wfbody">Definition</Label>
							<input
								type="file"
								accept=".yaml,.yml,.json,text/yaml,application/json"
								ref={fileRef}
								onChange={onFile}
								className="hidden"
							/>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => setDesign((v) => !v)}
									title={design ? 'Edit the YAML directly' : 'Lay this out on a canvas'}
								>
									{design ? <Code2 className="w-3.5 h-3.5 mr-1.5" /> : <LayoutGrid className="w-3.5 h-3.5 mr-1.5" />}
									{design ? 'YAML' : 'Design'}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => fileRef.current?.click()}
								>
									<Upload className="w-3.5 h-3.5 mr-1.5" />
									Upload file
								</Button>
							</div>
						</div>
						{design ? (
							<div className="h-[560px] overflow-hidden rounded-md border border-slate-200">
								<WorkflowEditor value={body || LUMILAKE_PLACEHOLDER} onChange={setBody} />
							</div>
						) : (
							<Textarea
								id="wfbody"
								value={body}
								onChange={(e) => setBody(e.target.value)}
								placeholder={LUMILAKE_PLACEHOLDER}
								rows={18}
								className="font-mono text-xs"
							/>
						)}
					</div>
					{err && <div className="text-xs text-red-600">{err}</div>}
					<div className="flex items-center gap-2">
						<Button onClick={onSave} disabled={busy}>
							{busy ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									saving…
								</>
							) : (
								<>
									<Save className="w-4 h-4 mr-2" />
									Save workflow
								</>
							)}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => nav('/dashboard')}
						>
							Cancel
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
