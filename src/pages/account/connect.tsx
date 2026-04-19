import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
	Terminal,
	KeyRound,
	Check,
	Copy,
	ExternalLink,
	Sparkles,
	ChevronRight,
	LockKeyhole,
	Layers,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { mintPAT, listPATs, SCOPE_PRESETS, type PATInfo, type Scope, type MintPATResponse } from '../../api/identity';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

/**
 * /connect — LumidOS onboarding hub.
 *
 * This page frames LumidOS as the product. LQA (where the user
 * currently is) is labeled "LumidOS Portal · AI Quant Research" so
 * they understand the UI they're in is one app of a broader
 * platform.
 *
 * Primary flow:
 *   1. Mint a token (or pick an existing one)
 *   2. Copy the one-liner installer
 *   3. Paste into their terminal → LumidOS runs locally
 *
 * Services panel (below) previews the matrix of subsystems the PAT
 * unlocks. LQA is granted by default; Compute / Analytics / Knowledge
 * are placeholder rows for when federation ships — scoped today to
 * set expectations without overpromising.
 */
export default function ConnectPage() {
	const [tokens, setTokens] = useState<PATInfo[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = () =>
		listPATs()
			.then(setTokens)
			.catch(() => {})
			.finally(() => setLoading(false));

	useEffect(() => {
		refresh();
	}, []);

	const activeTokens = useMemo(() => tokens.filter((t) => t.status === 'active'), [tokens]);

	return (
		<div className="max-w-4xl mx-auto p-6 space-y-6">
			<div>
				<div className="text-xs font-medium text-indigo-500 uppercase tracking-widest">
					LumidOS Portal · AI Quant Research
				</div>
				<h1 className="text-3xl font-bold mt-1">Install LumidOS on your machine</h1>
				<p className="text-sm text-muted-foreground mt-2 max-w-2xl">
					LumidOS is the platform this portal runs on — agents, research loops, scheduler,
					knowledge graph. Install it locally and you can do AI quant research (and more) from
					Claude Code or your own scripts, without the web UI. LQA stays a convenience layer,
					not a requirement.
				</p>
			</div>

			<InstallCard tokens={activeTokens} loading={loading} onMinted={refresh} />

			<ServicesMatrix />

			<Footnote />
		</div>
	);
}

function InstallCard({
	tokens,
	loading,
	onMinted,
}: {
	tokens: PATInfo[];
	loading: boolean;
	onMinted: () => void;
}) {
	const [mode, setMode] = useState<'pick' | 'mint'>('mint');
	const [selectedId, setSelectedId] = useState<string>('');
	const [freshToken, setFreshToken] = useState<MintPATResponse | null>(null);
	const [name, setName] = useState('my-machine');
	const [preset, setPreset] = useState<string>('trading_bot');
	const [submitting, setSubmitting] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		// Once we know the user has at least one active token, default
		// to "pick an existing one" — avoids minting unnecessary extras.
		if (tokens.length > 0 && !freshToken) setMode('pick');
	}, [tokens.length, freshToken]);

	const scopes = useMemo<Scope[]>(
		() => SCOPE_PRESETS.find((p) => p.id === preset)?.scopes ?? ['read'],
		[preset],
	);

	const submit = async () => {
		if (!name.trim()) {
			toast.error('Name is required');
			return;
		}
		setSubmitting(true);
		try {
			const r = await mintPAT({ name: name.trim(), scopes, expires_in_seconds: 0 });
			setFreshToken(r);
			onMinted();
		} catch (e: any) {
			toast.error(String(e?.message ?? e));
		} finally {
			setSubmitting(false);
		}
	};

	// Provider keys — kept entirely client-side (never sent to
	// lumid.market). The user pastes them into the form, the page
	// renders them as `KEY=value` env-var prefixes on the install
	// command, user copies the whole block and runs it locally. The
	// installer reads them from its own shell env and writes
	// ~/.api_keys on the user's machine.
	const [showKeys, setShowKeys] = useState(false);
	const [providerKeys, setProviderKeys] = useState<Record<string, string>>({
		OPENAI_API_KEY: '',
		ANTHROPIC_API_KEY: '',
		XAI_API_KEY: '',
		DEEPSEEK_API_KEY: '',
	});
	const providerKeysPrefix = Object.entries(providerKeys)
		.filter(([, v]) => v.trim())
		.map(([k, v]) => `${k}='${v.trim().replace(/'/g, "'\\''")}'`)
		.join(' ');

	// We can only show the install command when we have a cleartext
	// token. Existing tokens don't include the cleartext (shown once
	// at mint), so if the user picks one from the list we show a
	// placeholder and recommend minting fresh when rotating machines.
	const installToken = freshToken?.token ?? '';
	const installCmd = [
		providerKeysPrefix && `${providerKeysPrefix} \\\n  `,
		'curl -sSL https://lumid.market/install.sh | bash -s -- ',
		installToken || '<paste your token here>',
	]
		.filter(Boolean)
		.join('');

	const copy = () => {
		navigator.clipboard.writeText(installCmd);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="border border-gray-200 rounded-xl bg-white p-5 space-y-4">
			<div className="flex items-center gap-2">
				<Terminal className="w-4 h-4 text-indigo-500" />
				<h2 className="font-semibold">Step 1 — Pick or mint a token, step 2 — paste the one-liner</h2>
			</div>

			<div className="flex gap-2 text-xs">
				<button
					onClick={() => setMode('mint')}
					className={`px-3 py-1 rounded-md border cursor-pointer ${
						mode === 'mint'
							? 'bg-indigo-50 border-indigo-200 text-indigo-700'
							: 'bg-white border-gray-200 text-gray-700'
					}`}
				>
					<Sparkles className="w-3 h-3 inline mr-1" /> New token
				</button>
				<button
					onClick={() => setMode('pick')}
					disabled={tokens.length === 0}
					className={`px-3 py-1 rounded-md border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
						mode === 'pick'
							? 'bg-indigo-50 border-indigo-200 text-indigo-700'
							: 'bg-white border-gray-200 text-gray-700'
					}`}
				>
					<KeyRound className="w-3 h-3 inline mr-1" /> Use existing
				</button>
			</div>

			{mode === 'mint' && !freshToken && (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<div>
						<Label className="text-xs">Name this machine</Label>
						<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop / prod-vm / dev-box" />
					</div>
					<div>
						<Label className="text-xs">What the token can do</Label>
						<Select value={preset} onValueChange={setPreset}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SCOPE_PRESETS.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										<span className="font-medium">{p.label}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="md:col-span-2">
						<Button onClick={submit} disabled={submitting || !name.trim()} className="gap-2">
							<Sparkles className="w-4 h-4" />
							{submitting ? 'Minting…' : 'Mint token'}
						</Button>
					</div>
				</div>
			)}

			{mode === 'pick' && !freshToken && (
				<div className="space-y-2">
					<Label className="text-xs">Which token?</Label>
					{loading ? (
						<div className="text-xs text-gray-500">Loading…</div>
					) : (
						<Select value={selectedId} onValueChange={setSelectedId}>
							<SelectTrigger>
								<SelectValue placeholder="Choose an active token" />
							</SelectTrigger>
							<SelectContent>
								{tokens.map((t) => (
									<SelectItem key={t.id} value={String(t.id)}>
										{t.name} <span className="text-gray-400 ml-2 font-mono">{t.token_prefix}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-2">
						<LockKeyhole className="w-3 h-3 inline mr-1" />
						Existing tokens aren't stored anywhere — if you didn't save it, mint a fresh one.
					</p>
				</div>
			)}

			{freshToken && (
				<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
					<div className="font-medium flex items-center gap-1 text-emerald-800">
						<Check className="w-3.5 h-3.5" /> Token minted: {freshToken.name}
					</div>
					<div className="mt-1 text-emerald-900/80">
						<span className="font-mono">{freshToken.token.slice(0, 28)}…{freshToken.token.slice(-6)}</span>
					</div>
				</div>
			)}

			<div className="border-t border-gray-100 pt-3">
				<button
					type="button"
					onClick={() => setShowKeys((v) => !v)}
					className="flex items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-900 cursor-pointer"
				>
					<span>{showKeys ? '▼' : '▶'}</span>
					<span>LLM provider keys (optional)</span>
					<span className="text-gray-400 font-normal">
						— needed if your bots call OpenAI / Anthropic / xAI / DeepSeek
					</span>
				</button>
				{showKeys && (
					<div className="mt-3 space-y-2">
						{(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY'] as const).map(
							(k) => (
								<div key={k} className="grid grid-cols-[160px_1fr] gap-2 items-center">
									<Label className="text-xs font-mono text-gray-600">{k}</Label>
									<Input
										type="password"
										placeholder={`sk-... (leave blank to skip)`}
										value={providerKeys[k]}
										onChange={(e) => setProviderKeys({ ...providerKeys, [k]: e.target.value })}
									/>
								</div>
							),
						)}
						<p className="text-xs text-gray-500">
							Keys stay in this browser session — they are <em>not</em> sent to lumid.market. They become
							env-var prefixes on the install command below; the installer writes them to{' '}
							<code>~/.api_keys</code> on your machine (mode 0600) and the local scheduler picks them up
							for every bot subprocess.
						</p>
					</div>
				)}
			</div>

			<div>
				<Label className="text-xs">One-liner installer</Label>
				<div className="mt-1 relative">
					<pre className="bg-slate-900 text-slate-100 rounded-md p-3 text-xs font-mono whitespace-pre-wrap break-all pr-12">
						{installCmd}
					</pre>
					<Button
						size="sm"
						onClick={copy}
						disabled={!installToken}
						className="absolute top-2 right-2 h-7 w-7 p-0 bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
						title="Copy"
					>
						{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
					</Button>
				</div>
				<p className="mt-2 text-xs text-gray-500">
					Runs entirely on your machine: clones LumidOS, creates a venv, writes{' '}
					<code>~/.lumilake/credentials.toml</code>, patches Claude Code's MCP settings, and starts a
					local scheduler as a user-level service. No sudo.
				</p>
			</div>
		</div>
	);
}

function ServicesMatrix() {
	const rows: {
		id: string;
		name: string;
		description: string;
		status: 'active' | 'soon' | 'planned';
	}[] = [
		{
			id: 'lqa',
			name: 'LQA (AI Quant Research)',
			description: 'This portal + the QuantArena competition platform. Trading, leaderboards, strategies.',
			status: 'active',
		},
		{
			id: 'knowledge',
			name: 'Knowledge Graph (XP.io)',
			description: 'Auto-research loops, memory that compounds across cycles, learned patterns.',
			status: 'soon',
		},
		{
			id: 'compute',
			name: 'Compute (FlowMesh)',
			description: 'Local + cloud GPU execution for model inference, training, embeddings.',
			status: 'soon',
		},
		{
			id: 'analytics',
			name: 'Analytics (Lumilake)',
			description: 'HALO optimizer, workflow optimization, data lakehouse.',
			status: 'planned',
		},
	];
	return (
		<div className="border border-gray-200 rounded-xl bg-white p-5">
			<div className="flex items-center gap-2 mb-1">
				<Layers className="w-4 h-4 text-indigo-500" />
				<h2 className="font-semibold">What the token unlocks</h2>
			</div>
			<p className="text-xs text-gray-500 mb-3">
				One token, every service. As we federate identity across the platform, these rows
				light up automatically — no new credentials to manage.
			</p>
			<div className="divide-y divide-gray-100">
				{rows.map((r) => (
					<div key={r.id} className="py-3 flex items-start gap-3">
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm">{r.name}</span>
								<span
									className={`text-[10px] font-medium rounded-full px-2 py-0.5 border ${
										r.status === 'active'
											? 'bg-emerald-50 border-emerald-200 text-emerald-700'
											: r.status === 'soon'
												? 'bg-amber-50 border-amber-200 text-amber-700'
												: 'bg-gray-50 border-gray-200 text-gray-500'
									}`}
								>
									{r.status === 'active' ? '✓ granted' : r.status === 'soon' ? 'coming soon' : 'planned'}
								</span>
							</div>
							<p className="text-xs text-gray-500 mt-0.5">{r.description}</p>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function Footnote() {
	return (
		<div className="text-xs text-gray-500 space-y-1">
			<div>
				After installation, try in Claude Code:{' '}
				<code className="bg-gray-100 rounded px-1.5 py-0.5">/lumid competitions</code>
			</div>
			<div>
				Manage or revoke tokens at{' '}
				<Link to="/account/tokens" className="text-indigo-500 hover:underline">
					/account/tokens
				</Link>
				. Every authenticated request is logged per-token.
			</div>
			<div>
				Having trouble?{' '}
				<a href="#" className="text-indigo-500 hover:underline inline-flex items-center gap-1">
					Troubleshooting guide <ExternalLink className="w-3 h-3" />
				</a>
				<ChevronRight className="w-3 h-3 inline text-gray-300 ml-1" />
			</div>
		</div>
	);
}
