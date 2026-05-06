import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { toast } from 'sonner';
import { Copy, Check, Brain, AlertTriangle, ArrowLeft, X } from 'lucide-react';
import {
	generateMemoryDraftCommand,
	isValidAppSlug,
} from '../../../api/draft-bundle';

/**
 * /account/memory/new — A5 memory ingest form.
 *
 * Same filesystem-bridge pattern as A4: form input → copy-pasteable
 * `lumid memory_draft …` command → CLI writes the draft under
 * ~/.xp/kg/agents/<resolved_agent>/.drafts/. The agent id is resolved
 * by the CLI from xpcloud.yaml::roles[].memory_agent — the user
 * specifies the role they're authoring against.
 *
 * Memory types match xp.io's ingest schema:
 *   - principle: a generalizable belief / heuristic.
 *   - lesson: a specific case-derived insight.
 *   - incident: a regression or notable failure.
 *   - calibration: scoring-rubric note (judge-side memory).
 */

const MEMORY_TYPES = [
	{ value: 'principle', hint: 'A generalizable belief / heuristic. "Opening responses should align, not jump to a principled answer."' },
	{ value: 'lesson', hint: 'Case-derived: "On Q3-style adjacent-revenue questions, picking only [communication] is too narrow."' },
	{ value: 'incident', hint: 'A regression or notable failure: "Run 2026-05-14: Q5 fell from 7/8 to 5/8 after the prompt edit."' },
	{ value: 'calibration', hint: 'Judge-side: "Score score_pct=90 with embed coverage <0.4 has historically been over-credited."' },
];

const COMMON_ROLES = ['analyst', 'judge', 'shared', 'trader', 'operator'];

export default function MemoryNewPage() {
	const [params] = useSearchParams();
	const [app, setApp] = useState(params.get('app') ?? 'mbb-ai');
	const [role, setRole] = useState(params.get('role') ?? 'analyst');
	const [type, setType] = useState(params.get('type') ?? 'principle');
	const [content, setContent] = useState(params.get('content') ?? '');
	const [tags, setTags] = useState<string[]>(
		params.get('tags')?.split(',').filter(Boolean) ?? [],
	);
	const [tagInput, setTagInput] = useState('');
	const [notes, setNotes] = useState(params.get('notes') ?? '');
	const [copied, setCopied] = useState(false);

	const validation = useMemo(() => {
		const errors: string[] = [];
		if (!app) errors.push('app is required');
		else if (!isValidAppSlug(app))
			errors.push('app must be lowercase a-z, 0-9, hyphen');
		if (!role) errors.push('role is required');
		if (!content.trim()) errors.push('content cannot be empty');
		else if (content.trim().length < 20)
			errors.push('content < 20 chars — memories should be a sentence, not a fragment');
		return errors;
	}, [app, role, content]);

	const blocking = validation.filter((e) => !e.includes('< 20 chars'));
	const warnings = validation.filter((e) => e.includes('< 20 chars'));

	const command = useMemo(
		() =>
			generateMemoryDraftCommand({ app, role, content, type, tags, notes }),
		[app, role, content, type, tags, notes],
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

	const addTag = () => {
		const t = tagInput.trim();
		if (!t || tags.includes(t)) {
			setTagInput('');
			return;
		}
		setTags([...tags, t]);
		setTagInput('');
	};

	return (
		<div className="max-w-4xl mx-auto p-6 space-y-5">
			<div>
				<div className="text-xs text-muted-foreground mb-1">
					<Link to="/dashboard/inbox" className="hover:underline">
						<ArrowLeft className="inline w-3 h-3 mr-0.5" /> Inbox
					</Link>
				</div>
				<h1 className="text-2xl font-bold flex items-center gap-2">
					<Brain className="w-5 h-5 text-emerald-500" />
					New memory ingest
				</h1>
				<p className="text-sm text-muted-foreground mt-1">
					Add to a role-specific memory bank. The Thompson-sampling bandit picks
					retrieved memories at hypothesize-time; bad memories decay, good ones
					reinforce. The web form generates a CLI command — the LumidOS CLI
					writes to{' '}
					<code className="px-1 py-0.5 bg-slate-100 rounded text-[12px]">
						~/.xp/kg/agents/&lt;agent&gt;/.drafts/
					</code>
					 (the agent id is resolved from the app's xpcloud.yaml roles).
				</p>
			</div>

			<div className="space-y-4 bg-white border border-slate-200 rounded-xl p-5">
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					<div>
						<Label htmlFor="app">App</Label>
						<Input
							id="app"
							value={app}
							onChange={(e) => setApp(e.target.value.toLowerCase())}
							placeholder="mbb-ai"
						/>
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
					</div>
					<div>
						<Label htmlFor="type">Type</Label>
						<Select value={type} onValueChange={setType}>
							<SelectTrigger id="type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{MEMORY_TYPES.map((t) => (
									<SelectItem key={t.value} value={t.value}>
										{t.value}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-[11px] text-muted-foreground mt-1">
							{MEMORY_TYPES.find((t) => t.value === type)?.hint}
						</p>
					</div>
				</div>

				<div>
					<Label htmlFor="content">Content</Label>
					<Textarea
						id="content"
						className="min-h-[160px]"
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="A sentence or paragraph the persona should remember. Concrete > abstract."
					/>
					<p className="text-[11px] text-muted-foreground mt-1">
						Will be retrieved verbatim by xp.io at hypothesize-time. Concrete,
						question-anchored memories beat generic principles.
					</p>
				</div>

				<div>
					<Label>Tags</Label>
					<div className="flex flex-wrap items-center gap-1.5 p-2 border border-slate-200 rounded-md">
						{tags.map((t, i) => (
							<Badge key={i} variant="secondary" className="gap-1">
								{t}
								<button
									type="button"
									className="hover:text-red-500"
									onClick={() => setTags(tags.filter((_, idx) => idx !== i))}
								>
									<X className="w-3 h-3" />
								</button>
							</Badge>
						))}
						<input
							className="flex-1 outline-none bg-transparent text-sm min-w-[120px]"
							value={tagInput}
							onChange={(e) => setTagInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ',') {
									e.preventDefault();
									addTag();
								}
							}}
							placeholder={tags.length ? '' : 'add tags (Enter / comma to commit)'}
						/>
					</div>
					<p className="text-[11px] text-muted-foreground mt-1">
						Used by the bandit's retrieval filter. Examples:{' '}
						<code>opening</code>, <code>router</code>, <code>calibration</code>.
					</p>
				</div>

				<div>
					<Label htmlFor="notes">Notes (optional)</Label>
					<Input
						id="notes"
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						placeholder="from regression flag REG_007_Q3 / observed 2026-05-15"
					/>
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
					Then run{' '}
					<code className="px-1 py-0.5 bg-slate-100 rounded">
						lumid memory_apply --agent &lt;resolved-agent&gt; --draft-id
						&lt;id&gt;
					</code>{' '}
					to ingest into the bank, or leave it staged for review.
				</p>
			</div>
		</div>
	);
}
