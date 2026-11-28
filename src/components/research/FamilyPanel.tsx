// FamilyPanel — versions of one experiment that differ in ONE setting, opened
// from their single node on the research map (lib/version-families.ts). It
// answers "which value of that setting does best?": one row per value, the
// result at each feedback step (the same reading as EvidenceGrid), the best
// marked, and each row opens that version's own panel.

import { useMemo } from "react";
import { MessagesSquare } from "lucide-react";
import type { MeExperiment } from "@/api/me";
import type { AppSpec } from "@/lib/app-spec";
import { PanelShell } from "@/components/research/WorkflowPanel";
import { useExperimentRows } from "@/components/research/ExperimentSpend";
import { cellValue, cellWords, evidenceOf, experimentSteps } from "@/lib/evidence";
import { experimentLabel } from "@/lib/research-map";
import { familyBestWords, familyLine, familyStatus, type VersionFamily } from "@/lib/version-families";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<string, string> = { ok: "text-gold-700", failing: "text-brick-700", running: "text-lagoon-700", attention: "text-ember-700", idle: "text-ink-600" };

export default function FamilyPanel({ app, e, f, spec, specText, style, onClose, onBack, onPickVersion }: {
	app: string; e: MeExperiment; f: VersionFamily;
	spec?: AppSpec; specText?: string; style?: React.CSSProperties;
	onClose: () => void;
	/** Back to the experiment's panel. */
	onBack: () => void;
	/** A row was clicked: open that version's panel. */
	onPickVersion: (version: string) => void;
}) {
	const steps = useMemo(() => experimentSteps(spec, e, specText), [spec, e, specText]);
	const rows = useExperimentRows(app, e.id);
	const metric = e.metric?.name || e.metric_name || "";
	const hib = !(e.higher_is_better === false || e.metric?.higher_is_better === false);
	const ev = useMemo(() => rows && evidenceOf({
		steps, rows, metric, higherIsBetter: hib,
		versions: f.members.map((id) => ({ id, label: f.values[id] })),
		aggregates: e.comparable === false ? undefined : e.variants ?? undefined,
	}), [rows, steps, metric, hib, f, e.comparable, e.variants]);
	const bestStep = ev?.best ? ev.steps.find((s) => s.step === ev.best!.step) : undefined;
	const best = familyBestWords(f, ev?.best && bestStep
		? { version: ev.best.version, value: ev.best.value, unit: bestStep.unit, metric: bestStep.metric, step: ev.steps.length > 1 ? bestStep.label : undefined }
		: null);
	const bestId = ev?.best?.version ?? f.best?.id ?? null;
	const st = familyStatus(f);
	const ask = () => window.dispatchEvent(new CustomEvent("studio:ask", { detail: {
		prompt: `In the ${experimentLabel(e)} experiment, which ${f.keyWords} works best for ${f.name} (${f.sub}), and what should I try next?`,
		context: { app, loop: e.dispatch?.loop || e.loops?.[0] },
	} }));
	return (
		<PanelShell kicker="Versions" title={f.name} label={`Versions: ${f.name}`} style={style} onClose={onClose}
			actions={<button type="button" onClick={ask} aria-label="Ask about it" title="Ask the chat which value works best"
				className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-700 hover:bg-ink-100 hover:text-ink-900"><MessagesSquare className="h-3.5 w-3.5" /></button>}
			sub={<>
				<div className="text-caption text-ink-700">{familyLine(f)}</div>
				<button type="button" onClick={onBack} className="text-caption text-ink-700 hover:text-ink-900 hover:underline">of {experimentLabel(e)} ›</button>
				<div className={cn("flex items-start gap-1.5 text-caption font-medium leading-snug", TONE_TEXT[st.tone])}>
					<span className={cn("mt-[0.4em] h-1.5 w-1.5 flex-shrink-0 rounded-full", TONES[st.tone].dot)} />{st.text}
				</div>
			</>}>
			<div className="scrollbar-hide min-h-0 flex-1 space-y-2 overflow-y-auto px-3.5 py-3" data-family={f.id}>
				{best && <p className="text-caption font-medium text-ink-900">{best}</p>}
				{rows === null ? (
					<div className="h-24 lumen-skeleton rounded-lg" role="status" aria-label="Reading the results" />
				) : ev && (
					<div className="overflow-x-auto overscroll-x-contain">
						<table className="w-full border-separate border-spacing-0 text-caption">
							<thead>
								<tr>
									<th scope="col" className="px-1 pb-1 text-left align-bottom text-micro font-medium text-ink-600">{f.keyWords}</th>
									{ev.steps.map((s) => (
										<th key={s.step} scope="col" className="px-1 pb-1 text-left align-bottom text-micro font-medium text-ink-800">
											{ev.steps.length === 1 ? s.metricLabel || s.label : s.label}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{f.members.map((id) => {
									const cells = ev.cells.get(id);
									const isBest = id === bestId;
									return (
										<tr key={id} onClick={() => onPickVersion(id)} className={cn("group cursor-pointer", isBest && "[&>*]:bg-gold-50")}>
											<th scope="row" className="border-t border-ink-100 px-1 py-1 text-left font-normal group-hover:bg-ink-50">
												<button type="button" onClick={(x) => { x.stopPropagation(); onPickVersion(id); }} className="flex items-center gap-1.5 font-medium text-ink-900 hover:underline">
													<span className="tabular-nums">{f.values[id]}</span>
													{isBest && <span className="rounded-full bg-gold-700 px-1.5 text-nano font-medium text-white">best</span>}
												</button>
											</th>
											{ev.steps.map((s) => {
												const c = cells?.get(s.step);
												if (!c) return <td key={s.step} className="border-t border-ink-100 px-1 py-1" />;
												const words = cellWords(c, s);
												return (
													<td key={s.step} title={words} aria-label={words}
														className={cn("border-t border-ink-100 px-1 py-1 tabular-nums group-hover:bg-ink-50", c.state === "failed" ? "text-brick-700" : c.state === "not run" || c.state === "running" ? "text-ink-600" : "text-ink-900")}>
														{c.state === "running" ? "running" : c.state === "not run" ? "—" : cellValue(c, s)}
													</td>
												);
											})}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
				<p className="text-micro text-ink-600">Each row opens that version.</p>
			</div>
		</PanelShell>
	);
}
