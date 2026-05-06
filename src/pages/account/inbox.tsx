import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { Inbox, Sparkles, Brain, Copy, Check, Bot, User, ShieldAlert } from 'lucide-react';
import { generateInboxCommands } from '../../api/draft-bundle';

/**
 * /account/inbox — A1 + A4/A5 side-channel surface.
 *
 * The AI auto-research loop (Theme A1) drafts skills + memories every
 * cycle. The approval gate (Theme A2) routes them auto / stage /
 * force. Stage and force land on the user's local machine under
 *   ~/.xp/apps/<app>/.drafts/         (skills)
 *   ~/.xp/kg/agents/<agent>/.drafts/  (memories)
 *
 * The web UI can't read those paths directly (cross-machine). So the
 * inbox is a **command center**: it explains the loop pattern,
 * generates the right `lumid skill_drafts / memory_drafts` invocations
 * for the user's CLI, and links to the human-led authoring forms
 * (A4/A5) for cold-start or override flows.
 *
 * In the steady state (auto-loop running), this page's main job is
 * to be the URL the auto-loop emails / pings when there are
 * stage-for-review drafts pending: "open lum.id/dashboard/inbox to
 * review N drafts."
 */
export default function InboxPage() {
	const [app, setApp] = useState('mbb-ai');
	const [agent, setAgent] = useState('mbb-ai-analyst');
	const [copied, setCopied] = useState<string | null>(null);

	const cmds = useMemo(() => generateInboxCommands({ app, agent }), [app, agent]);

	const copy = async (key: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(key);
			toast.success('Copied');
			setTimeout(() => setCopied(null), 2_000);
		} catch (e) {
			toast.error(`Copy failed: ${String(e)}`);
		}
	};

	return (
		<div className="max-w-5xl mx-auto p-6 space-y-6">
			<div>
				<h1 className="text-2xl font-bold flex items-center gap-2">
					<Inbox className="w-5 h-5 text-indigo-500" />
					Inbox
				</h1>
				<p className="text-sm text-muted-foreground mt-1 max-w-3xl">
					Drafts staged by the AI auto-research loop and waiting for your
					review. Lumid's design center is "AI is the primary author, you're
					the side channel" — most drafts auto-apply when the approval gate
					says they're safe; the rest land here.
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
				<RouteRibbon
					icon={<Bot className="w-4 h-4 text-violet-500" />}
					tone="violet"
					title="Auto-applied"
					body="Memory ingests with confidence ≥ 0.8 from validated insights. The bandit reinforces / decays them based on cycle outcomes — you don't need to review."
				/>
				<RouteRibbon
					icon={<User className="w-4 h-4 text-amber-500" />}
					tone="amber"
					title="Staged for review"
					body="New skill scaffolds, prompt-body edits, low-confidence memories. View via the CLI commands below; approve / discard with skill_apply / skill_discard."
				/>
				<RouteRibbon
					icon={<ShieldAlert className="w-4 h-4 text-rose-500" />}
					tone="rose"
					title="Force review"
					body="Touches paper-integrity surface (judge prompts, core_principles). Always shown to you regardless of policy — auto-apply not allowed."
				/>
			</div>

			<div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
				<div className="flex items-baseline justify-between">
					<h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
						View staged drafts
					</h2>
					<span className="text-[11px] text-muted-foreground">
						runs locally — drafts live in your <code>~/.xp</code>
					</span>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor="inbox-app">App</Label>
						<Input
							id="inbox-app"
							value={app}
							onChange={(e) => setApp(e.target.value)}
							placeholder="mbb-ai"
						/>
						<div className="flex items-center justify-between">
							<span className="text-[11px] text-muted-foreground">
								Lists skill drafts
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 px-2"
								onClick={() => copy('skills', cmds.skillsCmd)}
							>
								{copied === 'skills' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
							</Button>
						</div>
						<pre className="p-3 bg-slate-900 text-slate-100 rounded text-[11px] overflow-x-auto">
							{cmds.skillsCmd}
						</pre>
					</div>
					<div className="space-y-2">
						<Label htmlFor="inbox-agent">Agent</Label>
						<Input
							id="inbox-agent"
							value={agent}
							onChange={(e) => setAgent(e.target.value)}
							placeholder="mbb-ai-analyst"
						/>
						<div className="flex items-center justify-between">
							<span className="text-[11px] text-muted-foreground">
								Lists memory drafts
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 px-2"
								onClick={() => copy('memory', cmds.memoryCmd)}
							>
								{copied === 'memory' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
							</Button>
						</div>
						<pre className="p-3 bg-slate-900 text-slate-100 rounded text-[11px] overflow-x-auto">
							{cmds.memoryCmd}
						</pre>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<Link
					to={`/dashboard/skills/new?app=${encodeURIComponent(app)}`}
					className="group block p-5 bg-white border border-slate-200 rounded-xl hover:border-violet-300 hover:bg-violet-50/30 transition-colors"
				>
					<div className="flex items-center gap-2 text-slate-700">
						<Sparkles className="w-4 h-4 text-violet-500" />
						<span className="font-semibold">New skill draft</span>
					</div>
					<p className="text-sm text-muted-foreground mt-1">
						Cold-start a new analyst / judge skill from scratch, or override
						an AI-staged draft. Form generates a one-shot CLI command.
					</p>
					<span className="text-[12px] text-violet-600 group-hover:underline">
						Open form →
					</span>
				</Link>
				<Link
					to={`/dashboard/memory/new?app=${encodeURIComponent(app)}`}
					className="group block p-5 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors"
				>
					<div className="flex items-center gap-2 text-slate-700">
						<Brain className="w-4 h-4 text-emerald-500" />
						<span className="font-semibold">New memory ingest</span>
					</div>
					<p className="text-sm text-muted-foreground mt-1">
						Add a principle / lesson / incident / calibration memory to a
						role's xp.io bank. Same filesystem-bridge pattern.
					</p>
					<span className="text-[12px] text-emerald-600 group-hover:underline">
						Open form →
					</span>
				</Link>
			</div>

			<details className="bg-slate-50 border border-slate-200 rounded-xl">
				<summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">
					How the auto-loop and the inbox compose
				</summary>
				<div className="px-4 py-3 text-sm text-slate-600 space-y-2 leading-6">
					<p>
						<strong>OBSERVE.</strong> Each cycle reads new validate gaps + per-cycle
						insights events from your local <code>~/.xp/apps/&lt;app&gt;/data/</code>.
						An mtime cursor prevents re-observation.
					</p>
					<p>
						<strong>ANALYZE / THINK.</strong> Events classify into{' '}
						<code>memory_ingest</code> (lesson / principle / incident /
						calibration) or <code>new_skill_scaffold</code>. Confidence is
						attached per type.
					</p>
					<p>
						<strong>DECIDE.</strong> The approval gate (Theme A2) routes each
						draft. <code>auto</code> → applies immediately. <code>stage</code>{' '}
						→ lands here for your review. <code>force</code> → also lands here,
						even if your policy says otherwise — used for paper-integrity
						surfaces (judge prompts, core_principles).
					</p>
					<p>
						<strong>EXECUTE.</strong> Approving a draft via{' '}
						<code>lumid skill_apply</code> /{' '}
						<code>lumid memory_apply</code> writes it into the working tree
						(skills) or the agent bank (memory).
					</p>
					<p>
						<strong>LEARN.</strong> Per-cycle metrics persist to{' '}
						<code>.skill_authoring_loop_history.jsonl</code>. The bandit reads
						this to score "did the loop's drafts help over time."
					</p>
				</div>
			</details>
		</div>
	);
}

interface RouteRibbonProps {
	icon: React.ReactNode;
	tone: 'violet' | 'amber' | 'rose';
	title: string;
	body: string;
}

function RouteRibbon({ icon, tone, title, body }: RouteRibbonProps) {
	const toneClasses = {
		violet: 'bg-violet-50/40 border-violet-200',
		amber: 'bg-amber-50/40 border-amber-200',
		rose: 'bg-rose-50/40 border-rose-200',
	}[tone];
	return (
		<div className={`p-4 border rounded-xl ${toneClasses}`}>
			<div className="flex items-center gap-2 text-slate-700">
				{icon}
				<span className="font-semibold text-sm">{title}</span>
			</div>
			<p className="text-[12px] text-slate-600 mt-1 leading-5">{body}</p>
		</div>
	);
}
