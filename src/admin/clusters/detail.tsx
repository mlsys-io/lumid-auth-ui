import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
	ArrowLeft,
	Layers,
	Loader2,
	Pencil,
	RefreshCw,
	Server,
	Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatDateTime } from "@/lib/utils";
import {
	deleteCluster,
	getCluster,
	listNodes,
	listServers,
	listWorkers,
	patchCluster,
	remirrorCluster,
	type Cluster,
	type ClusterStatus,
	type Node,
	type Worker,
	type ClusterServer,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";
import { useNavigate } from "react-router-dom";
import ServersTab from "./servers-tab";
import NodesTab from "./nodes-tab";
import WorkersTab from "./workers-tab";
import SetupTab from "./setup-tab";
import CommercialTab from "./commercial-tab";

function statusBadge(status: Cluster["status"]): string {
	switch (status) {
		case "active":
			return "bg-green-100 text-green-800 border-green-200";
		case "disabled":
			return "bg-red-100 text-red-800 border-red-200";
		case "pending":
			return "bg-amber-100 text-amber-800 border-amber-200";
		default:
			return "bg-gray-100 text-gray-800 border-gray-200";
	}
}

export default function ClusterDetail() {
	const { id: rawId } = useParams<{ id: string }>();
	const id = rawId || "";
	const navigate = useNavigate();

	const [cluster, setCluster] = useState<Cluster | null>(null);
	const [servers, setServers] = useState<ClusterServer[]>([]);
	const [nodes, setNodes] = useState<Node[]>([]);
	const [workers, setWorkers] = useState<Worker[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);

	async function refresh() {
		setLoading(true);
		try {
			const [c, s, n, w] = await Promise.all([
				getCluster(id),
				listServers(id),
				listNodes({ cluster_id: id, page_size: 200 }),
				listWorkers({ cluster_id: id, page_size: 500 }),
			]);
			setCluster(c);
			setServers(s);
			setNodes(n?.nodes || []);
			setWorkers(w?.workers || []);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Failed to load cluster");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		if (id) refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id]);

	async function onStatusChange(status: ClusterStatus) {
		if (!cluster) return;
		setSaving(true);
		try {
			const updated = await patchCluster(id, { status });
			setCluster(updated);
			toast.success(`Status set to ${status}`);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Update failed");
		} finally {
			setSaving(false);
		}
	}

	async function onDelete() {
		setSaving(true);
		try {
			await deleteCluster(id);
			toast.success("Cluster deleted");
			navigate("/app/admin/clusters");
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Delete failed");
			setSaving(false);
			setDeleteOpen(false);
		}
	}

	const cpuWorkers = workers.filter((w) => w.type === "cpu").length;
	const gpuWorkers = workers.filter((w) => w.type === "gpu").length;
	const fmServer = servers.find((s) => s.role === "flowmesh");
	const llServer = servers.find((s) => s.role === "lumilake");

	return (
		<>
			<header className="flex items-center gap-3 mb-6 flex-wrap">
				<Link to="/app/admin/clusters">
					<Button variant="ghost" size="sm">
						<ArrowLeft className="w-4 h-4 mr-1" />
						Clusters
					</Button>
				</Link>
				<Layers className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">
					{cluster ? cluster.name : loading ? "Loading…" : "Not found"}
				</h1>
				{cluster && (
					<span
						className={cn(
							"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
							statusBadge(cluster.status),
						)}
					>
						{cluster.status}
					</span>
				)}
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={refresh}
						disabled={loading}
					>
						<RefreshCw
							className={cn("w-4 h-4 mr-1", loading && "animate-spin")}
						/>
						Refresh
					</Button>
					{cluster && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setEditOpen(true)}
							disabled={saving}
						>
							<Pencil className="w-4 h-4 mr-1" />
							Edit
						</Button>
					)}
					{cluster && (
						<Button
							variant="outline"
							size="sm"
							className="text-red-600 hover:bg-red-50"
							onClick={() => setDeleteOpen(true)}
							disabled={saving}
						>
							<Trash2 className="w-4 h-4 mr-1" />
							Delete
						</Button>
					)}
				</div>
			</header>

			{!cluster && !loading && (
				<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
					<CardContent className="py-12 text-center text-sm text-muted-foreground">
						No cluster with id <code>{id}</code>.
					</CardContent>
				</Card>
			)}

			{cluster && (
				<Tabs defaultValue="overview">
					<TabsList>
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="servers">Servers</TabsTrigger>
						<TabsTrigger value="nodes">Nodes ({nodes.length})</TabsTrigger>
						<TabsTrigger value="workers">
							Workers ({workers.length})
						</TabsTrigger>
						<TabsTrigger value="commercial">Commercial</TabsTrigger>
						<TabsTrigger value="setup">Setup guide</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="mt-4">
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
											onValueChange={(v) =>
												onStatusChange(v as ClusterStatus)
											}
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
					</TabsContent>

					<TabsContent value="servers" className="mt-4">
						<ServersTab
							clusterId={id}
							servers={servers}
							onChange={refresh}
						/>
					</TabsContent>

					<TabsContent value="nodes" className="mt-4">
						<NodesTab
							clusterId={id}
							nodes={nodes}
							onChange={refresh}
						/>
					</TabsContent>

					<TabsContent value="workers" className="mt-4">
						<WorkersTab
							workers={workers}
							nodes={nodes}
							onChange={refresh}
						/>
					</TabsContent>

					<TabsContent value="commercial" className="mt-4">
						<CommercialTab clusterId={id} />
					</TabsContent>

					<TabsContent value="setup" className="mt-4">
						<SetupTab clusterId={id} clusterName={cluster.name} />
					</TabsContent>
				</Tabs>
			)}

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete cluster {cluster?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the cluster record plus every server, node, and worker
							association. Enrolled agents on remote nodes will start failing
							heartbeats. Irreversible — consider <code>disabled</code> first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={onDelete}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{cluster && (
				<EditClusterDialog
					open={editOpen}
					onOpenChange={setEditOpen}
					cluster={cluster}
					onSaved={(updated) => {
						setCluster(updated);
						setEditOpen(false);
					}}
				/>
			)}
		</>
	);
}

function EditClusterDialog({
	open,
	onOpenChange,
	cluster,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	cluster: Cluster;
	onSaved: (c: Cluster) => void;
}) {
	const [name, setName] = useState(cluster.name);
	const [region, setRegion] = useState(cluster.region || "");
	const [tags, setTags] = useState(() =>
		Array.isArray(cluster.tags) ? cluster.tags.join(", ") : "",
	);
	const [billing, setBilling] = useState(
		cluster.billing_vendor_id != null ? String(cluster.billing_vendor_id) : "",
	);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (open) {
			setName(cluster.name);
			setRegion(cluster.region || "");
			setTags(Array.isArray(cluster.tags) ? cluster.tags.join(", ") : "");
			setBilling(
				cluster.billing_vendor_id != null
					? String(cluster.billing_vendor_id)
					: "",
			);
		}
	}, [open, cluster]);

	async function onSave(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			toast.error("Name required");
			return;
		}
		const parsedTags = tags
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const billingTrim = billing.trim();
		setSaving(true);
		try {
			// billing_vendor_id is auto-set by the supplier-node mirror;
			// the edit form no longer sends it to avoid clobbering the
			// server-managed value.
			const updated = await patchCluster(cluster.id, {
				name: trimmed,
				region: region.trim(),
				tags: parsedTags,
			});
			toast.success("Saved");
			onSaved(updated);
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Save failed");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Edit cluster</DialogTitle>
					<DialogDescription>
						Status is edited on the Overview card; delete from the top bar.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSave} className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor="edit-name">Name</Label>
						<Input
							id="edit-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="edit-region">Region</Label>
						<Input
							id="edit-region"
							value={region}
							onChange={(e) => setRegion(e.target.value)}
							placeholder="sg | us-east | …"
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="edit-tags">Tags</Label>
						<Input
							id="edit-tags"
							value={tags}
							onChange={(e) => setTags(e.target.value)}
							placeholder="comma-separated"
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="edit-billing">Billing vendor ID (Runmesh)</Label>
						<Input
							id="edit-billing"
							value={billing || "— will auto-set on first node registration"}
							readOnly
							className="bg-muted text-muted-foreground"
						/>
						<p className="text-xs text-muted-foreground">
							Auto-linked via the supplier-node mirror. Clear by unlinking
							the cluster from its Runmesh vendor row directly.
						</p>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={saving || !name.trim()}>
							{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
							Save changes
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
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

// RunmeshMirrorCard — shows whether the Runmesh supplier-node bridge is
// live and offers a "re-push everything" action for nodes that
// pre-date the auto-mirror (or to recover from a Runmesh outage).
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
