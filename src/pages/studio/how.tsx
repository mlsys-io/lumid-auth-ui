// /studio/how — "How Lumid works": a walkable illustration of the loop
// every intent runs through — Stage 1 (Assemble) and Stage 2 (Adapt &
// improve), demoed against real demo intents.
//
// Data comes from lib/demo-intents (the same registry the Intents surface
// uses), so this page stays in sync with the live demo without duplicating
// copy. Use cases = the demo intents that declare an `assembly` (Stage 1).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Boxes, Sparkles, ArrowRight, ArrowDown, Wand2, Package,
	TrendingUp, Library, ChevronRight, Lightbulb, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
	DEMO_INTENTS, AXIS_META, type DemoIntent, type AssemblyPiece,
} from '@/lib/demo-intents';

const USE_CASES = DEMO_INTENTS.filter((i) => i.assembly && i.assembly.length > 0);

export default function StudioHow() {
	const [sel, setSel] = useState(0);
	const intent = USE_CASES[sel];

	return (
		<div className="max-w-4xl mx-auto px-1 py-2 space-y-6">
			{/* Header */}
			<header>
				<h1 className="text-xl font-medium text-slate-900 tracking-tight">How Lumid works</h1>
				<p className="text-sm text-slate-600 mt-1 leading-relaxed max-w-2xl">
					Every app runs the same loop: you say what you want; Lumid <strong>assembles</strong> it,
					then <strong>adapts &amp; improves</strong> it — more valuable every run.
				</p>
			</header>

			{/* Glossary — the four words Studio uses everywhere */}
			<GlossaryStrip />

			{/* Flywheel — the stages */}
			<Flywheel />

			{/* Use-case switcher */}
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-[11px] tracking-[0.08em] font-medium text-slate-400 mr-1">Walk a use case</span>
				{USE_CASES.map((u, i) => (
					<button
						key={u.id}
						onClick={() => setSel(i)}
						className={cn(
							'px-3 py-1.5 rounded-lg text-[12px] border transition-all',
							i === sel
								? 'bg-gold-50 border-gold-200 text-gold-900 font-medium shadow-sm'
								: 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900',
						)}
					>
						{u.persona}
					</button>
				))}
			</div>

			{/* The goal being walked */}
			<div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50 via-white to-slate-50 p-4">
				<div className="text-[11px] text-slate-400 mb-0.5">the goal</div>
				<div className="text-[15px] text-slate-900 font-medium leading-snug">“{intent.title}”</div>
			</div>

			{/* Stage 1 — Assemble */}
			<StagePanel n={1} label="Assemble" tone="emerald" icon={Boxes}
				caption="Given your goal, Lumid assembles your app — pulling proven pieces from your workspace and generating the rest with AI.">
				<AssembleBody assembly={intent.assembly!} />
			</StagePanel>

			<StepArrow />

			{/* Stage 2 — Adapt */}
			<StagePanel n={2} label="Adapt & improve" tone="sky" icon={Sparkles}
				caption="Then it adapts to you — autoresearching and aligning to your specific goal so it gets more valuable every run.">
				<AdaptBody intent={intent} />
			</StagePanel>
		</div>
	);
}

// ── Glossary strip — one row of definition chips ───────────────────

const GLOSSARY: Array<[term: string, def: string]> = [
	['App', 'what you install or create; it has a page and does work for you'],
	['Workflow', 'a scheduled job inside an app'],
	['Run', 'one execution of a workflow'],
	['Skill', 'a capability apps use (email, market data, …)'],
];

function GlossaryStrip() {
	return (
		<div className="flex flex-wrap gap-2">
			{GLOSSARY.map(([term, def]) => (
				<div key={term} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] leading-snug">
					<span className="font-medium text-slate-900">{term}</span>
					<span className="text-slate-500"> — {def}</span>
				</div>
			))}
		</div>
	);
}

// ── Flywheel diagram ───────────────────────────────────────────────

function Flywheel() {
	const nodes = [
		{ icon: Boxes,    label: 'Assemble',        sub: 'workspace + AI',       tone: 'emerald' as const },
		{ icon: Sparkles, label: 'Adapt & improve', sub: 'autoresearch · align', tone: 'sky' as const },
	];
	return (
		<div className="rounded-2xl border border-slate-200/70 bg-white p-4">
			<div className="flex items-stretch gap-2">
				{nodes.map((nd, i) => (
					<div key={nd.label} className="flex items-stretch gap-2 flex-1">
						<div className={cn(
							'flex-1 rounded-xl border px-3 py-3 flex flex-col items-center text-center gap-1.5',
							nd.tone === 'emerald' && 'border-gold-200 bg-gold-50/50',
							nd.tone === 'sky' && 'border-sky-200 bg-sky-50/50',
							nd.tone === 'indigo' && 'border-indigo-200 bg-indigo-50/50',
							nd.tone === 'muted' && 'border-dashed border-slate-200 bg-slate-50/40',
						)}>
							<div className={cn(
								'w-8 h-8 rounded-lg flex items-center justify-center',
								nd.tone === 'emerald' && 'bg-gold-100 text-gold-700',
								nd.tone === 'sky' && 'bg-sky-100 text-sky-700',
								nd.tone === 'indigo' && 'bg-indigo-100 text-indigo-700',
								nd.tone === 'muted' && 'bg-slate-100 text-slate-400',
							)}>
								<nd.icon className="w-4 h-4" />
							</div>
							<div className="flex items-center gap-1.5">
								<span className="text-[10px] tabular-nums text-slate-400">{i + 1}</span>
								<span className={cn('text-[13px] font-medium', nd.tone === 'muted' ? 'text-slate-500' : 'text-slate-900')}>{nd.label}</span>
							</div>
							<div className="text-[10px] text-slate-400 leading-tight">{nd.sub}</div>
							{nd.tone === 'muted' && (
								<span className="text-[9px] uppercase tracking-wide text-slate-400 border border-slate-200 rounded-full px-1.5 py-px mt-0.5">exploring</span>
							)}
						</div>
						{i < nodes.length - 1 && (
							<div className="flex items-center text-slate-300"><ArrowRight className="w-4 h-4" /></div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

// ── Stage panel shell ──────────────────────────────────────────────

function StagePanel({
	n, label, tone, icon: Icon, caption, children, open,
}: {
	n: number; label: string; tone: 'emerald' | 'sky' | 'indigo' | 'muted';
	icon: React.ComponentType<{ className?: string }>;
	caption: string; children: React.ReactNode; open?: boolean;
}) {
	return (
		<section className={cn(
			'rounded-2xl border bg-white overflow-hidden',
			open ? 'border-dashed border-slate-200' : 'border-slate-200/70',
		)}>
			<div className="px-4 pt-3.5 pb-3 flex items-start gap-3">
				<div className={cn(
					'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
					tone === 'emerald' && 'bg-gold-100 text-gold-700',
					tone === 'sky' && 'bg-sky-100 text-sky-700',
					tone === 'indigo' && 'bg-indigo-100 text-indigo-700',
					tone === 'muted' && 'bg-slate-100 text-slate-400',
				)}>
					<Icon className="w-4 h-4" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[11px] tabular-nums text-slate-400">Stage {n}</span>
						<h2 className={cn('text-[15px] font-medium', tone === 'muted' ? 'text-slate-500' : 'text-slate-900')}>{label}</h2>
					</div>
					<p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{caption}</p>
				</div>
			</div>
			<div className="px-4 pb-4">{children}</div>
		</section>
	);
}

function StepArrow() {
	return (
		<div className="flex justify-center -my-3 relative z-[1]">
			<div className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300">
				<ArrowDown className="w-3.5 h-3.5" />
			</div>
		</div>
	);
}

// ── Stage 1 body — the assembled pieces, source-tagged ─────────────

function AssembleBody({ assembly }: { assembly: AssemblyPiece[] }) {
	const ws = assembly.filter((p) => p.source === 'workspace').length;
	const ai = assembly.filter((p) => p.source === 'ai').length;
	return (
		<div className="space-y-2.5">
			<div className="flex items-center gap-3 text-[11px] text-slate-500">
				<span className="inline-flex items-center gap-1"><Package className="w-3.5 h-3.5 text-slate-400" />{ws} from your workspace</span>
				<span className="inline-flex items-center gap-1"><Wand2 className="w-3.5 h-3.5 text-gold-500" />{ai} generated by AI</span>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{assembly.map((p) => (
					<div key={p.name} className="rounded-lg border border-slate-200/70 bg-white px-3 py-2 flex items-start gap-2.5">
						<div className={cn(
							'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
							p.source === 'ai' ? 'bg-gold-50 text-gold-600' : 'bg-slate-100 text-slate-500',
						)}>
							{p.source === 'ai' ? <Wand2 className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5">
								<span className="text-[13px] font-medium text-slate-900 leading-tight">{p.name}</span>
								<span className={cn(
									'text-[9px] uppercase tracking-wide rounded-full px-1.5 py-px border',
									p.source === 'ai'
										? 'text-gold-700 bg-gold-50 border-gold-100'
										: 'text-slate-500 bg-slate-50 border-slate-200',
								)}>{p.source === 'ai' ? 'AI' : 'workspace'}</span>
							</div>
							{p.role && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{p.role}</div>}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

// ── Stage 2 body — what adapted, + deep-dive link ──────────────────

function AdaptBody({ intent }: { intent: DemoIntent }) {
	const deltas = (intent.detail?.stats ?? []).filter((s) => s.delta);
	const narrative = intent.detail?.narrative ?? [];
	return (
		<div className="space-y-3">
			{/* Key deltas — the "more value" made measurable */}
			{deltas.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{deltas.map((s) => (
						<div key={s.label} className="rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-1.5">
							<div className="text-[10px] text-slate-500">{s.label}</div>
							<div className="text-[14px] font-medium text-slate-900 leading-none mt-0.5">{s.value}</div>
							<div className="text-[10px] text-gold-700 mt-0.5 inline-flex items-center gap-0.5">
								<TrendingUp className="w-3 h-3" />{s.delta}
							</div>
						</div>
					))}
				</div>
			)}

			{/* What it learned — narrative bullets tagged by axis */}
			<div className="text-[11px] text-slate-400 leading-snug">
				Each improvement is tagged by what it tuned — its axis:
			</div>
			<ul className="space-y-1.5">
				{narrative.map((b, i) => {
					const meta = AXIS_META[b.axis];
					return (
						<li key={i} className="flex items-start gap-2.5 text-[13px] text-slate-700">
							<span className={cn('mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-medium flex-shrink-0', meta?.tone)}>
								{meta?.label ?? b.axis}
							</span>
							<span className="flex-1 min-w-0 leading-snug">{b.text}</span>
						</li>
					);
				})}
			</ul>

			{intent.detail && (
				<Link
					to={`/studio/intents/${intent.id}`}
					className="inline-flex items-center gap-1 text-[12px] text-gold-700 hover:text-gold-800 hover:underline"
				>
					See the full adaptation <ArrowRight className="w-3.5 h-3.5" />
				</Link>
			)}
		</div>
	);
}

// ── Stage 3 body — the spot-wise Compound offer ────────────────────
// At a decision spot, accumulated knowledge is recalled and offered as
// extra knowledge / a skill / a workflow. Binds to the real
// `summary.offers` shape when present; otherwise renders a sensible
// illustrative offer derived from the intent being walked.

// Mirrors summary.offers[] from the cycle/journal contract — every
// field optional so old cycles (no offers) render gracefully.
interface CompoundOffer {
	id?: string;
	trigger?: { kind: 'pattern' | 'principle'; key: string; count: number };
	kind: 'knowledge' | 'skill' | 'workflow';
	title: string;
	detail?: string;
	action?: { type: string; spec?: unknown; schedule?: string };
}

const OFFER_KIND_META: Record<CompoundOffer['kind'], { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; iconTone: string }> = {
	knowledge: { label: 'extra knowledge', icon: Lightbulb, tone: 'border-gold-200 bg-gold-50/40',   iconTone: 'bg-gold-100 text-gold-700' },
	skill:     { label: 'a skill',         icon: Wand2,     tone: 'border-gold-200 bg-gold-50/40', iconTone: 'bg-gold-100 text-gold-700' },
	workflow:  { label: 'a workflow',      icon: Workflow,  tone: 'border-indigo-200 bg-indigo-50/40',   iconTone: 'bg-indigo-100 text-indigo-700' },
	experiment: { label: 'an experiment verdict', icon: Lightbulb, tone: 'border-violet-200 bg-violet-50/40', iconTone: 'bg-violet-100 text-violet-700' },
};

function CompoundBody({ intent }: { intent: DemoIntent }) {
	const offers = illustrativeOffers(intent);
	return (
		<div className="space-y-3">
			<div className="text-[11px] text-slate-500 leading-relaxed">
				When a similar spot comes up again, Lumid recalls what compounded and
				offers it inline — <span className="italic">&ldquo;this looks like a prior occurrence — last time this worked — do this.&rdquo;</span>
			</div>

			<div className="space-y-2">
				{offers.map((o, i) => {
					const meta = OFFER_KIND_META[o.kind];
					const Icon = meta.icon;
					return (
						<div key={o.id || i} className={cn('rounded-lg border px-3 py-2.5 flex items-start gap-2.5', meta.tone)}>
							<div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', meta.iconTone)}>
								<Icon className="w-3.5 h-3.5" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5 flex-wrap">
									<span className="text-[13px] font-medium text-slate-900 leading-tight">{o.title}</span>
									<span className="text-[9px] uppercase tracking-wide rounded-full px-1.5 py-px border border-indigo-100 bg-indigo-50 text-indigo-700">
										offer · {meta.label}
									</span>
								</div>
								{o.trigger && (
									<div className="text-[10px] text-slate-500 mt-0.5">
										recalled from {o.trigger.kind} <span className="font-mono">{o.trigger.key}</span>
										{o.trigger.count > 1 && <> · seen ×{o.trigger.count}</>}
									</div>
								)}
								{o.detail && <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">{o.detail}</div>}
								{o.action?.schedule && (
									<div className="text-[10px] text-indigo-700 mt-1 inline-flex items-center gap-1">
										<ChevronRight className="w-3 h-3" />
										one-tap: {o.action.type}
										<span className="font-mono">· {o.action.schedule}</span>
									</div>
								)}
							</div>
						</div>
					);
				})}
			</div>

			<a
				href="https://xp.io"
				target="_blank"
				rel="noreferrer"
				className="inline-flex items-center gap-1 text-[12px] text-indigo-700 hover:text-indigo-800 hover:underline"
			>
				Browse what's compounded into the marketplace <ArrowRight className="w-3.5 h-3.5" />
			</a>
		</div>
	);
}

// Derive an illustrative spot-wise offer from the intent being walked,
// using its `compound` teaser when present, then its movements. Shaped
// exactly like the live summary.offers[] so the bind-to-real path is a
// drop-in once cycle summaries flow through this surface.
function illustrativeOffers(intent: DemoIntent): CompoundOffer[] {
	if (intent.compound?.contributions?.length) {
		const kindMap: Record<string, CompoundOffer['kind']> = {
			skill: 'skill', recipe: 'workflow', standard: 'knowledge', example: 'knowledge',
		};
		return intent.compound.contributions.slice(0, 3).map((c, i) => ({
			id: `${intent.id}-c${i}`,
			kind: kindMap[c.kind] ?? 'knowledge',
			title: c.name,
			detail: c.detail,
		}));
	}
	// Fallback woven from the intent's recent axis movements.
	const mv = intent.axisMovements ?? [];
	const rule = mv.find((m) => m.axis === 'rules');
	const recipe = mv.find((m) => m.axis === 'recipe');
	const out: CompoundOffer[] = [];
	if (rule?.latest) {
		out.push({
			id: `${intent.id}-rule`,
			trigger: { kind: 'principle', key: 'rules', count: rule.count },
			kind: 'knowledge',
			title: 'Recall a principle that worked last time',
			detail: rule.latest,
		});
	}
	if (recipe?.latest) {
		out.push({
			id: `${intent.id}-recipe`,
			trigger: { kind: 'pattern', key: 'recipe', count: recipe.count },
			kind: 'workflow',
			title: 'Offer the proven step as a one-tap workflow',
			detail: recipe.latest,
			action: { type: 'install_workflow', schedule: '@trigger' },
		});
	}
	if (out.length === 0) {
		out.push({
			id: `${intent.id}-default`,
			kind: 'knowledge',
			title: 'Recall what worked at this kind of spot',
			detail: 'As runs accumulate, proven knowledge, skills, and workflows surface here at the moment they apply.',
		});
	}
	return out;
}
