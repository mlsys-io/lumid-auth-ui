// RunVersions — the experiment's one obvious next step: run the versions it
// hasn't tried (or, once all have run, each once more). Without this an
// experiment could only be fed from the chat or by a run started as one of its
// versions — MLSys Research sat at "no results" for every experiment while its
// workflow had run nine times by hand.
//
// Each version becomes one queued run attributed to the experiment (identity
// sets payload.experiment from experiment_id), exactly as the chat's
// dispatch_experiment_arm does. Runs start as compute frees up; the queue is
// shown in Compute (ComputePanel). An app whose runs need a subject this
// button cannot know (dispatch.ask) hands the request to the chat instead.

import { useState } from "react";
import { Play } from "lucide-react";
import { me, waitForIntent, type MeExperiment } from "@/api/me";
import { askOrStash } from "@/components/chat/askBus";
import { Button } from "@/components/ui/button";
import { experimentLoop, humanId, versionsToRun } from "@/lib/research-map";
import { loopLabel } from "@/lib/workflow-names";

type Sent = { n: number; loop: string } | { chat: true };

export default function RunVersions({ app, e, onQueued }: { app: string; e: MeExperiment; onQueued?: () => void }) {
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState<Sent | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const loop = experimentLoop(e);
	const { ids, untried } = versionsToRun(e);
	if (!loop || !ids.length || e.status && /concluded|done|archived|closed/i.test(e.status)) return null;
	const label = untried
		? ids.length === 1 ? `Run the untried version (${humanId(ids[0])})` : `Run the ${ids.length} untried versions`
		: `Run each version once more (${ids.length} runs)`;

	const go = async () => {
		setErr(null);
		if (e.dispatch?.ask) {
			askOrStash({
				prompt: `Run ${untried ? "the untried versions" : "each version once more"} of the "${humanId(e.id)}" experiment (${ids.join(", ")}) `
					+ `on ${app} with dispatch_experiment_arm. ${e.dispatch.ask} Ask me for anything you don't know, then queue them.`,
				context: { page: "research", app, loop },
			});
			setSent({ chat: true });
			return;
		}
		setBusy(true);
		try {
			const arms = new Map((e.arms || []).map((a) => [String(a.id), a]));
			const intents: string[] = [];
			for (const id of ids) {
				const { id: _id, description: _d, ...overrides } = (arms.get(id) || { id }) as Record<string, unknown>;
				const r = await me.enqueueRuns(app, loop, {
					variants: [{ ...overrides, arm: id }],
					branch_label: id,
					priority: 50,
					experiment_id: e.id,
				});
				intents.push(r.intent_id);
			}
			setSent({ n: ids.length, loop });
			onQueued?.();
			// Report what the scheduler did, not what we asked for.
			Promise.all(intents.map((i) => waitForIntent(i, { timeoutMs: 90_000 }).catch(() => null)))
				.then((rs) => {
					const failed = rs.map((r) => (r?.result || {}) as Record<string, unknown>).find((o) => o.ok === false);
					if (failed) setErr(String(failed.error || "The scheduler could not queue every run."));
				});
		} catch (ex) {
			setErr(ex instanceof Error ? ex.message : String(ex));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-1">
			<Button size="sm" variant="accent" onClick={go} disabled={busy || !!sent}>
				<Play className="w-3.5 h-3.5" /> {busy ? "Queuing…" : label}
			</Button>
			{sent && "n" in sent && (
				<p className="text-caption text-ink-700" role="status">
					Queued {sent.n} run{sent.n === 1 ? "" : "s"} of {loopLabel("", sent.loop)}. They start as compute frees up — follow them under Compute.
				</p>
			)}
			{sent && "chat" in sent && <p className="text-caption text-ink-700" role="status">Handed to the chat — it needs a detail only you can give.</p>}
			{err && <p className="text-caption text-brick-700" role="alert">Couldn't queue every run: {err}</p>}
		</div>
	);
}
