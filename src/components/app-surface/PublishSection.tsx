// Manage → Publish (2026-11-28, operator: "create a new app, and then publish in
// marketplace"). Publishes the app's current version to the owner's xp.io repo
// (identity POST /me/apps/:app/publish → scheduler app_publish: creates the
// repo the first time, a new version after) and sets who can find it: the
// Marketplace, or only you. It says what will happen before the press and
// what happened after, with the link.

import { useEffect, useRef, useState } from "react";
import { Globe2, Loader2, Lock, Upload } from "lucide-react";
import { me, waitForIntent } from "@/api/me";
import { Button } from "@/components/ui/button";
import { plainCause } from "@/lib/activity";
import { publishedWords, publishPlanWords, type Visibility } from "@/lib/new-app";
import { cn } from "@/lib/utils";

export default function PublishSection({ app, summary: specSummary, visibility: specVisibility, forkOf, readOnly }: {
	app: string;
	/** The spec's summary: the Marketplace card's text. */
	summary: string;
	/** What the bundle last chose ("" = never published, or not recorded). */
	visibility: string;
	/** The app this one was copied from, if any. */
	forkOf?: string;
	readOnly: boolean;
}) {
	const [visibility, setVisibility] = useState<Visibility>(specVisibility === "public" ? "public" : "private");
	const [summary, setSummary] = useState(specSummary);
	const [phase, setPhase] = useState<"idle" | "publishing">("idle");
	const [outcome, setOutcome] = useState<{ ok: boolean; text: string; url?: string } | null>(null);
	useEffect(() => { setSummary(specSummary); }, [specSummary]);
	useEffect(() => { setVisibility(specVisibility === "public" ? "public" : "private"); }, [specVisibility]);
	const firstTime = specVisibility ? false : null;
	// Manage#publish (the app menu's "Publish…") lands here.
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		if (window.location.hash === "#publish") ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, []);

	const publish = async () => {
		setPhase("publishing");
		setOutcome(null);
		try {
			const r = await me.publishApp(app, { summary: summary.trim(), visibility });
			const done = await waitForIntent(r.intent_id, { timeoutMs: 180_000 });
			setOutcome(publishedWords(done.result, visibility));
		} catch (e) {
			setOutcome({ ok: false, text: `It didn't publish: ${plainCause(String((e as Error)?.message ?? e))}` });
		} finally { setPhase("idle"); }
	};

	const choice = (v: Visibility, Icon: typeof Globe2, title: string, hint: string) => (
		<label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2", visibility === v ? "border-gold-300 bg-gold-50/60" : "border-ink-200 bg-card hover:border-gold-200", readOnly && "cursor-default opacity-60")}>
			<input type="radio" name={`vis-${app}`} className="mt-1" checked={visibility === v} onChange={() => setVisibility(v)} disabled={readOnly || phase === "publishing"} />
			<Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-600" />
			<span className="min-w-0">
				<span className="block text-meta font-medium text-ink-900">{title}</span>
				<span className="block text-caption text-ink-600">{hint}</span>
			</span>
		</label>
	);

	return (
		<section ref={ref} id="publish" aria-label="Publish" className="space-y-3 rounded-xl border border-ink-200 bg-card p-4">
			<div className="flex items-center gap-1.5 text-meta font-medium text-ink-800">
				<Upload className="h-3.5 w-3.5 text-ink-600" /> Publish
			</div>
			<p className="text-caption text-ink-600">
				Publishing saves this app&apos;s current version{forkOf ? <> (a copy of <code className="font-mono text-micro">{forkOf}</code>)</> : null} to your own repository, so you or others can install it.
				People who install it get their own copy: their runs, data and spend are theirs.
			</p>
			<div className="grid gap-2 sm:grid-cols-2">
				{choice("public", Globe2, "In the Marketplace", "Anyone can find and install it.")}
				{choice("private", Lock, "Only me", "Kept private; not listed.")}
			</div>
			<label className="block space-y-1">
				<span className="text-caption text-ink-700">Marketplace summary</span>
				<textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={500} disabled={readOnly || phase === "publishing"}
					placeholder="What it researches, in a sentence or two." className="w-full resize-y rounded-lg border border-ink-200 bg-card px-3 py-2 text-caption text-ink-900" />
			</label>
			<p className="text-caption text-ink-700">{publishPlanWords(visibility, firstTime)}</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button size="sm" onClick={publish} disabled={readOnly || phase === "publishing"}>
					{phase === "publishing" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Publishing…</> : visibility === "public" ? "Publish to the Marketplace" : "Publish privately"}
				</Button>
				{readOnly && <span className="text-micro text-ink-600">This is a shared copy; install your own to publish it.</span>}
			</div>
			{outcome && (
				<p role="status" className={cn("text-caption", outcome.ok ? "text-gold-700" : "text-brick-700")}>
					{outcome.text}{outcome.url && <> <a href={outcome.url} target="_blank" rel="noreferrer" className="underline">Open it on xp.io</a></>}
				</p>
			)}
		</section>
	);
}
