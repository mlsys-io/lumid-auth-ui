import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/utils";
import {
	patchCluster,
	remirrorCluster,
	type ClusterStatus,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";
import { useClusterCtx } from "./context";

export default function OverviewTab() {
	const { id, cluster, servers, nodes, workers, refresh } = useClusterCtx();
	const [saving, setSaving] = useState(false);

	const cpuWorkers = workers.filter((w) => w.type === "cpu").length;
	const gpuWorkers = workers.filter((w) => w.type === "gpu").length;
	const fmServer = servers.find((s) => s.role === "flowmesh");
	const llServer = servers.find((s) => s.role === "lumilake");

	async function onStatusChange(status: ClusterStatus) {
		setSaving(true);
		try {
			await patchCluster(id, { status });
			toast.success(`Status set to ${status}`);
			await refresh();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Update failed");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base">Identity</CardTitle>
					<CardDescription>
						Cluster metadata. Billing vendor links to Runmesh for cost attribution.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Field label="Name" value={cluster.name} />
					<Field
						label="ID"
						value={<code className="text-xs">{cluster.id}</code>}
					/>
					<Field label="Region" value={cluster.region || "—"} />
					<Field
						label="Owner"
						value={<code className="text-xs">{cluster.owner_user_id}</code>}
					/>
					<Field
						label="Billing vendor"
						value={
							cluster.billing_vendor_id
								? `#${cluster.billing_vendor_id}`
								: "— (self-owned)"
						}
					/>
					<Field
						label="Created"
						value={formatDateTime(
							new Date(cluster.created_at).getTime() / 1000,
						)}
					/>
				</CardContent>
			</Card>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base">Lifecycle</CardTitle>
					<CardDescription>
						Status flips to <code>active</code> automatically once both FM + LL servers are wired.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-1">
						<Label>Status</Label>
						<Select
							value={cluster.status}
							disabled={saving}
							onValueChange={(v) => onStatusChange(v as ClusterStatus)}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="active">active</SelectItem>
								<SelectItem value="pending">pending</SelectItem>
								<SelectItem value="disabled">disabled</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground mt-1">
							Disabled stops new worker enrollments. Existing workers continue until reaped.
						</p>
					</div>
				</CardContent>
			</Card>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Server className="w-4 h-4 text-indigo-600" />
						Summary
					</CardTitle>
					<CardDescription>
						Live counts against the cluster's nodes + workers.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 gap-3 text-sm">
						<Stat label="FlowMesh server" value={fmServer ? "wired" : "—"} />
						<Stat label="Lumilake server" value={llServer ? "wired" : "—"} />
						<Stat label="Nodes" value={String(nodes.length)} />
						<Stat label="Workers" value={String(workers.length)} />
						<Stat label="CPU workers" value={String(cpuWorkers)} />
						<Stat label="GPU workers" value={String(gpuWorkers)} />
					</div>
				</CardContent>
			</Card>

			<RunmeshMirrorCard
				clusterId={id}
				billingVendorId={cluster.billing_vendor_id ?? null}
				nodeCount={nodes.length}
			/>
		</div>
	);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div>
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-sm mt-0.5 break-all">{value}</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border bg-white/50 p-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-lg font-semibold">{value}</div>
		</div>
	);
}

function RunmeshMirrorCard({
	clusterId,
	billingVendorId,
	nodeCount,
}: {
	clusterId: string;
	billingVendorId: string | null;
	nodeCount: number;
}) {
	const [syncing, setSyncing] = useState(false);
	const linked = !!billingVendorId;
	async function onRemirror() {
		setSyncing(true);
		try {
			const r = await remirrorCluster(clusterId);
			toast.success(`Re-mirrored ${r.nodes} node${r.nodes === 1 ? "" : "s"}`);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Re-mirror failed");
		} finally {
			setSyncing(false);
		}
	}
	return (
		<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
			<CardHeader>
				<CardTitle className="text-base">Runmesh mirror</CardTitle>
				<CardDescription>
					Supplier metadata auto-synced on node register/patch/delete.
					Runmesh remains the billing source of truth.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<div>
					<div className="text-xs text-muted-foreground">Vendor</div>
					{linked ? (
						<div className="mt-0.5 break-all">
							<code className="text-xs">{billingVendorId}</code>
						</div>
					) : (
						<div className="mt-0.5 text-muted-foreground">
							Not linked — auto-set on first node registration.
						</div>
					)}
				</div>
				<div className="pt-1">
					<Button
						variant="outline"
						size="sm"
						onClick={onRemirror}
						disabled={syncing || nodeCount === 0}
						className="w-full"
					>
						{syncing && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
						Re-sync {nodeCount} node{nodeCount === 1 ? "" : "s"} to Runmesh
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					Fires upserts in the background — safe to re-run. No-op if the
					server-side bridge secret isn't configured.
				</p>
			</CardContent>
		</Card>
	);
}
