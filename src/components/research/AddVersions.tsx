// AddVersions — "Add versions" from an experiment's panel: new versions of an
// existing experiment, written into the app's spec (comments kept). It defines
// them and nothing else; the runs start when the reader presses "Run the N
// untried versions" (manual dispatch).
//
// Round 10 (2026-11-28): a researcher with ten ideas had two ways in — the
// chat (which could not read the app's own notes) or hand-editing the YAML.
// The box starts from a copy of the experiment's first version, so the reader
// edits a real example; several can be pasted at once. Words come from
// parseNewVersions (lib/app-spec.ts, tested).

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppGraph } from "@/hooks/useAppGraph";
import { addVersions, parseNewVersions, versionIds, versionInputs, versionTemplate } from "@/lib/app-spec";
import { experimentLoop, humanId, experimentLabel} from "@/lib/research-map";
import type { MeExperiment } from "@/api/me";

export default function AddVersions({ app, e, onClose }: { app: string; e: MeExperiment; onClose: () => void }) {
	const { graph, save } = useAppGraph(app);
	const text = graph?.text ?? "";
	const loop = experimentLoop(e);
	const inputs = useMemo(() => (graph ? versionInputs(graph.spec, loop) : []), [graph, loop]);
	const taken = useMemo(() => versionIds(text, e.id), [text, e.id]);
	const [draft, setDraft] = useState<string | null>(null);
	const value = draft ?? (text ? versionTemplate(text, e.id) : "");
	const parsed = useMemo(() => parseNewVersions(value, taken, inputs), [value, taken, inputs]);
	const [busy, setBusy] = useState(false);
	const n = parsed.versions.length;
	const ready = n > 0 && !parsed.problems.length && !busy;

	const add = async () => {
		setBusy(true);
		try {
			await save((cur) => addVersions(cur, e.id, parsed.versions));
			window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["experiments"] } }));
			toast.success(`${n} version${n === 1 ? "" : "s"} added to ${experimentLabel(e)}`, {
				description: "Nothing has run yet — press “Run the untried versions” when you're ready.",
			});
			onClose();
		} catch (ex) {
			toast.error("Couldn't add the versions", { description: String((ex as Error).message || ex) });
		} finally {
			setBusy(false);
		}
	};

	// A portal: the panel that opens this sheet animates with a transform,
	// which made it the containing block of this fixed overlay — the sheet was
	// clipped inside the panel (round 10, 2026-11-28).
	return createPortal((
		<div role="dialog" aria-label="Add versions" className="fixed inset-0 z-[7000] flex items-center justify-center bg-ink-900/30 p-4" onClick={onClose}>
			<div className="w-full max-w-xl space-y-3 rounded-xl border border-ink-200 bg-card p-4 shadow-e3 map-panel-in" onClick={(ev) => ev.stopPropagation()}>
				<div>
					<div className="eyebrow text-plum-700">Add versions</div>
					<div className="text-title font-semibold text-ink-900">{experimentLabel(e)}</div>
				</div>
				<p className="text-caption text-ink-700">
					One entry per version: an <span className="font-mono">id</span>, what it changes (<span className="font-mono">about</span>), and the inputs it sets
					{inputs.length ? <> — {inputs.map((k, i) => <span key={k}>{i ? ", " : ""}<span className="font-mono">{k}</span></span>)}</> : null}.
					This starts from a copy of its first version; paste several to add them at once.
				</p>
				<textarea
					aria-label="New versions (YAML or JSON)"
					value={value}
					onChange={(ev) => setDraft(ev.target.value)}
					spellCheck={false}
					rows={14}
					className="w-full resize-y rounded-lg border border-ink-200 bg-card p-2.5 font-mono text-caption leading-relaxed text-ink-900 focus:outline-none focus:ring-2 focus:ring-plum-300"
				/>
				{parsed.problems.length > 0 ? (
					<ul role="alert" className="space-y-0.5 text-caption text-brick-700">
						{parsed.problems.map((p) => <li key={p}>{p}</li>)}
					</ul>
				) : n > 0 ? (
					<p role="status" className="text-caption text-ink-700">
						Adds {n}: {parsed.versions.map((v) => humanId(v.id)).join(", ")}. Nothing runs until you press Run.
					</p>
				) : null}
				<div className="flex items-center justify-end gap-2">
					<Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
					<Button size="sm" variant="accent" disabled={!ready} onClick={add}>
						{busy ? "Adding…" : n > 1 ? `Add ${n} versions` : "Add the version"}
					</Button>
				</div>
			</div>
		</div>
	), document.body
	);
}
