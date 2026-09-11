// Submit — hand a workflow to ONE site.
//
// WHY A SITE PICKER AND NOT "THE MESH". There is no cross-site submit and there
// cannot be one today: each site runs its own FlowMesh server, Redis and
// dispatcher, worker ids are per-site (`wkr-18` exists on BOTH home and office),
// and `POST /fm/api/v1/workflows` on the merged prefix is refused — mesh-federator
// federates LIST reads only and its own header says it must never be given write
// paths to fan out. So "run this across two clusters" is two submissions, and the
// form says so rather than implying a scheduler that spans them.
//
// The site list comes from a genuinely federated read, so a new site appears here
// as soon as FEDERATOR_SITES grows — no literal to update.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { isSessionExpired } from "../../api/client";
import { listWorkers, submitWorkflow, type FmSubmitResult } from "../../api/fm";
import { SiteStrip, TabShell, useFanout } from "./shared";

// Starters, not a schema. The GPU one pins `type: "RTX 5080"` because
// `resources.hardware.gpu.type` is a case-insensitive SUBSTRING match
// (`gpu_type_pattern`), which is the only way to keep a task off the wrong card
// on a mixed site — office carries 5080s, a 5090 and two RTX 6000 Adas, and an
// unpinned task lands wherever the dispatcher looks first.
const TEMPLATES: Record<string, string> = {
	"inference (GPU, pinned to RTX 5080)": `apiVersion: flowmesh/v1
kind: InferenceTask
metadata: {name: my-inference}
spec:
  taskType: inference
  model:
    source: {type: huggingface, identifier: Qwen/Qwen2.5-0.5B-Instruct}
    vllm: {gpu_memory_utilization: 0.35, max_model_len: 2048}
  data:
    type: list
    items:
      - - role: user
          content: "What is the capital city of France? Answer with the city name only."
  inference: {temperature: 0.0, max_tokens: 32}
  resources:
    hardware:
      gpu: {count: 1, type: "RTX 5080"}
`,
	"echo (CPU, no GPU needed)": `apiVersion: flowmesh/v1
kind: EchoTask
metadata: {name: my-echo}
spec:
  taskType: echo
  data:
    type: list
    items: ["hello from the submit tab"]
`,
};

export default function SubmitTab() {
	// Roster from a federated read: adding a site is an env change on the
	// federator, and this picker follows it without a code edit.
	const { data, loading, error, refresh } = useFanout(() => listWorkers(), 60_000);
	const sites = useMemo(
		() => (data?.sites ?? []).map((s) => s.site).sort(),
		[data],
	);
	const [site, setSite] = useState("");
	const [yaml, setYaml] = useState(TEMPLATES[Object.keys(TEMPLATES)[0]]);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<FmSubmitResult | null>(null);
	const [failed, setFailed] = useState<string | null>(null);

	const chosen = site || sites[0] || "";

	async function onSubmit() {
		if (!chosen) {
			toast.error("Pick a site first");
			return;
		}
		setBusy(true);
		setResult(null);
		setFailed(null);
		try {
			const r = await submitWorkflow(chosen, yaml);
			setResult(r);
			toast.success(`Submitted to ${chosen}`);
		} catch (e) {
			if (isSessionExpired(e)) return;
			// A submit carries YOUR token and the site authorizes it itself, so a
			// refusal here is about entitlement on that mesh — not a federator fault.
			setFailed((e as Error)?.message || "submit failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<TabShell
			subtitle="Hand a workflow to one site. Cross-site runs are two submissions — there is no scheduler spanning sites."
			loading={loading}
			error={error}
			onRefresh={refresh}
		>
			<SiteStrip sites={data?.sites ?? []} />

			<div className="mb-3 flex flex-wrap items-end gap-3">
				<div>
					<label className="mb-1 block text-xs text-slate-500">Site</label>
					<select
						value={chosen}
						onChange={(e) => setSite(e.target.value)}
						className="rounded-md border border-slate-200 px-2 py-1 text-sm"
					>
						{sites.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="mb-1 block text-xs text-slate-500">Template</label>
					<select
						onChange={(e) => setYaml(TEMPLATES[e.target.value] ?? yaml)}
						className="rounded-md border border-slate-200 px-2 py-1 text-sm"
					>
						{Object.keys(TEMPLATES).map((k) => (
							<option key={k} value={k}>
								{k}
							</option>
						))}
					</select>
				</div>
				<button
					type="button"
					onClick={() => void onSubmit()}
					disabled={busy || !chosen}
					className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
				>
					{busy ? "Submitting…" : "Submit"}
				</button>
			</div>

			<textarea
				value={yaml}
				onChange={(e) => setYaml(e.target.value)}
				spellCheck={false}
				rows={20}
				className="w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed"
			/>

			{failed && (
				<div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
					{failed}
				</div>
			)}

			{result && (
				<div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
					<p className="text-xs text-slate-500">Submitted to {chosen}</p>
					<p className="mt-1 font-mono text-xs text-slate-800">{result.workflow_id}</p>
					<table className="mt-2 w-full text-xs">
						<thead className="text-left text-slate-500">
							<tr>
								<th className="py-1">Task</th>
								<th className="py-1">Status</th>
								<th className="py-1">Worker</th>
							</tr>
						</thead>
						<tbody>
							{(result.tasks ?? []).map((t) => (
								<tr key={t.task_id} className="border-t border-slate-100">
									<td className="py-1 font-mono">{t.task_id}</td>
									<td className="py-1">{t.status}</td>
									<td className="py-1">{t.assigned_worker ?? "—"}</td>
								</tr>
							))}
						</tbody>
					</table>
					{/* PENDING is normal on an elastic site, not a failure: vast starts at
					    zero workers and the autoscaler rents on demand, but boot is
					    dominated by a 14.1 GB image pull (7-15 min). Saying so here stops
					    a correct queue from reading as a stuck job. */}
					<p className="mt-2 text-xs text-slate-500">
						A task can sit <code>PENDING</code> until a matching worker exists. On{" "}
						<code>vast</code> that means renting one — the autoscaler reacts within a
						minute, but the image pull takes 7-15 minutes. Track it in{" "}
						<a href="/studio/admin/fm/jobs" className="text-indigo-600 hover:underline">
							Jobs
						</a>
						, where you can also read the result.
					</p>
				</div>
			)}
		</TabShell>
	);
}
