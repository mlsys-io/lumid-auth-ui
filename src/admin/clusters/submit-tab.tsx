import { useState } from "react";
import { toast } from "sonner";
import { Send, Loader2, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { isSessionExpired } from "@/api/client";
import { clusterProxyPost, clusterProxyGet } from "@/api/cluster";

// Submit a raw YAML / JSON body straight to the cluster's registered
// FlowMesh (or Lumilake) host. Bypasses the Runmesh scheduler — the
// lumid_cluster proxy strips the lum.id session bearer and injects the
// per-cluster operator key from cluster_servers.storage_json.api_key
// before forwarding.
//
// Useful for operator smoke testing + the "direct dispatch" power-user
// path. Regular users still go through /dashboard/runmesh/submit (which
// uses the Runmesh scheduler against cloud kv.run by default).

const FLOWMESH_DEFAULT = `apiVersion: lumid/v1
kind: Task
metadata:
  name: cluster-smoke-echo
spec:
  taskType: echo
  data:
    type: list
    items:
      - "hello from cluster proxy"
`;

const LUMILAKE_DEFAULT_HINT = `# Lumilake jobs are JSON, not YAML — switch the role above to "lumilake"
# and PUT a JobSubmitRequest body. See lumilake.optimizer for the schema.
{
  "data": [
    {
      "workflow": "name: ll-smoke\\nops:\\n  - id: echo\\n    op: FormatOp\\n    template: 'hi'",
      "inputs": {"q": ["hello"]},
      "output_location": {"type": "s3", "prefix": "smoke/"}
    }
  ],
  "priority": "medium"
}
`;

interface SubmitResult {
	status: "submitted" | "polling" | "done" | "failed";
	workflow_id?: string;
	task_id?: string;
	final_status?: string;
	worker?: string;
	body?: unknown;
	error?: string;
}

export default function SubmitTab({ clusterId }: { clusterId: string }) {
	const [role, setRole] = useState<"flowmesh" | "lumilake">("flowmesh");
	const [body, setBody] = useState(FLOWMESH_DEFAULT);
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<SubmitResult | null>(null);

	function setRoleWithDefault(r: "flowmesh" | "lumilake") {
		setRole(r);
		// Only swap the textarea when it still holds the previous role's
		// default; preserves an in-progress edit.
		if (body === FLOWMESH_DEFAULT && r === "lumilake") {
			setBody(LUMILAKE_DEFAULT_HINT);
		} else if (body === LUMILAKE_DEFAULT_HINT && r === "flowmesh") {
			setBody(FLOWMESH_DEFAULT);
		}
	}

	async function pollTask(taskId: string) {
		// Inference can take ~45s on a cold model, but most tasks finish
		// in 1-15s. 60 polls @ 2s = 2 minutes hard cap.
		for (let i = 0; i < 60; i++) {
			try {
				const t = await clusterProxyGet<{
					status?: string;
					assigned_worker?: string | null;
					error?: string | null;
				}>(clusterId, `/api/v1/tasks/${taskId}`, { role });
				const status = t?.status || "?";
				setResult((prev) =>
					prev
						? {
								...prev,
								status: "polling",
								final_status: status,
								worker: t?.assigned_worker || prev.worker,
								body: t,
							}
						: null,
				);
				if (
					status === "DONE" ||
					status === "FAILED" ||
					status === "CANCELLED"
				) {
					setResult((prev) =>
						prev
							? {
									...prev,
									status: status === "DONE" ? "done" : "failed",
									final_status: status,
									error: t?.error || undefined,
									body: t,
								}
							: null,
					);
					return;
				}
			} catch (e) {
				if (isSessionExpired(e)) return;
				// Transient — keep polling.
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
	}

	async function onSubmit() {
		setResult(null);
		setSubmitting(true);
		try {
			if (role === "flowmesh") {
				const resp = await clusterProxyPost<{
					ok?: boolean;
					workflow_id?: string;
					tasks?: { task_id: string }[];
				}>(clusterId, "/api/v1/workflows", body, {
					role,
					contentType: "text/plain",
				});
				const taskId = resp?.tasks?.[0]?.task_id;
				setResult({
					status: "submitted",
					workflow_id: resp?.workflow_id,
					task_id: taskId,
					body: resp,
				});
				if (taskId) {
					await pollTask(taskId);
				}
			} else {
				const resp = await clusterProxyPost(
					clusterId,
					"/api/v1/jobs",
					body,
					{ role, contentType: "application/json" },
				);
				setResult({
					status: "submitted",
					body: resp,
				});
				toast.success("Lumilake job submitted");
			}
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			const msg = (e as Error)?.message || "submit failed";
			setResult({ status: "failed", error: msg });
			toast.error(msg);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
			<CardHeader>
				<CardTitle className="text-base flex items-center gap-2">
					<Server className="w-4 h-4 text-indigo-600" />
					Direct submit (proxy)
				</CardTitle>
				<CardDescription>
					Forward a raw payload to this cluster's registered server. The
					cluster proxy injects the operator key from{" "}
					<code className="text-xs">storage_json.api_key</code>; your
					session bearer is stripped before the request leaves this service.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid sm:grid-cols-[160px_1fr] gap-3 items-start">
					<Label className="pt-2">Target</Label>
					<Select
						value={role}
						onValueChange={(v) =>
							setRoleWithDefault(v as "flowmesh" | "lumilake")
						}
					>
						<SelectTrigger className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="flowmesh">FlowMesh — /workflows</SelectItem>
							<SelectItem value="lumilake">Lumilake — /jobs</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-1">
					<Label className="text-xs text-muted-foreground">
						{role === "flowmesh"
							? "FlowMesh workflow YAML (text/plain → /api/v1/workflows)"
							: "Lumilake JobSubmitRequest JSON (application/json → /api/v1/jobs)"}
					</Label>
					<Textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						className="font-mono text-xs"
						rows={14}
					/>
				</div>

				<div className="flex items-center gap-3">
					<Button onClick={onSubmit} disabled={submitting || !body.trim()}>
						{submitting ? (
							<Loader2 className="w-4 h-4 mr-1 animate-spin" />
						) : (
							<Send className="w-4 h-4 mr-1" />
						)}
						Submit
					</Button>
					<span className="text-xs text-muted-foreground">
						POSTs to{" "}
						<code className="text-[10px]">
							/api/v1/cluster/clusters/{clusterId.slice(0, 8)}…/proxy/
							{role === "flowmesh" ? "api/v1/workflows" : "api/v1/jobs"}
						</code>
					</span>
				</div>

				{result && (
					<div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
						<div className="font-medium">
							Status:{" "}
							<span
								className={
									result.status === "done"
										? "text-green-700"
										: result.status === "failed"
											? "text-red-700"
											: "text-amber-700"
								}
							>
								{result.final_status || result.status}
							</span>
							{result.worker && (
								<span className="ml-2 text-muted-foreground">
									on <code>{result.worker}</code>
								</span>
							)}
						</div>
						{result.workflow_id && (
							<div>
								workflow:{" "}
								<code className="text-[10px]">{result.workflow_id}</code>
							</div>
						)}
						{result.task_id && (
							<div>
								task: <code className="text-[10px]">{result.task_id}</code>
							</div>
						)}
						{result.error && (
							<div className="text-red-700">{result.error}</div>
						)}
						{result.body !== undefined && (
							<details>
								<summary className="cursor-pointer text-muted-foreground">
									response body
								</summary>
								<pre className="mt-1 overflow-x-auto bg-slate-900 text-slate-100 p-2 rounded text-[10px]">
									{JSON.stringify(result.body, null, 2)}
								</pre>
							</details>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
