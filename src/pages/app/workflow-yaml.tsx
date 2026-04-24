import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Save, Upload } from 'lucide-react';

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
export default function AppWorkflowYaml() {
	const nav = useNavigate();
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [body, setBody] = useState('');
	const [err, setErr] = useState('');
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
		<div className="max-w-3xl">
			<header className="mb-5">
				<h1 className="text-2xl font-semibold text-slate-900">New workflow — YAML</h1>
				<p className="mt-1 text-sm text-slate-600">
					Paste a YAML (or JSON) workflow definition, or upload a file.
					Saved workflows show up in the Workflow Builder list and can
					be submitted to Runmesh or Lumilake from there.
				</p>
			</header>

			<Card>
				<CardHeader>
					<CardTitle>Workflow definition</CardTitle>
					<CardDescription>
						Plain text. n8n JSON export, Lumid YAML, or any other format
						the backend knows — no shape enforced here.
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
						<Textarea
							id="wfbody"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder={`apiVersion: lumid/v1\nkind: Workflow\nmetadata:\n  name: example\nspec:\n  stages: {}`}
							rows={18}
							className="font-mono text-xs"
						/>
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
