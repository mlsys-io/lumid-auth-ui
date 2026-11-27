// EmptyResearchSpace — an app's research space before anything is in it.
//
// The map used to render NOTHING for an app with no workflow, experiment or
// suggestion, so a new app opened on a blank page with no hint of what goes
// there or how to start ("design proper research graph and instructions when
// nothing is there", user 2026-11-27).
//
// Same stage and height as the map, so the page keeps its shape when the first
// workflow lands. It draws what WILL grow there — the app at the centre, faint
// dashed branches where workflows, setups and comparisons appear — and labels
// each with the step that makes it real. Two ways to start: describe it in the
// chat (it drafts the workflow for approval; nothing is saved without a press)
// or build it step by step.

import { Link } from "react-router-dom";
import { ArrowRight, MessagesSquare, Sparkles } from "lucide-react";
import { appTitle } from "@/components/workflow/AppCard";
import { useStageHeight } from "@/components/research/stage-height";

const STEPS = [
	{ n: 1, title: "Add a workflow", text: "What to measure, and how a result is judged.", x: 20, y: 18 },
	{ n: 2, title: "Try setups", text: "Run it with a few inputs; each setup becomes a dot, coloured by how it did.", x: 80, y: 22 },
	{ n: 3, title: "Compare and decide", text: "Pick two dots to see which is ahead, then ask what to run next.", x: 78, y: 58 },
] as const;

// The app sits here (percent of the stage); branches run from it to each step.
const CX = 46, CY = 40;

export default function EmptyResearchSpace({ app }: { app: string }) {
	const { ref: stageRef, height } = useStageHeight();
	const title = appTitle(app);
	const askNewWorkflow = () => window.dispatchEvent(new CustomEvent("studio:ask", { detail: {
		prompt: `I'd like to add the first workflow to ${title}. Ask me what it should measure and how a result should be judged, then draft it for me to approve before anything is saved.`,
		context: { app },
	} }));

	return (
		<section aria-label="Research" className="space-y-2">
			<div className="flex items-center gap-2 px-0.5">
				<Sparkles className="h-3.5 w-3.5 text-plum-500" aria-hidden />
				<h2 className="whitespace-nowrap text-meta font-medium text-ink-800">Research space</h2>
				<span className="ml-auto whitespace-nowrap font-mono text-nano uppercase tracking-wider text-ink-600">Nothing here yet</span>
			</div>
			<div ref={stageRef} data-empty-space style={{ height }}
				className="relative overflow-hidden rounded-xl border border-ink-200 bg-card">
				{/* The space, drawn faintly: rings in perspective, the app at the centre,
				    and a dashed branch to where each step will put something. */}
				<svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
					<defs>
						<radialGradient id="empty-space-glow" cx={`${CX}%`} cy={`${CY}%`} r="45%" className="text-plum-100">
							<stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
							<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
						</radialGradient>
					</defs>
					<rect x="0" y="0" width="100" height="100" fill="url(#empty-space-glow)" />
					{[12, 22, 33, 45].map((r) => (
						<ellipse key={r} cx={CX} cy={CY} rx={r} ry={r * 0.42} fill="none"
							className="stroke-ink-200" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
					))}
					{STEPS.map((s) => {
						const mx = (CX + s.x) / 2, my = Math.min(CY, s.y) - 6;
						return (
							<path key={s.n} d={`M ${CX} ${CY} Q ${mx} ${my} ${s.x} ${s.y}`} fill="none"
								className="stroke-plum-300" strokeWidth="1.2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
						);
					})}
				</svg>

				{/* The app — the root every branch grows from. */}
				<div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style={{ left: `${CX}%`, top: `${CY}%` }}>
					<span className="relative flex h-12 w-12 items-center justify-center" aria-hidden>
						<span className="absolute h-12 w-12 rounded-full border border-plum-300 space3d-ping" />
						<span className="absolute h-8 w-8 rounded-full bg-plum-100" />
						<span className="relative h-4 w-4 rounded-full bg-plum-600 ring-[3px] ring-plum-300" />
					</span>
					<span className="whitespace-nowrap text-caption font-medium text-ink-800">{title}</span>
				</div>

				{/* Where each step's work will appear. */}
				{STEPS.map((s) => (
					<div key={s.n} data-empty-step={s.n} className="absolute hidden w-[min(15rem,40%)] md:block"
						style={{ left: `${s.x}%`, top: `${s.y}%`, transform: `translate(${s.x > 60 ? "-100%" : "-0.5rem"}, -50%)` }}>
						<div className={`flex items-start gap-2 ${s.x > 60 ? "flex-row-reverse text-right" : ""}`}>
							<span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-plum-400 bg-card text-micro font-medium text-plum-700">{s.n}</span>
							<span className="min-w-0">
								<span className="block text-caption font-medium text-ink-800">{s.title}</span>
								<span className="block text-micro leading-snug text-ink-600">{s.text}</span>
							</span>
						</div>
					</div>
				))}

				{/* How to start — the one card that asks for anything. */}
				<div className="absolute inset-x-3 bottom-3 mx-auto max-w-xl rounded-xl border border-ink-200 bg-card/95 p-4 shadow-e1 backdrop-blur-sm sm:inset-x-6 sm:bottom-6">
					<h3 className="text-meta font-medium text-ink-900">Start with a workflow</h3>
					<p className="mt-1 text-caption leading-relaxed text-ink-700">
						This is where {title}'s research will grow. A workflow is something you want to find out — it runs,
						its results are measured, and every setup you try appears here as a dot on its branch. Nothing runs
						until you press Run.
					</p>
					{/* On a narrow screen the floating labels would collide: list the steps here instead. */}
					<ol className="mt-2 space-y-1 md:hidden">
						{STEPS.map((s) => (
							<li key={s.n} className="flex items-start gap-2 text-micro leading-snug text-ink-700">
								<span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-plum-400 text-nano font-medium text-plum-700">{s.n}</span>
								<span><span className="font-medium text-ink-800">{s.title}</span> — {s.text}</span>
							</li>
						))}
					</ol>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<button type="button" onClick={askNewWorkflow} data-empty-action="chat"
							className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-1.5 text-caption font-medium text-white transition-colors hover:bg-ink-800">
							<MessagesSquare className="h-3.5 w-3.5" aria-hidden />Describe it in chat
						</button>
						<Link to={`/studio/a/${encodeURIComponent(app)}/manage?new=1`} data-empty-action="build"
							className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-card px-3 py-1.5 text-caption text-ink-800 transition-colors hover:bg-ink-50">
							Build it step by step <ArrowRight className="h-3.5 w-3.5" aria-hidden />
						</Link>
						<span className="text-micro text-ink-600">The chat drafts it for you to approve; nothing is saved until you do.</span>
					</div>
				</div>
			</div>
		</section>
	);
}
