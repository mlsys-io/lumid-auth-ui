// TryModuleSheet — "Try it once": run one module on lum.id with inputs you
// type, and see what it answered, how long it took and what it used.
//
// The editor starts from the module's declared inputs (lib/modules
// inputTemplate). Run is ONE POST /me/measure as you (your fleet credential,
// this app's budget); lib/modules runModuleOnce follows it — the waiting and
// running states are said in words, a reused result says it was free. Nothing
// is saved to the app. The client is injected so the gallery can show every
// state with no request.

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { me } from "@/api/me";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
	GUARANTEE_WORDS, inputTemplate, limitsWords, outputText, parseTryInputs, runModuleOnce,
	type MeasureClient, type ModuleLimits, type TryPhase,
} from "@/lib/modules";
import { FIELD, MODULE_SHEET } from "./sheet";

export interface TryTarget {
	/** The instrument name: "<app>.<id>" or "<owner>/<app>.<id>". */
	name: string;
	title: string;
	inputs: Array<{ name: string; label: string; words: string }>;
	limits: ModuleLimits | null;
}

export const liveMeasureClient: MeasureClient = {
	measure: (body) => me.measure(body),
	get: (key) => me.measureResult(key),
	sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
	now: () => Date.now(),
};

export default function TryModuleSheet({ app, target, onClose, client = liveMeasureClient, isAdmin = false, initialPhase }: {
	app: string;
	target: TryTarget;
	onClose: () => void;
	client?: MeasureClient;
	isAdmin?: boolean;
	/** Gallery only: open in a given state. */
	initialPhase?: TryPhase;
}) {
	const declared = useMemo(() => Object.fromEntries(target.inputs.map((i) => [i.name, i.words])), [target.inputs]);
	const [text, setText] = useState(() => inputTemplate(declared));
	const [phase, setPhase] = useState<TryPhase | null>(initialPhase ?? null);
	const [busy, setBusy] = useState(false);
	const live = useRef(true);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const check = useMemo(() => parseTryInputs(text, declared), [text, declared]);

	const run = async () => {
		if (!check.value) return;
		setBusy(true);
		setPhase(null);
		try {
			await runModuleOnce(client, { instrument: target.name, app, inputs: check.value }, (p) => { if (live.current) setPhase(p); }, {
				timeoutS: target.limits?.timeoutS, cancelled: () => !live.current,
			});
		} finally {
			if (live.current) setBusy(false);
		}
	};

	return (
		<Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent aria-label={`Try ${target.title} once`} className={MODULE_SHEET}>
				<header className="px-5 pt-5 pb-3 border-b border-ink-200 pr-12">
					<DialogTitle className="font-display text-h3 text-ink-900 font-normal">Try {target.title} once</DialogTitle>
					<DialogDescription className="text-caption text-ink-600 mt-1">
						Runs it once on lum.id with these inputs, as you, on this app&apos;s budget. Identical inputs reuse an earlier result for free. Nothing is saved to the app.
					</DialogDescription>
				</header>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
					{target.inputs.length > 0 && (
						<dl className="space-y-1 text-caption" aria-label="What it reads">
							{target.inputs.map((i) => (
								<div key={i.name} className="flex gap-2">
									<dt className="font-medium text-ink-800 flex-none">{i.label}</dt>
									<dd className="text-ink-600 min-w-0">{i.words || "no description"}</dd>
								</div>
							))}
						</dl>
					)}
					<div>
						<label htmlFor="try-inputs" className="block text-caption font-medium text-ink-800 mb-1">Inputs, as one JSON object</label>
						<textarea id="try-inputs" value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false} disabled={busy}
							className={cn(FIELD, "font-mono text-caption leading-relaxed resize-y")} data-testid="try-inputs" />
						{check.problem
							? <p className="text-micro text-brick-700 mt-1">{check.problem}</p>
							: check.notes.map((n) => <p key={n} className="text-micro text-ink-600 mt-1">{n}</p>)}
					</div>

					{phase && <TryAnswer phase={phase} isAdmin={isAdmin} />}
				</div>

				<footer className="border-t border-ink-200 px-5 py-3 flex items-center gap-3">
					<p className="flex-1 text-micro text-ink-600">
						{target.limits ? <>At most {limitsWords(target.limits)}. </> : null}{GUARANTEE_WORDS}
					</p>
					<Button variant="ghost" onClick={onClose}>Close</Button>
					<Button onClick={run} disabled={busy || !check.value} data-testid="try-run">
						{busy ? <Loader2 className="animate-spin" /> : <Play />} Run once
					</Button>
				</footer>
			</DialogContent>
		</Dialog>
	);
}

/** What the run answered, in words; the output as JSON. */
export function TryAnswer({ phase, isAdmin }: { phase: TryPhase; isAdmin?: boolean }) {
	if (phase.phase === "waiting" || phase.phase === "running") {
		return (
			<div className="rounded-lg border border-lagoon-200 bg-lagoon-50 px-3 py-2 text-caption text-lagoon-700 flex items-start gap-2" aria-live="polite" data-testid="try-progress">
				<Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin flex-none" />
				<span>{phase.words}</span>
			</div>
		);
	}
	if (phase.phase === "done") {
		const out = outputText(phase.output);
		return (
			<div className="space-y-2" data-testid="try-done">
				<div className="rounded-lg border border-gold-200 bg-gold-50 px-3 py-2 text-caption text-gold-700">
					<div className="font-medium">{phase.tookWords}</div>
					<div>Used: {phase.usage}</div>
				</div>
				<div>
					<div className="text-caption font-medium text-ink-800 mb-1">What it answered</div>
					<pre className="max-h-80 overflow-auto rounded-lg border border-ink-200 bg-muted p-3 font-mono text-caption text-ink-900 whitespace-pre-wrap break-words">{out.text}</pre>
					{out.clipped && <p className="text-micro text-ink-600 mt-1">Only the start is shown; the answer is longer.</p>}
				</div>
				{isAdmin && phase.key && <p className="text-micro text-ink-600 font-mono break-all">Measurement key {phase.key}</p>}
			</div>
		);
	}
	const words = phase.words;
	const tone = phase.phase === "slow" || phase.phase === "not_run" ? "border-ember-200 bg-ember-50 text-ember-700" : "border-brick-200 bg-brick-50 text-brick-700";
	return (
		<div role="status" className={cn("rounded-lg border px-3 py-2 text-caption", tone)} data-testid="try-stopped">
			<div className="font-medium">{phase.phase === "failed" ? "It didn't work" : phase.phase === "slow" ? "Still running" : "Not run"}</div>
			<div className="whitespace-pre-wrap break-words">{words}</div>
			{phase.phase === "failed" && phase.usage && <div className="mt-0.5">Used: {phase.usage}</div>}
			{isAdmin && "key" in phase && phase.key && <div className="text-micro font-mono mt-1 break-all">Measurement key {phase.key}</div>}
		</div>
	);
}
