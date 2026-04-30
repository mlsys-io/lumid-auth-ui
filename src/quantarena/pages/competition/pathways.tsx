import { useState } from 'react';
import { Check, Copy, ExternalLink, Terminal, BookOpen, Cpu, Zap } from 'lucide-react';
import { toast } from 'sonner';

// "Pathways" replaces the standalone API-Doc tab in the Competition
// page. Two columns side-by-side: Direct API (raw REST trading
// surface for curl / SDK builders) and Lumid Pathway (the higher-
// level `/lumid` MCP + auto-quant app, for users who want a working
// trader in three commands rather than wiring orders by hand). Both
// pathways link out to the canonical full reference.

type Snippet = {
	id: string;
	title: string;
	lang: string;
	code: string;
};

const DIRECT_SNIPPETS: Snippet[] = [
	{
		id: 'd-get-positions',
		title: 'Read account positions',
		lang: 'bash',
		code: `curl https://lumid.market/trading/api/v1/account \\
  -H "X-API-Token: Bearer <strategy_token>"`,
	},
	{
		id: 'd-place-trade',
		title: 'Place a market order',
		lang: 'bash',
		code: `curl -X POST https://lumid.market/trading/api/v1/orders \\
  -H "X-API-Token: Bearer <strategy_token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "symbol": "BTCUSD",
    "direction": "Buy",
    "quantity": 0.1,
    "order_type": "Market"
  }'`,
	},
	{
		id: 'd-leaderboard',
		title: 'Check competition leaderboard',
		lang: 'bash',
		code: `curl "https://lumid.market/backend/api/v1/dashboard/leaderboard/<competition_id>"`,
	},
];

const LUMID_SNIPPETS: Snippet[] = [
	{
		id: 'l-install',
		title: 'Install Lumid + auto-quant',
		lang: 'bash',
		code: `curl -fsSL https://lum.id/start | bash -s -- <lm_pat_live_…>
/lumid app install ceba53d6.../auto-quant --as auto-quant`,
	},
	{
		id: 'l-configure',
		title: 'Configure & wire to a competition',
		lang: 'bash',
		code: `/lumid app auto-quant configure   # writes ~/.lumid/apps/auto-quant/credentials.toml
/lumid app auto-quant join <competition_id>`,
	},
	{
		id: 'l-cycle',
		title: 'Run a trading cycle',
		lang: 'bash',
		code: `/lumid app auto-quant cycle
# or: schedule it (LumidOS picks CPU/local vs cloud GPU automatically)
/lumid schedule add --app auto-quant --cycle --interval 300`,
	},
];

function CodeBlock({ snippet }: { snippet: Snippet }) {
	const [copied, setCopied] = useState(false);
	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(snippet.code);
			setCopied(true);
			toast.success('Copied');
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error('Copy failed');
		}
	};
	return (
		<div className="group relative">
			<div className="flex items-center justify-between px-3 pt-2 pb-1.5">
				<span className="text-xs font-medium text-slate-600">{snippet.title}</span>
				<button
					onClick={onCopy}
					className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700 p-1 rounded"
					aria-label="Copy snippet"
				>
					{copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
				</button>
			</div>
			<pre className="bg-slate-900 text-slate-100 text-[12px] leading-relaxed rounded-md px-4 py-3 overflow-x-auto m-0">
				<code>{snippet.code}</code>
			</pre>
		</div>
	);
}

function PathwayCard({
	tone,
	icon: Icon,
	title,
	tagline,
	bullets,
	snippets,
	docHref,
	docLabel,
}: {
	tone: 'indigo' | 'amber';
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	tagline: string;
	bullets: string[];
	snippets: Snippet[];
	docHref: string;
	docLabel: string;
}) {
	const accent =
		tone === 'indigo'
			? 'border-indigo-200 bg-indigo-50/40'
			: 'border-amber-200 bg-amber-50/40';
	const accentText = tone === 'indigo' ? 'text-indigo-600' : 'text-amber-700';
	return (
		<div className={`rounded-xl border ${accent} p-5 flex flex-col gap-4`}>
			<div className="flex items-start gap-3">
				<div className={`p-2 rounded-lg bg-white border border-slate-200 ${accentText}`}>
					<Icon className="w-5 h-5" />
				</div>
				<div className="flex-1 min-w-0">
					<h3 className="text-base font-semibold text-slate-900">{title}</h3>
					<p className="text-sm text-slate-600">{tagline}</p>
				</div>
			</div>
			<ul className="text-sm text-slate-700 space-y-1.5 list-disc pl-5">
				{bullets.map((b) => (
					<li key={b}>{b}</li>
				))}
			</ul>
			<div className="space-y-2">
				{snippets.map((s) => (
					<CodeBlock key={s.id} snippet={s} />
				))}
			</div>
			<a
				href={docHref}
				target={docHref.startsWith('http') ? '_blank' : undefined}
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 self-start"
			>
				<BookOpen className="w-4 h-4" />
				{docLabel}
				<ExternalLink className="w-3.5 h-3.5 opacity-60" />
			</a>
		</div>
	);
}

export default function Pathways() {
	return (
		<div className="space-y-5">
			<div className="text-sm text-slate-600 max-w-3xl">
				Two ways to trade in a Lumid competition. <b>Direct API</b> is the
				raw REST surface — bring your own runtime, sign requests, manage
				orders by hand. <b>Lumid pathway</b> is the higher-level route:
				install the auto-quant app, configure credentials once, and let the
				platform schedule cycles, route compute, and accumulate strategy
				memory through xp.io.
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<PathwayCard
					tone="indigo"
					icon={Terminal}
					title="Direct API"
					tagline="REST trading surface — your runtime, your code."
					bullets={[
						'Per-strategy bearer token, scoped to the active competition.',
						'JSON responses with envelope { ret_code, message, data }.',
						'~10 req/min strategy writes, 600 req/min trading-API token.',
					]}
					snippets={DIRECT_SNIPPETS}
					docHref="/docs/TRADING_API.md"
					docLabel="Full Trading API reference"
				/>
				<PathwayCard
					tone="amber"
					icon={Zap}
					title="Lumid pathway"
					tagline="auto-quant app + /lumid MCP — three commands to a working trader."
					bullets={[
						'No order plumbing — the app handles signing, retries, schedule.',
						'Trades route through hybrid CPU/GPU compute via LumidOS.',
						'Strategy outcomes accumulate as xp.io memories across cycles.',
					]}
					snippets={LUMID_SNIPPETS}
					docHref="https://lum.id/lqa"
					docLabel="auto-quant walkthrough on lum.id"
				/>
			</div>

			<div className="text-xs text-slate-500 flex items-center gap-2">
				<Cpu className="w-3.5 h-3.5" />
				Either path can run alongside the other — the same lum.id account
				owns both the strategy token and the auto-quant install.
			</div>
		</div>
	);
}
