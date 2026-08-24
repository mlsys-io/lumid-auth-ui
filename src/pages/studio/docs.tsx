// /studio/docs — the Documentation panel inside the Studio shell.
//
// One index over the guides/runbooks the platform ships, with an in-shell
// markdown reader at /studio/docs/:slug. The markdown sources are the same
// files the standalone /docs/* routes render (public/docs/*.md) — this page
// doesn't fork content, it gathers it behind the side panel.
//
// NOT EVERY DOC IS INDEXED HERE, and two deliberate omissions (2026-08-21):
//   * the xpio autoresearch contract — /docs/xpio-autoresearch stays LIVE and
//     public (anonymous forkers need it, /proj/CLAUDE.md and a pile of
//     xpcloud.yaml headers link to it, and super-admin deep-links an anchor
//     into it). Only the Studio index card was dropped.
//   * "How Lumid works" — /studio/docs/how still renders and /studio/how
//     still redirects to it, so existing links keep working; it is simply no
//     longer surfaced on the index.
// Re-adding either is a DOCS entry / a <Link>, nothing more.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'github-markdown-css/github-markdown-light.css';
import {
	BookOpen, Zap, FileCode2, Activity, CandlestickChart, Compass, ArrowLeft, Loader2, Cpu, Database, TerminalSquare, Bot,
} from 'lucide-react';
import StudioHow from './how';

interface DocEntry {
	slug: string;
	title: string;
	description: string;
	md: string;            // path under /docs/ (public assets)
	group: 'Guides' | 'Contracts' | 'Runbooks';
	icon: React.ComponentType<{ className?: string }>;
	standalone?: string;   // legacy full-page route, kept for deep links
	companion?: { to: string; label: string }; // live surface this doc documents
}

const DOCS: DocEntry[] = [
	{
		// First on the list on purpose: it is the only doc that assumes you have
		// never logged in, and every other Guide here reads better after it.
		slug: 'first-run',
		title: 'First run: signup to a working strategy',
		description: 'The actual path, walked end to end as a plain user account — signup, your first token, chat, Claude Code, data, strategies. Records what misled, not just what worked.',
		md: 'first-run.md',
		group: 'Guides',
		icon: Compass,
		companion: { to: '/studio/docs/deepseek', label: 'Your model' },
	},
	{
		slug: 'deepseek',
		title: 'Your model: deepseek-v4-flash',
		description: 'The model you are actually on, and it is unlimited. The one timeout setting that matters, why the first turn is slow, and what "unlimited" does and does not mean.',
		md: 'deepseek.md',
		group: 'Guides',
		icon: Bot,
		companion: { to: '/studio/docs/claude', label: 'Client setup' },
	},
	{
		slug: 'claude',
		title: 'Claude account pool (deprecated)',
		description: 'DEPRECATED — the pool is no longer the path; see "Your model" first. Retained for Claude Code client setup, the role/model matrix, and session recording.',
		md: 'claude_pool.md',
		group: 'Guides',
		icon: Zap,
		standalone: '/docs/claude',
		companion: { to: '/code', label: 'Quota dashboard' },
	},
	{
		slug: 'lqt-strategies',
		title: 'LQT strategies',
		description: 'Write & submit a prediction-market trading strategy — DSL, compile pipeline, canary lanes, telemetry.',
		md: 'lqt-strategies.md',
		group: 'Guides',
		icon: CandlestickChart,
		standalone: '/docs/lqt-strategies',
		companion: { to: '/studio/strategies', label: 'Your strategies' },
	},
	{
		slug: 'trading-api',
		title: 'Trading API',
		description: 'QuantArena order-submission API reference — auth headers, endpoints, symbols, market hours.',
		md: 'TRADING_API.md',
		group: 'Guides',
		icon: Activity,
	},
	{
		slug: 'findata-sql',
		title: 'FinData SQL access',
		description: 'Query the FinData warehouse with real SQL — mint your own credential, psql/DBeaver/DuckDB, verify-full TLS, read-only guardrails, schema orientation.',
		md: 'findata-sql.md',
		group: 'Guides',
		icon: Database,
		// The doc explains the warehouse; the panel is the only way to get a
		// credential for it. Without this link the two never referenced each
		// other, so reading the guide left you to go find the mint page.
		companion: { to: '/studio/account/findata-sql', label: 'Mint a credential' },
	},
	{
		slug: 'fm-ll-queries',
		title: 'FlowMesh & Lumilake queries',
		description: 'Example compute queries for the two pillars — chatbox prompts, MCP tools, and raw proxy HTTP. List workers, submit jobs, HALO-optimize & run workflows.',
		md: 'fm-ll-example-queries.md',
		group: 'Guides',
		icon: Cpu,
	},
	{
		slug: 'flowmesh-ssh',
		title: 'FlowMesh SSH tasks',
		description: 'Get an interactive shell on a GPU/CPU worker — forward vs proxy access, per-site port ranges, the task spec, and the failure modes worth recognising.',
		md: 'flowmesh-ssh.md',
		group: 'Guides',
		icon: TerminalSquare,
		companion: { to: '/studio/docs/fm-ll-queries', label: 'FlowMesh queries' },
	},
	{
		slug: 'operations',
		title: 'Operations runbook',
		description: 'Whole-stack health probe — the 17 dimensions, what each check means, and how to respond when one goes red.',
		md: 'operations.md',
		group: 'Runbooks',
		icon: Compass,
		standalone: '/docs/operations',
		companion: { to: '/status/operations', label: 'Live status' },
	},
	{
		slug: 'plugin-image-cd',
		title: 'Plugin-image CD',
		description: 'Shipping plugin-baked images for Lumilake & FlowMesh — build, digest-pin, Argo roll, GPU-fleet per-box recipe.',
		md: 'plugin-image-cd.md',
		group: 'Runbooks',
		icon: FileCode2,
		standalone: '/docs/plugin-image-cd',
	},
];

const GROUP_ORDER: DocEntry['group'][] = ['Guides', 'Contracts', 'Runbooks'];
// Only groups that actually have entries — otherwise removing the last doc in a
// group leaves a heading over an empty grid (which is how 'Contracts' looked the
// moment the xpio card was dropped).
const GROUPS = GROUP_ORDER.filter((g) => DOCS.some((d) => d.group === g));

function DocIndex() {
	return (
		<div className="max-w-3xl mx-auto px-6 py-8">
			<header className="mb-6">
				<h1 className="text-lg font-medium flex items-center gap-2">
					<BookOpen className="w-4 h-4 text-gold-600" />
					Documentation
				</h1>
				<p className="text-xs text-slate-400 mt-1">
					Guides, contracts, and runbooks for the Lumid platform.
				</p>
			</header>
			{GROUPS.map((g) => (
				<section key={g} className="mb-6">
					<h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">{g}</h2>
					<div className="grid gap-2 sm:grid-cols-2">
						{DOCS.filter((d) => d.group === g).map((d) => (
							<Link
								key={d.slug}
								to={`/studio/docs/${d.slug}`}
								className="group rounded-lg border border-slate-200 bg-white p-3.5 hover:border-gold-300 hover:shadow-sm transition"
							>
								<div className="flex items-center gap-2 mb-1">
									<d.icon className="w-4 h-4 text-foreground/45 group-hover:text-gold-600 transition-colors" />
									<span className="text-sm font-medium text-slate-800">{d.title}</span>
								</div>
								<p className="text-xs text-slate-500 leading-relaxed">{d.description}</p>
							</Link>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

function DocReader({ doc }: { doc: DocEntry }) {
	const [markdown, setMarkdown] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		setMarkdown('');
		setError('');
		fetch(`/docs/${doc.md}?v=${import.meta.env.VITE_APP_VERSION ?? Date.now()}`, { cache: 'no-store' })
			.then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
			.then(setMarkdown)
			.catch((e) => setError(String(e)));
	}, [doc.md]);

	return (
		<div className="max-w-4xl mx-auto px-6 py-6">
			<div className="text-xs text-muted-foreground mb-4 flex items-center justify-between gap-3">
				<Link to="/studio/docs" className="inline-flex items-center gap-1 text-slate-500 hover:text-gold-700">
					<ArrowLeft className="w-3.5 h-3.5" /> All docs
				</Link>
				<span className="flex items-center gap-3">
					{doc.companion && (
						<Link to={doc.companion.to} className="text-gold-700 hover:underline">
							{doc.companion.label} →
						</Link>
					)}
					<a href={`/docs/${doc.md}`} download className="text-gold-700 hover:underline">
						Download .md →
					</a>
				</span>
			</div>
			{error ? (
				<div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
					<div className="font-medium mb-1">Doc unavailable</div>
					<div className="text-xs">This documentation is temporarily unavailable ({error}). Please try again in a moment.</div>
				</div>
			) : !markdown ? (
				<div className="text-sm text-slate-500 italic flex items-center gap-2">
					<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
				</div>
			) : (
				<article className="markdown-body" style={{ background: 'transparent' }}>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
				</article>
			)}
		</div>
	);
}

export default function StudioDocs() {
	const { slug } = useParams<{ slug?: string }>();
	// "how" is the interactive tour (a React page, not markdown) — render it
	// inside the docs chrome so it reads as part of the same collection.
	if (slug === 'how') {
		return (
			<div className="max-w-4xl mx-auto px-6 py-6">
				<Link to="/studio/docs" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-gold-700 mb-4">
					<ArrowLeft className="w-3.5 h-3.5" /> All docs
				</Link>
				<StudioHow />
			</div>
		);
	}
	const doc = slug ? DOCS.find((d) => d.slug === slug) : undefined;
	if (slug && !doc) {
		return (
			<div className="max-w-3xl mx-auto px-6 py-8 text-sm text-slate-500">
				Unknown doc "{slug}". <Link to="/studio/docs" className="text-gold-700 hover:underline">Back to all docs</Link>.
			</div>
		);
	}
	return doc ? <DocReader doc={doc} /> : <DocIndex />;
}
