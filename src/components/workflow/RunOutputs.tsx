// RunOutputs — the run page's third column: what this run produced. Novix
// shows workspace files and "Final deliverables"; Lumid runs today record no
// files, so this shows what they DO produce — the command's own sentence, its
// short named results, the memories it learned, the fleet jobs it started —
// and says so plainly when there is nothing.

import type { MeCycleDetail } from "@/api/me";
import { runOutputs } from "@/lib/run-answer";
import RunChildren from "@/components/workflow/RunChildren";

export default function RunOutputs({ detail, onFullOutput }: { detail: MeCycleDetail | null; onFullOutput?: () => void }) {
	const o = runOutputs(detail);
	const jobs = detail?.compute_jobs ?? [];
	const nothing = !o.text && !o.fields.length && !o.memories.length && !jobs.length;
	return (
		<aside aria-label="What this run produced" className="space-y-2.5 min-w-0">
			<h3 className="text-micro uppercase tracking-wide font-semibold text-ink-600">What it produced</h3>
			{!detail ? (
				<div className="h-16 lumen-skeleton rounded-lg" />
			) : nothing ? (
				<p className="text-caption text-ink-600">This run saved no files or results of its own beyond the answer above.</p>
			) : (
				<>
					{o.text && <p className="text-caption text-ink-800 leading-snug">{o.text}</p>}
					{o.fields.length > 0 && (
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
							{o.fields.map((f) => (
								<div key={f.label} className="contents">
									<dt className="text-ink-600">{f.label}</dt>
									<dd className="text-ink-900 break-words">{f.value}</dd>
								</div>
							))}
						</dl>
					)}
					{o.memories.length > 0 && (
						<div>
							<div className="text-micro text-ink-600 mb-0.5">Learned</div>
							<ul className="text-caption text-ink-800 list-disc pl-4 space-y-0.5">{o.memories.map((m) => <li key={m}>{m}</li>)}</ul>
						</div>
					)}
					<RunChildren jobs={jobs} />
				</>
			)}
			{detail && onFullOutput && (
				<button type="button" onClick={onFullOutput} className="text-micro text-ink-700 hover:text-ink-900 underline decoration-dotted">Full output</button>
			)}
		</aside>
	);
}
