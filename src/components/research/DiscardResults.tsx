// DiscardResults — "Discard these results…" for a run that measured an
// experiment version, and the experiment's "Discarded (n)" list with Restore.
// Nothing is deleted: the platform writes tombstones (lib/discard.ts).

import { useId, useState } from "react";
import { EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { me, type MeExperimentRow } from "@/api/me";
import { Button } from "@/components/ui/button";
import { discardDoneWords, discardedGroups, type DiscardTarget } from "@/lib/discard";
import { humanId } from "@/lib/research-map";

const refetch = () => window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["experiments", "runs"] } }));

export function DiscardRun({ app, target }: { app: string; target: DiscardTarget }) {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const id = useId();
	const exp = humanId(target.experiment);
	if (!open) {
		return (
			<button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-micro text-ink-600 hover:text-ink-900 underline-offset-2 hover:underline">
				<EyeOff className="h-3 w-3" aria-hidden /> Discard these results…
			</button>
		);
	}
	const send = async () => {
		setBusy(true);
		try {
			await me.discardResults(app, target.experiment, { action: "discard", reason, matches: target.matches });
			toast.success(discardDoneWords(exp, false));
			setOpen(false); setReason("");
			window.setTimeout(refetch, 4000);
		} catch (e) {
			toast.error(`Couldn't discard: ${e instanceof Error ? e.message : String(e)}`);
		} finally { setBusy(false); }
	};
	return (
		<form className="space-y-1.5 rounded-md border border-ink-200 bg-card p-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void send(); }}>
			<label htmlFor={id} className="block text-caption text-ink-800">
				Hide {humanId(target.version)}&apos;s results from this run in {exp}? They stay in the record and can be restored. Why?
			</label>
			<input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus
				placeholder="e.g. measured the wrong design" className="w-full rounded-md border border-ink-200 bg-background px-2 py-1 text-caption" />
			<div className="flex gap-2">
				<Button type="submit" size="sm" variant="destructive" disabled={!reason.trim() || busy}>Discard</Button>
				<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Keep them</Button>
			</div>
		</form>
	);
}

export function DiscardedList({ app, experiment, rows, label }: { app: string; experiment: string; rows: MeExperimentRow[]; label: (v: string) => string }) {
	const groups = discardedGroups(rows);
	const [busy, setBusy] = useState<string | null>(null);
	if (!groups.length) return null;
	const restore = async (g: (typeof groups)[number]) => {
		const key = `${g.version}|${g.cycle_ts}`;
		setBusy(key);
		try {
			await me.discardResults(app, experiment, { action: "restore", matches: [{ variant_id: g.version, ...(g.cycle_ts ? { cycle_ts: g.cycle_ts } : {}) }] });
			toast.success(discardDoneWords(humanId(experiment), true));
			window.setTimeout(refetch, 4000);
		} catch (e) {
			toast.error(`Couldn't restore: ${e instanceof Error ? e.message : String(e)}`);
		} finally { setBusy(null); }
	};
	return (
		<details className="text-micro text-ink-700" data-testid="discarded-list">
			<summary className="cursor-pointer text-ink-600">Discarded ({groups.length}) — not counted, kept on record</summary>
			<ul className="mt-1 space-y-1">
				{groups.map((g) => (
					<li key={`${g.version}|${g.cycle_ts}`} className="flex flex-wrap items-center gap-x-2">
						<span className="line-through text-ink-600">{label(g.version)}{g.stage ? ` · ${humanId(g.stage)}` : ""}</span>
						<span className="text-ink-700">“{g.reason || "no reason recorded"}”</span>
						<button type="button" disabled={busy === `${g.version}|${g.cycle_ts}`} onClick={() => void restore(g)}
							className="inline-flex items-center gap-1 text-ink-700 hover:text-ink-900 underline-offset-2 hover:underline">
							<RotateCcw className="h-3 w-3" aria-hidden /> Restore
						</button>
					</li>
				))}
			</ul>
		</details>
	);
}
