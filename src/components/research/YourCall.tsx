// YourCall — make a call before the evidence arrives. The person picks the
// version they expect to win and says why; the AI checks the reasoning (in the
// chat, prefilled — the person presses send) without giving the answer away;
// once results come in, the card shows the call against what is leading.
//
// Why: in a research loop people learn judgement by committing to a call and
// then meeting the evidence — Novix's approvals let the agent think for you.
// Generic: any experiment with two or more versions can take a call.
//
// The call is kept in this browser (localStorage) — a per-person note, not
// shared state; the critique itself lives in the chat thread.

import { useEffect, useMemo, useState } from "react";
import { MessagesSquare, Target } from "lucide-react";
import type { MeExperiment } from "@/api/me";
import { Button } from "@/components/ui/button";
import { humanId, versionsOf } from "@/lib/research-map";
import { cn } from "@/lib/utils";

interface Call { version: string; why: string; at: number }
const keyOf = (app: string, id: string) => `your-call:${app}:${id}`;
function readCall(app: string, id: string): Call | null {
	try { const v = localStorage.getItem(keyOf(app, id)); return v ? (JSON.parse(v) as Call) : null; } catch { return null; }
}
function writeCall(app: string, id: string, c: Call | null) {
	try { if (c) localStorage.setItem(keyOf(app, id), JSON.stringify(c)); else localStorage.removeItem(keyOf(app, id)); } catch { /* private mode */ }
}

export default function YourCall({ app, e, compact = false }: { app: string; e: MeExperiment;
	/** Start as one line that opens into the form (a narrow side panel). */
	compact?: boolean }) {
	const versions = useMemo(() => versionsOf(e), [e]);
	const [call, setCall] = useState<Call | null>(() => readCall(app, e.id));
	const [pick, setPick] = useState<string>("");
	const [why, setWhy] = useState("");
	const [open, setOpen] = useState(!compact);
	useEffect(() => { setCall(readCall(app, e.id)); setPick(""); setWhy(""); setOpen(!compact); }, [app, e.id, compact]);
	if (versions.length < 2 || (e.status && /concluded|done|archived|closed/i.test(e.status))) return null;

	const leader = e.comparable !== false ? e.best_variant : undefined;
	const labelOf = (id: string) => versions.find((v) => v.id === id)?.label ?? humanId(id);
	const ask = (c: Call) => window.dispatchEvent(new CustomEvent("studio:ask", { detail: {
		prompt: `My call on the "${humanId(e.id)}" experiment: I expect ${labelOf(c.version)} to win, because ${c.why || "(no reason given)"}. `
			+ `Check my reasoning: what would make it right or wrong, and what result should I look for? Don't tell me the results.`,
		context: { app },
	} }));

	if (call) {
		const right = leader ? leader === call.version : null;
		return (
			<div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 text-caption space-y-1">
				<div className="flex items-center gap-1.5 text-ink-800">
					<Target className="w-3.5 h-3.5 text-ink-500" aria-hidden />
					<span>Your call: <b>{labelOf(call.version)}</b>{call.why ? <> — “{call.why}”</> : null}</span>
				</div>
				<div className={cn("text-micro", right === true ? "text-gold-700" : right === false ? "text-ember-700" : "text-ink-600")}>
					{leader ? (right ? `${labelOf(leader)} is leading — so far your call holds.` : `${labelOf(leader)} is leading, not your pick. What did the results show that you didn't expect?`) : "No version is leading yet — your call will be checked when one is."}
				</div>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="ghost" onClick={() => ask(call)}><MessagesSquare className="w-3.5 h-3.5" /> Ask about it</Button>
					<button type="button" className="text-micro text-ink-600 hover:text-ink-900 hover:underline" onClick={() => { writeCall(app, e.id, null); setCall(null); }}>Change my call</button>
				</div>
			</div>
		);
	}
	if (!open) {
		return (
			<button type="button" onClick={() => setOpen(true)}
				className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-ink-300 px-2.5 py-1.5 text-left text-caption text-ink-800 transition-colors hover:border-ink-400 hover:bg-muted/40">
				<Target className="h-3.5 w-3.5 flex-shrink-0 text-ink-500" aria-hidden />
				<span className="min-w-0 flex-1">Your call: which version will win?</span>
				<span className="flex-shrink-0 text-micro text-ink-600">Make a call</span>
			</button>
		);
	}
	return (
		<form
			className="rounded-lg border border-dashed border-ink-300 px-3 py-2 space-y-1.5"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (!pick) return;
				const c = { version: pick, why: why.trim(), at: Date.now() };
				writeCall(app, e.id, c); setCall(c); ask(c);
			}}
		>
			<div className="flex items-center gap-1.5 text-caption font-medium text-ink-900">
				<Target className="w-3.5 h-3.5 text-ink-500" aria-hidden /> Your call — which version do you expect to win, and why?
			</div>
			<div className="flex items-center gap-2 flex-wrap">
				<select aria-label="The version you expect to win" value={pick} onChange={(ev) => setPick(ev.target.value)}
					className="h-8 rounded-lg border border-ink-200 bg-card px-2 text-caption text-ink-900">
					<option value="">Pick a version…</option>
					{versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
				</select>
				<input aria-label="Why you expect it" value={why} onChange={(ev) => setWhy(ev.target.value)} placeholder="because…"
					className="h-8 flex-1 min-w-[12rem] rounded-lg border border-ink-200 bg-card px-2 text-caption text-ink-900 placeholder:text-ink-500" />
				<Button type="submit" size="sm" variant="secondary" disabled={!pick}>Commit and check my reasoning</Button>
			</div>
		</form>
	);
}
