// New app (2026-11-28, operator: "we also need a way to create a new app, and
// then publish in marketplace"). A brand-new research app in your account from
// the starter: data, workflows, experiments and pages, all empty. Identity
// POST /me/apps/new queues it; the scheduler creates it in your tree. Nothing
// is published (Manage → Publish) and nothing runs (you add workflows, then
// press Run).

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { me, waitForIntent } from "@/api/me";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { plainCause } from "@/lib/activity";
import { appNameFrom, newAppProblems } from "@/lib/new-app";
import { cn } from "@/lib/utils";

const field = "w-full rounded-lg border border-ink-200 bg-card px-3 py-2 text-meta text-ink-900 placeholder:text-ink-500 focus:border-gold-400 focus:outline-none focus:ring-4 focus:ring-gold-400/15";

export default function NewAppPage() {
	const navigate = useNavigate();
	const [taken, setTaken] = useState<string[]>([]);
	const [title, setTitle] = useState("");
	const [name, setName] = useState("");
	const [nameTouched, setNameTouched] = useState(false);
	const [summary, setSummary] = useState("");
	const [phase, setPhase] = useState<"form" | "creating">("form");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		me.listApps().then((r) => setTaken((r.apps ?? []).map((a) => a.name))).catch(() => {});
	}, []);
	// The id follows the title until it is edited by hand.
	useEffect(() => { if (!nameTouched) setName(appNameFrom(title, taken)); }, [title, taken, nameTouched]);

	const problems = useMemo(() => newAppProblems({ title, name, summary }, taken), [title, name, summary, taken]);
	const touched = !!(title.trim() || summary.trim());

	const create = async () => {
		setPhase("creating");
		setError(null);
		try {
			const r = await me.newApp({ name: name.trim(), title: title.trim(), summary: summary.trim() });
			const done = await waitForIntent(r.intent_id, { timeoutMs: 120_000 });
			const res = (done.result ?? {}) as { ok?: boolean; error?: string; data?: { error?: string } };
			if (res.ok === false || res.error || res.data?.error) throw new Error(String(res.error || res.data?.error || "the scheduler could not create it"));
			window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["apps", "workflows"] } }));
			toast.success(`${title.trim()} is ready`, { description: "Add its first workflow from the graph's New. Publish it from Manage when you're ready." });
			navigate(`/studio/apps/${encodeURIComponent(name.trim())}`);
		} catch (e) {
			setError(plainCause(String((e as Error)?.message ?? e)));
			setPhase("form");
		}
	};

	return (
		<div className="mx-auto w-full max-w-2xl px-4 pb-10 md:px-6">
			<PageHeader className="pt-2" eyebrow="Your apps" title="New app"
				subtitle="A research app of your own: its workflows, the experiments it runs, and what it learns. It starts empty and private; nothing runs until you press Run." />
			<form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (!problems.length) void create(); }}>
				<label className="block space-y-1.5">
					<span className="text-meta font-medium text-ink-800">Title</span>
					<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Serving latency lab" className={field} maxLength={120} disabled={phase === "creating"} />
				</label>
				<label className="block space-y-1.5">
					<span className="text-meta font-medium text-ink-800">What it researches <span className="font-normal text-ink-600">(optional)</span></span>
					<textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={500} disabled={phase === "creating"}
						placeholder="One or two sentences. It becomes the app's summary, and its Marketplace card if you publish it." className={cn(field, "resize-y")} />
				</label>
				<div className="space-y-1.5">
					<label htmlFor="new-app-id" className="block text-meta font-medium text-ink-800">Id</label>
					<input id="new-app-id" value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value.toLowerCase()); }} disabled={phase === "creating"}
						className={cn(field, "font-mono text-caption")} aria-describedby="new-app-id-hint" />
					<p id="new-app-id-hint" className="text-micro text-ink-600">Used in links and can&apos;t change later. Lowercase letters, digits and hyphens.</p>
				</div>
				{touched && problems.length > 0 && (
					<ul role="alert" className="space-y-0.5 text-caption text-brick-700">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
				)}
				{error && <p role="alert" className="text-caption text-brick-700">Couldn&apos;t create it: {error}</p>}
				<div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
					<Button type="submit" disabled={problems.length > 0 || phase === "creating"}>
						{phase === "creating" ? <><Loader2 className="h-4 w-4 animate-spin" />Creating…</> : "Create app"}
					</Button>
					<Button type="button" variant="secondary" asChild><Link to="/studio/apps">Cancel</Link></Button>
				</div>
			</form>
		</div>
	);
}
