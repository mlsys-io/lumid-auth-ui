import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Button } from '../../components/ui/button';
import { getCompetitionsList } from '../../api';
import { CompetitionInfo } from '../../api/types';
import { createAIStrategy, type CreateAIStrategyResponse } from '../../api/ai-strategy';
import { toast } from 'sonner';
import { Sparkles, Terminal, ExternalLink } from 'lucide-react';

/**
 * Create-AI-Strategy wizard — companion to Claude Code's `/lumid
 * start_bot`. Users who prefer the web UI get this path; power users
 * stay in the terminal. Both end at the same place: a live bot
 * scheduled and visible on /research/:strategy_id.
 *
 * v1 only exposes the `llm_bot` template; auto_research is reserved
 * server-side but rejects with a clear error, so the dropdown shows
 * the option as "coming soon" rather than hiding it.
 */

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (resp: CreateAIStrategyResponse) => void;
}

const PROVIDERS = [
	{ value: 'openai', label: 'OpenAI (GPT-4/5 via /v1/chat/completions)' },
	{ value: 'anthropic', label: 'Anthropic (Claude via Messages API)' },
	{ value: 'xai', label: 'xAI (Grok)' },
	{ value: 'deepseek', label: 'DeepSeek' },
];

// Prompt presets — the bot's system prompt template. Users can start
// from one of these and edit freely. Kept short on purpose; bots that
// need deeper context should push examples to XP.io memory instead of
// bloating the prompt.
const PROMPT_PRESETS: Record<string, string> = {
	momentum: `You are a crypto trading agent. On each cycle you will receive the most recent price for the tracked symbols and the last few price points. Decide Buy / Sell / Hold for ONE symbol per cycle.

Bias: momentum. Buy when the latest price is above the recent short-average; Sell when below; Hold when flat.
Risk: never allocate more than 20% of available cash to a single trade. Keep at least 30% cash reserve.
Output: one JSON object only — {"symbol": "<SYMBOL>", "direction": "Buy|Sell|Hold", "volume": <int>, "reasoning": "<1 sentence>"}.`,
	mean_reversion: `You are a crypto trading agent. On each cycle decide Buy / Sell / Hold for ONE symbol.

Bias: mean reversion. Buy when price is 1%+ below recent mean; Sell when 1%+ above; otherwise Hold.
Risk: cap position at 15% of equity per symbol. Exit losses early.
Output: one JSON object only — {"symbol": "<SYMBOL>", "direction": "Buy|Sell|Hold", "volume": <int>, "reasoning": "<1 sentence>"}.`,
	news_sensitive: `You are a crypto trading agent. Each cycle you receive prices AND the latest news headlines for the tracked symbols.

Weight headlines heavily: if news is positive for a symbol, lean Buy; if negative, Sell or Hold; if neutral, defer to momentum.
Output: one JSON object only — {"symbol": "<SYMBOL>", "direction": "Buy|Sell|Hold", "volume": <int>, "reasoning": "<1 sentence>"}.`,
};

const PROMPT_LABELS: Record<string, string> = {
	momentum: 'Momentum (default)',
	mean_reversion: 'Mean reversion',
	news_sensitive: 'News-sensitive',
};

// composePreview — renders a plausible-looking version of the full
// LLM message the bot will send each cycle, using stub live data so
// the user can see the shape. Mirrors what llm_player_act.py actually
// constructs at runtime (without hitting any APIs from this preview).
function composePreview({
	symbols,
	provider,
	prompt,
}: {
	symbols: string[];
	provider: string;
	prompt: string;
}): string {
	const stubPrices = symbols
		.map((s) => `  ${s}: 0.0823 (prev cycle 0.0818, +0.6%)`)
		.join('\n');
	const systemMsg = `system: ${prompt || '(empty — set a prompt above)'}`;
	const userMsg = [
		`user: Current prices:`,
		stubPrices,
		``,
		`Portfolio: cash=$80,234.50, positions={DOGEUSD: 1200 @ $0.0819}`,
		`Respond with one JSON object.`,
	].join('\n');
	return `# Sent to ${provider} each cycle\n\n${systemMsg}\n\n${userMsg}`;
}

const INTERVALS = [
	{ value: '300', label: 'Every 5 min' },
	{ value: '900', label: 'Every 15 min' },
	{ value: '3600', label: 'Every hour' },
];

export default function AIStrategyWizard({ open, onOpenChange, onCreated }: Props) {
	const [competitions, setCompetitions] = useState<CompetitionInfo[]>([]);
	const [loadingComps, setLoadingComps] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<CreateAIStrategyResponse | null>(null);

	const [form, setForm] = useState({
		name: '',
		description: '',
		competition_id: '' as string,
		provider: 'openai',
		symbols: [] as string[],
		interval_seconds: '300',
		prompt: '',
	});
	const [promptPreset, setPromptPreset] = useState<string>('momentum');

	useEffect(() => {
		if (!open) return;
		setResult(null);
		setLoadingComps(true);
		getCompetitionsList({ status: ['Ongoing', 'Upcoming'], page: 1, page_size: 100 })
			.then((r) => setCompetitions(r.data.competitions))
			.finally(() => setLoadingComps(false));
		// Seed with the default preset so users have something to
		// play with rather than staring at a blank textarea.
		setForm((f) => ({ ...f, prompt: PROMPT_PRESETS.momentum }));
		setPromptPreset('momentum');
	}, [open]);

	const selectedComp = useMemo(
		() => competitions.find((c) => String(c.id) === form.competition_id),
		[competitions, form.competition_id],
	);

	const availableSymbols = selectedComp?.symbols ?? [];

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!form.competition_id) {
			toast.error('Pick a competition');
			return;
		}
		if (form.symbols.length === 0) {
			toast.error('Pick at least one symbol');
			return;
		}
		setSubmitting(true);
		try {
			const resp = await createAIStrategy({
				name: form.name.trim(),
				description: form.description.trim() || undefined,
				competition_id: Number(form.competition_id),
				template: 'llm_bot',
				provider: form.provider as 'openai',
				symbols: form.symbols,
				interval_seconds: Number(form.interval_seconds),
				prompt: form.prompt.trim() || undefined,
			});
			setResult(resp);
			if (resp.bot_status === 'scheduled') {
				toast.success('AI strategy created — bot is scheduled');
			} else {
				toast.error(`Strategy created but bot failed: ${resp.bot_error ?? 'unknown'}`);
			}
			onCreated?.(resp);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Create failed');
		} finally {
			setSubmitting(false);
		}
	};

	const toggleSymbol = (sym: string) => {
		setForm((f) => ({
			...f,
			symbols: f.symbols.includes(sym) ? f.symbols.filter((s) => s !== sym) : [...f.symbols, sym],
		}));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Sparkles className="w-4 h-4 text-indigo-500" />
						Create AI Strategy
					</DialogTitle>
				</DialogHeader>

				{/* Hint toward Claude Code — primary surface, not a competitor.
				    Show it once at the top so power users know the fast path. */}
				<div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 flex items-start gap-2">
					<Terminal className="w-3.5 h-3.5 mt-0.5 shrink-0" />
					<div>
						Power-user path: in Claude Code run{' '}
						<code className="px-1 py-0.5 rounded bg-white border border-slate-200">
							/lumid setup_trading
						</code>{' '}
						then{' '}
						<code className="px-1 py-0.5 rounded bg-white border border-slate-200">
							/lumid start_bot "momentum on DOGE"
						</code>
						. This wizard does the same thing in one form.
					</div>
				</div>

				{result ? (
					<ResultPanel result={result} onClose={() => onOpenChange(false)} />
				) : (
					<form onSubmit={handleSubmit} className="space-y-4 mt-2">
						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label>
									Name <span className="text-red-500">*</span>
								</Label>
								<Input
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
									placeholder="my-ai-bot"
									required
								/>
							</div>
							<div className="space-y-2">
								<Label>Competition *</Label>
								<Select
									value={form.competition_id}
									onValueChange={(v) => setForm({ ...form, competition_id: v, symbols: [] })}
								>
									<SelectTrigger>
										<SelectValue placeholder={loadingComps ? 'Loading…' : 'Select a competition'} />
									</SelectTrigger>
									<SelectContent>
										{competitions.map((c) => (
											<SelectItem key={c.id} value={String(c.id)}>
												{c.name} {c.status === 'Upcoming' ? '(upcoming)' : ''}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="space-y-2">
							<Label>Description</Label>
							<Input
								value={form.description}
								onChange={(e) => setForm({ ...form, description: e.target.value })}
								placeholder="Short description of what this bot is for"
								maxLength={200}
							/>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label>LLM provider *</Label>
								<Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PROVIDERS.map((p) => (
											<SelectItem key={p.value} value={p.value}>
												{p.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>Cycle interval *</Label>
								<Select
									value={form.interval_seconds}
									onValueChange={(v) => setForm({ ...form, interval_seconds: v })}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{INTERVALS.map((i) => (
											<SelectItem key={i.value} value={i.value}>
												{i.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="space-y-2">
							<Label>
								Symbols <span className="text-red-500">*</span>{' '}
								<span className="text-xs font-normal text-gray-400">
									(pick from this competition's market)
								</span>
							</Label>
							{availableSymbols.length === 0 ? (
								<div className="text-xs text-gray-400 italic">Pick a competition first.</div>
							) : (
								<div className="flex flex-wrap gap-2">
									{availableSymbols.map((s) => {
										const active = form.symbols.includes(s);
										return (
											<button
												key={s}
												type="button"
												onClick={() => toggleSymbol(s)}
												className={`px-2 py-1 rounded-md text-xs border cursor-pointer transition-colors ${
													active
														? 'bg-indigo-600 text-white border-indigo-600'
														: 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
												}`}
											>
												{s}
											</button>
										);
									})}
								</div>
							)}
						</div>

						{/* Prompt editor — the actual text the bot's LLM call
						    will be steered by. Preset picks a starting
						    template; user edits in place. Preview block at
						    the bottom shows the composed message (symbols
						    + price inserted at runtime are stubbed here so
						    the user can see the shape). */}
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<Label>Strategy prompt</Label>
								<Select
									value={promptPreset}
									onValueChange={(v) => {
										setPromptPreset(v);
										setForm({ ...form, prompt: PROMPT_PRESETS[v] ?? form.prompt });
									}}
								>
									<SelectTrigger className="h-7 w-[180px] text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Object.keys(PROMPT_PRESETS).map((k) => (
											<SelectItem key={k} value={k} className="text-xs">
												{PROMPT_LABELS[k] ?? k}
											</SelectItem>
										))}
										<SelectItem value="custom" className="text-xs">
											Custom (blank)
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<textarea
								value={form.prompt || PROMPT_PRESETS[promptPreset] || ''}
								onChange={(e) => {
									setPromptPreset('custom');
									setForm({ ...form, prompt: e.target.value });
								}}
								rows={5}
								maxLength={1000}
								className="w-full rounded-md border border-gray-200 px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
								placeholder="You are a crypto trader. Decide Buy / Sell / Hold given the last price and recent trend..."
							/>
							<details className="mt-2">
								<summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-800 select-none">
									Preview what the LLM will receive each cycle
								</summary>
								<pre className="mt-2 bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] font-mono whitespace-pre-wrap break-words text-slate-700 max-h-48 overflow-y-auto">
{composePreview({
	symbols: form.symbols.length ? form.symbols : ['DOGEUSD'],
	provider: form.provider,
	prompt: (form.prompt || PROMPT_PRESETS[promptPreset] || '').trim(),
})}
								</pre>
							</details>
						</div>

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={submitting || !form.name || !form.competition_id || form.symbols.length === 0}>
								{submitting ? 'Creating…' : 'Create AI Strategy'}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ResultPanel({ result, onClose }: { result: CreateAIStrategyResponse; onClose: () => void }) {
	const status = result.bot_status === 'scheduled';
	return (
		<div className="space-y-4">
			<div
				className={`rounded-lg border p-3 ${
					status ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
				}`}
			>
				<div className="font-medium text-sm">
					{status ? '✓ AI strategy live' : '⚠ Strategy created; bot failed'}
				</div>
				<div className="text-xs text-gray-600 mt-1">
					Strategy <code>{result.strategy_name}</code> (id={result.strategy_id}) — template{' '}
					<code>{result.template}</code> on <code>{result.provider}</code>.
				</div>
				{result.bot_error && (
					<div className="mt-2 text-xs font-mono text-rose-700 break-all">{result.bot_error}</div>
				)}
			</div>

			<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
				<div className="font-medium mb-1">Save this API token — shown once</div>
				<code className="block font-mono bg-white border border-amber-200 rounded px-2 py-1 break-all">
					{result.api_token}
				</code>
				<p className="mt-2 text-amber-800/80">
					Use it with <code>X-API-Token: Bearer &lt;token&gt;</code> to call the trading API directly.
				</p>
			</div>

			<DialogFooter>
				<Button type="button" variant="outline" onClick={onClose}>
					Close
				</Button>
				<Button asChild>
					<a href={result.research_url} target="_blank" rel="noopener noreferrer">
						Open research page <ExternalLink className="w-3 h-3 ml-1" />
					</a>
				</Button>
			</DialogFooter>
		</div>
	);
}
