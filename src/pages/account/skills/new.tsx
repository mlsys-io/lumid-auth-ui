import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { toast } from 'sonner';
import { Copy, Check, Sparkles, AlertTriangle, ArrowLeft, X } from 'lucide-react';
import {
	generateSkillDraftCommand,
	isValidAppSlug,
	isValidSkillId,
	type SkillKind,
} from '../../../api/draft-bundle';

/**
 * /account/skills/new — A4 skill authoring form.
 *
 * The web UI doesn't write drafts directly. This form generates a
 * one-shot `lumid skill_draft …` command the user copies and runs
 * locally; the CLI puts the draft under
 * ~/.xp/apps/<app>/.drafts/<id>/, which is also where the AI
 * auto-loop and the cycle's manifest patcher pick it up.
 *
 * Three operational modes (per Theme A2 approval-gate policy):
 *   - Cold-start: human fills this form blank → confidence=1.0 →
 *     applies immediately when the user runs `lumid skill_apply`.
 *   - Review of AI-staged draft: prefilled via URL params the
 *     auto-loop (Theme A1) writes to the user's inbox.
 *   - Direct override: human edits an existing skill — same form.
 *
 * Pre-fill via URL: ?app=mbb-ai&role=analyst&skill_id=… so a
 * validator gap or an insights candidate can deep-link here with
 * sensible defaults. Matches the PAT-mint pattern in spirit.
 */

const KIND_OPTIONS: { value: SkillKind; label: string; hint: string }[] = [
	{ value: 'prompt', label: 'Prompt card (markdown)', hint: 'Single .md file the analyst/judge reads as a system-prompt fragment.' },
	{ value: 'skill_md', label: 'BAB SKILL.md (8-field)', hint: 'Structured 8-field SKILL.md card — name/version/when_to_use/inputs/outputs/steps/anti_patterns/linked_assets. Lints automatically.' },
	{ value: 'python', label: 'Python module (skill.py)', hint: 'Imperative skill module with run(**kwargs). Use for compute, not prompts.' },
];

const COMMON_ROLES = ['analyst', 'judge', 'shared', 'trader', 'operator'];

export default function SkillsNewPage() {
	const [params] = useSearchParams();
	const [app, setApp] = useState(params.get('app') ?? 'mbb-ai');
	const [role, setRole] = useState(params.get('role') ?? 'analyst');
	const [skillId, setSkillId] = useState(params.get('skill_id') ?? '');
	const [kind, setKind] = useState<SkillKind>(
		(params.get('kind') as SkillKind) || 'prompt',
	);
	const [triggers, setTriggers] = useState<string[]>(
		params.get('triggers')?.split(',').filter(Boolean) ?? [],
	);
	const [triggerInput, setTriggerInput] = useState('');
	const [targetLoops, setTargetLoops] = useState<string[]>(
		params.get('target_loops')?.split(',').filter(Boolean) ?? [],
	);
	const [loopInput, setLoopInput] = useState('');
	const [promptBody, setPromptBody] = useState(params.get('prompt_body') ?? '');
	const [notes, setNotes] = useState(params.get('notes') ?? '');
	const [copied, setCopied] = useState(false);

	const validation = useMemo(() => {
		const errors: string[] = [];
		if (!app) errors.push('app is required');
		else if (!isValidAppSlug(app))
			errors.push('app must be lowercase a-z, 0-9, hyphen (e.g. "mbb-ai")');
		if (!role) errors.push('role is required');
		if (!skillId) errors.push('skill_id is required');
		else if (!isValidSkillId(skillId))
			errors.push(
				'skill_id must be snake_case: a-z, 0-9, underscore (e.g. "revenue_brainstorm")',
			);
		if (kind === 'prompt' && !promptBody.trim())
			errors.push('prompt body is empty (you can submit a stub but the cycle will warn)');
		return errors;
	}, [app, role, skillId, kind, promptBody]);

	const blocking = validation.filter((e) => !e.includes('empty'));
	const warnings = validation.filter((e) => e.includes('empty'));

	const command = useMemo(
		() =>
			generateSkillDraftCommand({
				app,
				role,
				skill_id: skillId,
				triggers,
				prompt_body: promptBody,
				target_loops: targetLoops,
				kind,
				notes,
			}),
		[app, role, skillId, triggers, promptBody, targetLoops, kind, notes],
	);

	const copyCommand = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			toast.success('Command copied — paste into your terminal');
			setTimeout(() => setCopied(false), 2_000);
		} catch (e) {
			toast.error(`Copy failed: ${String(e)}`);
		}
	};

	const addToken = (
		v: string,
		setList: (l: string[]) => void,
		list: string[],
		setInput: (s: string) => void,
	) => {
		const t = v.trim();
		if (!t) return;
		if (list.includes(t)) {
			setInput('');
			return;
		}
		setList([...list, t]);
		setInput('');
	};

	const removeToken = (i: number, list: string[], setList: (l: string[]) => void) => {
		setList(list.filter((_, idx) => idx !== i));
	};

	return (
		<div className="max-w-4xl mx-auto p-6 space-y-5">
			<div className="flex items-start justify-between">
				<div>
					<div className="text-xs text-muted-foreground mb-1">
						<Link to="/dashboard/inbox" className="hover:underline">
							<ArrowLeft className="inline w-3 h-3 mr-0.5" /> Inbox
						</Link>
					</div>
					<h1 className="text-2xl font-bold flex items-center gap-2">
						<Sparkles className="w-5 h-5 text-violet-500" />
						New skill draft
					</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Fill the form, then run the generated command in your terminal — the
						LumidOS CLI writes the draft under{' '}
						<code className="px-1 py-0.5 bg-slate-100 rounded text-[12px]">
							~/.xp/apps/{app || '&lt;app&gt;'}/.drafts/
						</code>
						. The AI auto-loop and the cycle pick up drafts there. Same disk-bridge pattern as Personal Access Tokens.
					</p>
				</div>
			</div>

			<div className="space-y-4 bg-white border border-slate-200 rounded-xl p-5">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<Label htmlFor="app">App</Label>
						<Input
							id="app"
							value={app}
							onChange={(e) => setApp(e.target.value.toLowerCase())}
							placeholder="mbb-ai"
						/>
						<p className="text-[11px] text-muted-foreground mt-1">
							The xp.io app slug installed at <code>~/.xp/apps/&lt;app&gt;/</code>.
						</p>
					</div>
					<div>
						<Label htmlFor="role">Role</Label>
						<Select value={role} onValueChange={setRole}>
							<SelectTrigger id="role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{COMMON_ROLES.map((r) => (
									<SelectItem key={r} value={r}>
										{r}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-[11px] text-muted-foreground mt-1">
							Which persona reads this skill — picks the memory_agent it
							ingests under.
						</p>
					</div>
				</div>

				<div>
					<Label htmlFor="skill-id">Skill id</Label>
					<Input
						id="skill-id"
						value={skillId}
						onChange={(e) => setSkillId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
						placeholder="revenue_brainstorm"
					/>
					<p className="text-[11px] text-muted-foreground mt-1">
						Snake-case. The CLI rejects spaces / hyphens / unicode.
					</p>
				</div>

				<div>
					<Label htmlFor="kind">Kind</Label>
					<Select value={kind} onValueChange={(v) => setKind(v as SkillKind)}>
						<SelectTrigger id="kind">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{KIND_OPTIONS.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-[11px] text-muted-foreground mt-1">
						{KIND_OPTIONS.find((o) => o.value === kind)?.hint}
					</p>
				</div>

				<div>
					<Label>Triggers</Label>
					<div className="flex flex-wrap items-center gap-1.5 p-2 border border-slate-200 rounded-md bg-white">
						{triggers.map((t, i) => (
							<Badge key={i} variant="secondary" className="gap-1">
								{t}
								<button
									type="button"
									className="hover:text-red-500"
									onClick={() => removeToken(i, triggers, setTriggers)}
								>
									<X className="w-3 h-3" />
								</button>
							</Badge>
						))}
						<input
							className="flex-1 outline-none bg-transparent text-sm min-w-[120px]"
							value={triggerInput}
							onChange={(e) => setTriggerInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ',') {
									e.preventDefault();
									addToken(triggerInput, setTriggers, triggers, setTriggerInput);
								}
							}}
							placeholder={triggers.length ? '' : 'add trigger keywords (Enter / comma to commit)'}
						/>
					</div>
					<p className="text-[11px] text-muted-foreground mt-1">
						Lowercased substrings of the question text. Example:{' '}
						<code>revenue streams</code>, <code>monetize</code>,{' '}
						<code>adjacent products</code>.
					</p>
				</div>

				<div>
					<Label>Target loops</Label>
					<div className="flex flex-wrap items-center gap-1.5 p-2 border border-slate-200 rounded-md bg-white">
						{targetLoops.map((t, i) => (
							<Badge key={i} variant="secondary" className="gap-1">
								{t}
								<button
									type="button"
									className="hover:text-red-500"
									onClick={() => removeToken(i, targetLoops, setTargetLoops)}
								>
									<X className="w-3 h-3" />
								</button>
							</Badge>
						))}
						<input
							className="flex-1 outline-none bg-transparent text-sm min-w-[120px]"
							value={loopInput}
							onChange={(e) => setLoopInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ',') {
									e.preventDefault();
									addToken(loopInput, setTargetLoops, targetLoops, setLoopInput);
								}
							}}
							placeholder={targetLoops.length ? '' : 'loop names from xpcloud.yaml::loops[]'}
						/>
					</div>
				</div>

				{kind !== 'python' && (
					<div>
						<Label htmlFor="body">Prompt body (markdown)</Label>
						<Textarea
							id="body"
							className="font-mono text-[12px] min-h-[260px]"
							value={promptBody}
							onChange={(e) => setPromptBody(e.target.value)}
							placeholder={
								kind === 'skill_md'
									? '---\nname: my_skill\nversion: 0.1.0\nwhen_to_use: |\n  When …\ninputs:\n  - name: question\n    type: string\noutputs:\n  - name: answer\n    type: markdown\nsteps:\n  - …\nanti_patterns:\n  - …\nlinked_assets: []\n---\n\n# my_skill\n\n## Skill\n\nBody…'
									: '# revenue_brainstorm\n\n## Skill\n\nUse this skill when the question asks how the client can grow new revenue.\n…'
							}
						/>
					</div>
				)}

				<div>
					<Label htmlFor="notes">Notes (optional)</Label>
					<Input
						id="notes"
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						placeholder="from validator gap GAP_007 / Case_007 Q3 router miss"
					/>
					<p className="text-[11px] text-muted-foreground mt-1">
						Free-text — typically the gap id or insights-candidate id that
						triggered this draft. Audit-trail material.
					</p>
				</div>

				{blocking.length > 0 && (
					<div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900">
						<AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
						<ul className="space-y-0.5">
							{blocking.map((e) => (
								<li key={e}>{e}</li>
							))}
						</ul>
					</div>
				)}
				{warnings.length > 0 && blocking.length === 0 && (
					<div className="text-xs text-muted-foreground">
						⚠ {warnings.join(' · ')}
					</div>
				)}
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label>Run this in your terminal</Label>
					<Button
						size="sm"
						variant="secondary"
						onClick={copyCommand}
						disabled={blocking.length > 0}
						className="gap-1.5"
					>
						{copied ? (
							<>
								<Check className="w-3.5 h-3.5" /> Copied
							</>
						) : (
							<>
								<Copy className="w-3.5 h-3.5" /> Copy command
							</>
						)}
					</Button>
				</div>
				<pre className="p-4 bg-slate-900 text-slate-100 rounded-md text-[12px] leading-5 overflow-x-auto whitespace-pre">
					{blocking.length > 0
						? '# Fix the validation issues above to generate the command.'
						: command}
				</pre>
				<p className="text-[11px] text-muted-foreground">
					The CLI writes the draft to{' '}
					<code className="px-1 py-0.5 bg-slate-100 rounded">
						~/.xp/apps/{app || '&lt;app&gt;'}/.drafts/&lt;draft_id&gt;/
					</code>
					. Then run{' '}
					<code className="px-1 py-0.5 bg-slate-100 rounded">
						lumid skill_validate --app {app} --draft-id &lt;id&gt;
					</code>{' '}
					to lint, and{' '}
					<code className="px-1 py-0.5 bg-slate-100 rounded">
						lumid skill_apply --app {app} --draft-id &lt;id&gt;
					</code>{' '}
					to land it in the working tree.
				</p>
			</div>
		</div>
	);
}
