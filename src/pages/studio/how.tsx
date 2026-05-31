// /studio/how — "How Lumid works": a walkable illustration of the loop
// every intent runs through. Stages 1 (Assemble) and 2 (Adapt) are concrete
// and demoed against real demo intents; Stage 3 (Compound) is shown as an
// open/TBD node — its direction is still being defined.
//
// Data comes from lib/demo-intents (the same registry the Intents surface
// uses), so this page stays in sync with the live demo without duplicating
// copy. Use cases = the demo intents that declare an `assembly` (Stage 1).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Boxes, Sparkles, Library, ArrowRight, ArrowDown, Wand2, Package,
	TrendingUp, ChevronRight,
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
					Every intent runs the same loop. You say what you want; Lumid <strong>assembles</strong> a
					workflow, then <strong>adapts</strong> it to you — and what it learns will{' '}
					<strong>compound</strong> back into the library.
				</p>
			</header>

			{/* Flywheel — three stages, S3 still open */}
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
								? 'bg-emerald-50 border-emerald-200 text-emerald-900 font-medium shadow-sm'
								: 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900',
						)}
					>
						{u.persona}
					</button>
				))}
			</div>

			{/* The intent being walked */}
			<div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-50 via-white to-slate-50 p-4">
				<div className="text-[11px] text-slate-400 mb-0.5">the intent</div>
				<div className="text-[15px] text-slate-900 font-medium leading-snug">“{intent.title}”</div>
			</div>

			{/* Stage 1 — Assemble */}
			<StagePanel n={1} label="Assemble" tone="emerald" icon={Boxes}
				caption="Given your intent, Lumid assembles a workflow — pulling proven pieces from your workspace and generating the rest with AI.">
				<AssembleBody assembly={intent.assembly!} />
			</StagePanel>

			<StepArrow />

			{/* Stage 2 — Adapt */}
			<StagePanel n={2} label="Adapt" tone="sky" icon={Sparkles}
				caption="Then it adapts to you — autoresearching and aligning to your specific intent so it gets more valuable every cycle.">
				<AdaptBody intent={intent} />
			</StagePanel>

			<StepArrow />

			{/* Stage 3 — Compound (open) */}
			<StagePanel n={3} label="Compound" tone="muted" icon={Library}
				caption="What it learns will compound back into the shared library — so the next person assembling a similar intent starts ahead. This closes the loop."
				open>
				<div className="text-[12px] text-slate-500 leading-relaxed">
					Direction still being defined — the mechanics of promoting a learned skill / recipe back
					to the marketplace are open. The loop closes here.
				</div>
			</StagePanel>
		</div>
	);
}

// ── Flywheel diagram ───────────────────────────────────────────────

function Flywheel() {
	const nodes = [
		{ icon: Boxes,    label: 'Assemble', sub: 'workspace + AI',      tone: 'emerald' as const },
		{ icon: Sparkles, label: 'Adapt',    sub: 'autoresearch · align', tone: 'sky' as const },
		{ icon: Library,  label: 'Compound', sub: 'back to the library',  tone: 'muted' as const },
	];
	return (
		<div className="rounded-2xl border border-slate-200/70 bg-white p-4">
			<div className="flex items-stretch gap-2">
				{nodes.map((nd, i) => (
					<div key={nd.label} className="flex items-stretch gap-2 flex-1">
						<div className={cn(
							'flex-1 rounded-xl border px-3 py-3 flex flex-col items-center text-center gap-1.5',
							nd.tone === 'emerald' && 'border-emerald-200 bg-emerald-50/50',
							nd.tone === 'sky' && 'border-sky-200 bg-sky-50/50',
							nd.tone === 'muted' && 'border-dashed border-slate-200 bg-slate-50/40',
						)}>
							<div className={cn(
								'w-8 h-8 rounded-lg flex items-center justify-center',
								nd.tone === 'emerald' && 'bg-emerald-100 text-emerald-700',
								nd.tone === 'sky' && 'bg-sky-100 text-sky-700',
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
			{/* loop-back hint */}
			<div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
				<ChevronRight className="w-3 h-3 rotate-180" />
				the library feeds Assemble — every adaptation makes the next assembly stronger
			</div>
		</div>
	);
}

// ── Stage panel shell ──────────────────────────────────────────────

function StagePanel({
	n, label, tone, icon: Icon, caption, children, open,
}: {
	n: number; label: string; tone: 'emerald' | 'sky' | 'muted';
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
					tone === 'emerald' && 'bg-emerald-100 text-emerald-700',
					tone === 'sky' && 'bg-sky-100 text-sky-700',
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
				<span className="inline-flex items-center gap-1"><Wand2 className="w-3.5 h-3.5 text-emerald-500" />{ai} generated by AI</span>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{assembly.map((p) => (
					<div key={p.name} className="rounded-lg border border-slate-200/70 bg-white px-3 py-2 flex items-start gap-2.5">
						<div className={cn(
							'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
							p.source === 'ai' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
						)}>
							{p.source === 'ai' ? <Wand2 className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5">
								<span className="text-[13px] font-medium text-slate-900 leading-tight">{p.name}</span>
								<span className={cn(
									'text-[9px] uppercase tracking-wide rounded-full px-1.5 py-px border',
									p.source === 'ai'
										? 'text-emerald-700 bg-emerald-50 border-emerald-100'
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
							<div className="text-[10px] text-emerald-700 mt-0.5 inline-flex items-center gap-0.5">
								<TrendingUp className="w-3 h-3" />{s.delta}
							</div>
						</div>
					))}
				</div>
			)}

			{/* What it learned — narrative bullets tagged by axis */}
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
					className="inline-flex items-center gap-1 text-[12px] text-emerald-700 hover:text-emerald-800 hover:underline"
				>
					See the full adaptation <ArrowRight className="w-3.5 h-3.5" />
				</Link>
			)}
		</div>
	);
}
