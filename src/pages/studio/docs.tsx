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
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'github-markdown-css/github-markdown-light.css';
import {
	BookOpen, Zap, FileCode2, Activity, CandlestickChart, Compass, ArrowLeft, Loader2, Cpu, Database, TerminalSquare, Bot, GraduationCap, Server, Workflow,
} from 'lucide-react';
import StudioHow from './how';
import { useAuth } from '../../hooks/useAuth';
import { Loading } from '../../components/ui/loading';

interface DocEntry {
	slug: string;
	title: string;
	description: string;
	md: string;            // path under /docs/ (public assets)
	group: 'Guides' | 'Contracts' | 'Runbooks';
	icon: React.ComponentType<{ className?: string }>;
	standalone?: string;   // legacy full-page route, kept for deep links
	companion?: { to: string; label: string }; // live surface this doc documents
	// Dropped from the index grid but still renderable at /studio/docs/:slug.
	// The earlier omissions (xpio, "how") were done by deleting the DOCS entry,
	// which works only because those two have routes of their own; for a
	// markdown doc the entry IS the route, so hiding has to be a flag.
	hidden?: boolean;
	// (Admin+) docs — hidden from the index for non-admins and their reader
	// route redirects them away. UX only: the real gate is auth_request on
	// the /docs/<file> location in lum-id-landing.conf, without which the raw
	// markdown would stay publicly fetchable.
	adminOnly?: boolean;
}

const DOCS: DocEntry[] = [
	{
		// First on the list on purpose: it is the only doc that assumes you have
		// never logged in, and every other Guide here reads better after it.
		slug: 'first-run',
		title: 'Quant Research Onboarding',
		description: 'The actual path, walked end to end as a plain user account — your first token, chat, installing the Quant Research app, and writing, deploying and reading a strategy. Records what misled, not just what worked.',
		md: 'first-run.md',
		group: 'Guides',
		icon: Compass,
		companion: { to: '/studio/docs/coding', label: 'AI coding' },
	},
	{
		// Placed after the two onboarding walkthroughs: it assumes you already
		// have an app open, and it is the only doc that covers the WRITE side of
		// the control plane (defining, adding an arm, dispatching) rather than
		// reading a surface.
		//
		// Absorbed the former `workflow-editor` page (2026-09-20). They were always
		// one story split in two — what a workflow IS and how to measure it, then
		// the surface you build it on — and the old entry said so in this comment.
		slug: 'workflows',
		title: 'Workflows and experiments',
		description: 'What separates a workflow from an experiment, how to define one, read its status, harvest a result, and drive the whole loop from the chatbox. Then the canvas you build one on: all five dialects, what each edge style means, and what the importer drops. Two worked examples, one of them deliberately NOT concluding.',
		md: 'workflows.md',
		group: 'Guides',
		icon: Activity,
		companion: { to: '/studio/apps/mbb-consultant?surface=experiments', label: 'Experiments tab' },
	},
	{
		// RETIRED 2026-09-20 — this page WAS `experiments`; it absorbed
		// `workflow-editor` and now lives at `workflows`.
		//
		// The alias exists because the rename dropped the old slug entirely,
		// which 404s every bookmark and every external link to
		// /studio/docs/experiments. The four other retirements got an alias;
		// this one was a RENAME and so quietly did not, which is the easier
		// mistake to make and the harder one to notice — nothing inside the
		// repo linked to it, so no internal check caught it.
		slug: 'experiments',
		title: 'Workflows and experiments',
		description: 'Moved to /studio/docs/workflows.',
		md: 'workflows.md',
		group: 'Guides',
		icon: Activity,
		hidden: true,
	},
	{
		// RETIRED 2026-09-20 — merged into `workflows`. Kept as a hidden alias,
		// not deleted: for a markdown doc the ENTRY IS THE ROUTE, so removing it
		// 404s every link already in the wild. Same pattern as the `deepseek`
		// alias below.
		slug: 'workflow-editor',
		title: 'The workflow canvas',
		description: 'Merged into /studio/docs/workflows.',
		md: 'workflows.md',
		group: 'Guides',
		icon: Workflow,
		hidden: true,
	},
	{
		// RETIRED 2026-09-20 — folded into `first-run` as the AI Consulting
		// track. Hidden alias rather than a deletion: the entry IS the route for a
		// markdown doc, and first-run.md itself linked here.
		slug: 'mbb-consultant',
		title: 'AI Consulting Onboarding',
		description: 'Folded into /studio/docs/first-run.',
		md: 'first-run.md',
		group: 'Guides',
		icon: GraduationCap,
		hidden: true,
	},
	{
		// slug is 'coding', not 'deepseek': the page is about AI coding as a
		// capability and now documents TWO models, so naming the URL after one of
		// them aged badly the moment a second arrived. The old slug is kept below
		// as a hidden alias -- for a markdown doc the ENTRY IS THE ROUTE, so
		// deleting it would 404 every link already in the wild, including the one
		// in first-run.md and anything a user bookmarked.
		slug: 'coding',
		title: 'AI coding',
		description: 'The model you are actually on, and it is unlimited. The one timeout setting that matters, why the first turn is slow, and what "unlimited" does and does not mean.',
		md: 'coding.md',
		group: 'Guides',
		icon: Bot,
		companion: { to: '/studio/docs/claude', label: 'Client setup' },
	},
	{
		// Back-compat alias for /studio/docs/deepseek. Hidden from the index grid
		// but still renderable, so existing links keep resolving to the same page.
		slug: 'deepseek',
		title: 'AI coding',
		description: 'Renamed to /studio/docs/coding.',
		md: 'coding.md',
		group: 'Guides',
		icon: Bot,
		hidden: true,
	},
	{
		slug: 'claude',
		title: 'Claude account pool (Admin+)',
		description: 'Pooled Anthropic accounts — Sonnet/Haiku for admin, Opus/Fable for super_admin. Claude Code client setup, the role/model matrix, per-user pool quota, and session recording. Everyone else wants "AI coding" first.',
		md: 'claude_pool.md',
		group: 'Guides',
		icon: Zap,
		adminOnly: true,
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
		// Split out of first-run 2026-08-29: 138 lines of producer tutorial that
		// arrived before the reader had deployed anything. It is the natural
		// SECOND project, so it reads better as its own page with a pointer left
		// behind — not as a digression inside the walkthrough.
		slug: 'lqt-signals',
		title: 'Producing your own signal',
		description: 'The other half of a strategy: when no one publishes the signal you need. An LLM reading news, end to end — what the signal is, where the code runs, and what it costs.',
		md: 'lqt-signals.md',
		group: 'Guides',
		icon: Bot,
		companion: { to: '/studio/docs/first-run', label: 'Onboarding' },
	},
	{
		slug: 'trading-api',
		title: 'Trading API',
		description: 'QuantArena order-submission API reference — auth headers, endpoints, symbols, market hours.',
		md: 'TRADING_API.md',
		group: 'Guides',
		icon: Activity,
		// Hidden from the index, route kept alive for existing deep links.
		hidden: true,
	},
	{
		// Placed before findata-sql and flowmesh-ssh deliberately: this is the
		// doc for the surface most people reach for first, and both of those
		// read as follow-ups to it rather than the other way round.
		slug: 'sandboxes',
		title: 'Sandboxes — a shell on the fleet',
		description: 'Rent a container on real hardware with a home directory that outlives it — SSH keys first, the per-machine GPU ceiling, datasets vs attached sources, querying FinData without copying it, and what survives a delete.',
		md: 'sandboxes.md',
		group: 'Guides',
		icon: TerminalSquare,
		companion: { to: '/studio/research-fleet/sandboxes', label: 'Rent a sandbox' },
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
		// RETIRED 2026-09-20 — merged into `compute`, which is Admin+. That is
		// not a demotion: /fm and /ll are BOTH admin-gated at the edge (a
		// non-admin PAT measured 403 on each), so this page's "a normal user
		// PAT is enough" premise was false and every example under its
		// "verified" heading was unrunnable for the audience it addressed. The
		// genuinely public half — the chatbox/MCP path and the per-caller
		// /me/compute/jobs routes — moved to `workflows`, not behind the gate.
		slug: 'fm-ll-queries',
		title: 'FlowMesh & Lumilake queries',
		description: 'Merged into /studio/docs/compute.',
		md: 'lumilake-flowmesh.md',
		group: 'Guides',
		icon: Cpu,
		adminOnly: true,
		hidden: true,
	},
	{
		slug: 'flowmesh-ssh',
		title: 'FlowMesh SSH tasks',
		description: 'Get an interactive shell on a GPU/CPU worker — forward vs proxy access, per-site port ranges, the task spec, and the failure modes worth recognising.',
		md: 'flowmesh-ssh.md',
		group: 'Guides',
		icon: TerminalSquare,
		companion: { to: '/studio/docs/compute', label: 'Running jobs on the fleet' },
	},
	{
		slug: 'infrastructure-setup',
		title: 'Onboarding a GPU box (Admin+)',
		description: 'The three layers a new node needs — registry, FlowMesh runtime, and self-heal — what happens automatically, and the failure modes where one layer is done and the other two are not.',
		md: 'infrastructure-setup.md',
		group: 'Runbooks',
		icon: Server,
		adminOnly: true,
		// The bootstrap-token minter is a LIVE tool and cannot be markdown, so the
		// page survives at /studio/admin/infra-setup and §3 links to it. Converting
		// the guide without keeping that would have deleted a working capability.
		companion: { to: '/studio/compute', label: 'Compute fleet' },
	},
	{
		// Both halves of one story on purpose: the contract a workflow author
		// needs, then the demo as the worked example. Splitting them would
		// separate the constraints (model architecture, pixel rank, per-JOB
		// hardware) from the only place they are observable — a real run.
		//
		// Admin+ because it names the office lane's GPUs, the deployment env
		// the endpoints come from, and how to pull FlowMesh task logs. NOTE its
		// screenshots are gated by a SEPARATE nginx block keyed on the
		// `lumilake-flowmesh-` filename prefix: the admin regex matches `.md`
		// only, so before that block an Admin+ doc's images were public.
		// RENAMED to `compute` 2026-09-20, absorbing the retired `fm-ll-queries`.
		//
		// The FILE deliberately keeps its old name. The nginx Admin+ gate is a
		// filename regex (`^/docs/(…|lumilake-flowmesh)\.md$`, plus a second
		// block for its images), and `adminOnly` here only hides the card and
		// redirects the reader route — it does not protect the asset. Renaming
		// the .md would serve this page to anyone who guessed the new filename.
		//
		// That is not hypothetical: this gate already shipped broken once, by
		// bumping one of lumid-landing's TWO ConfigMap volumes while the other
		// still served the old config — Argo read Synced/Healthy and anonymous
		// curl still returned 200. Not worth re-opening for a tidier filename.
		slug: 'compute',
		title: 'Running jobs on the fleet (Admin+)',
		description: 'FlowMesh and Lumilake end to end: the surface and who can call it, the native workflow dialect, the model and hardware constraints that fail with errors naming neither, how to read a running job, and vla-curation as the worked example with its runbook.',
		md: 'lumilake-flowmesh.md',
		group: 'Runbooks',
		icon: Cpu,
		adminOnly: true,
		companion: { to: '/studio/a/vla-curation', label: 'The demo' },
	},
	{
		// Back-compat alias for the pre-rename slug.
		slug: 'lumilake-flowmesh',
		title: 'Lumilake + FlowMesh workflows (Admin+)',
		description: 'Renamed to /studio/docs/compute.',
		md: 'lumilake-flowmesh.md',
		group: 'Runbooks',
		icon: Cpu,
		adminOnly: true,
		hidden: true,
	},
	{
		slug: 'operations',
		title: 'Operations runbook (Admin+)',
		description: 'Whole-stack health probe — the 17 dimensions, what each check means, and how to respond when one goes red.',
		md: 'operations.md',
		group: 'Runbooks',
		icon: Compass,
		adminOnly: true,
		standalone: '/docs/operations',
		companion: { to: '/status/operations', label: 'Live status' },
	},
	{
		slug: 'plugin-image-cd',
		title: 'Plugin-image CD (Admin+)',
		description: 'Shipping plugin-baked images for Lumilake & FlowMesh — build, digest-pin, Argo roll, GPU-fleet per-box recipe.',
		md: 'plugin-image-cd.md',
		group: 'Runbooks',
		icon: FileCode2,
		adminOnly: true,
		standalone: '/docs/plugin-image-cd',
	},
];

const GROUP_ORDER: DocEntry['group'][] = ['Guides', 'Contracts', 'Runbooks'];
// What the index renders. Hidden docs stay in DOCS so their reader route still
// resolves; they simply never get a card. adminOnly docs additionally drop off
// the index for non-admin users — useAuth resolves by the time the index
// renders (StudioShell is already behind AuthGuard), so no isLoading branch is
// needed here.
const INDEXED = DOCS.filter((d) => !d.hidden);
// Only groups that actually have entries — otherwise removing the last doc in a
// group leaves a heading over an empty grid (which is how 'Contracts' looked the
// moment the xpio card was dropped). Computed over INDEXED so hiding the last
// doc in a group drops its heading too.
const GROUPS = GROUP_ORDER.filter((g) => INDEXED.some((d) => d.group === g));

// Live surfaces, not documents — they belong on this page because "where do I
// actually go to use this" is the question the index otherwise leaves hanging.
// Absolute hrefs: these are served by lumid-landing, not by the SPA router.
const RESOURCES: { href: string; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
	{
		href: '/llm',
		label: 'lum.id/llm',
		description: 'The in-house LLM gateway — OpenAI- and Anthropic-shaped endpoints, and the models that are actually routable.',
		icon: Bot,
	},
	{
		href: '/findata',
		label: 'lum.id/findata',
		description: 'The FinData warehouse surface — catalog, lineage and the read APIs behind the market datasets.',
		icon: Database,
	},
];

function DocIndex() {
	const { user } = useAuth();
	const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
	const visible = INDEXED.filter((d) => !d.adminOnly || isAdmin);
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
			{GROUPS.filter((g) => visible.some((d) => d.group === g)).map((g) => (
				<section key={g} className="mb-6">
					<h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">{g}</h2>
					<div className="grid gap-2 sm:grid-cols-2">
						{visible.filter((d) => d.group === g).map((d) => (
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
			<section className="mb-6">
				<h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Resources</h2>
				<div className="grid gap-2 sm:grid-cols-2">
					{RESOURCES.map((r) => (
						<a
							key={r.href}
							href={r.href}
							className="group rounded-lg border border-slate-200 bg-white p-3.5 hover:border-gold-300 hover:shadow-sm transition"
						>
							<div className="flex items-center gap-2 mb-1">
								<r.icon className="w-4 h-4 text-foreground/45 group-hover:text-gold-600 transition-colors" />
								<span className="text-sm font-medium text-slate-800">{r.label}</span>
							</div>
							<p className="text-xs text-slate-500 leading-relaxed">{r.description}</p>
						</a>
					))}
				</div>
			</section>
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
				<article className="markdown-body docs-md" style={{ background: 'transparent' }}>
					{/* github-markdown-css caps images at 100% of the column, which on a
					    wide screen renders every screenshot larger than the prose it
					    illustrates. Cap them and centre them so they read as figures. */}
					<style>{`
						.docs-md img {
							display: block;
							margin: 1.25rem auto;
							max-width: min(560px, 100%);
							height: auto;
							border: 1px solid #d0d7de;
							border-radius: 6px;
						}
					`}</style>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
				</article>
			)}
		</div>
	);
}

export default function StudioDocs() {
	const { slug } = useParams<{ slug?: string }>();
	const { user, isLoading } = useAuth();
	const found = slug ? DOCS.find((d) => d.slug === slug) : undefined;
	// (Admin+) docs redirect non-admins. isLoading short-circuits first so a
	// user whose profile hasn't landed yet isn't bounced by mistake — same
	// ordering AdminGuard uses.
	if (found?.adminOnly && isLoading) return <Loading fullScreen />;
	if (found?.adminOnly && user?.role !== 'admin' && user?.role !== 'super_admin') {
		return <Navigate to="/studio/docs" replace />;
	}
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
