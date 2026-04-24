import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Cpu, RefreshCw, Server, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn, formatDateTime } from "@/lib/utils";
import {
	listClusters,
	listWorkers,
	type Cluster,
	type Worker,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

function statusBadge(status: Worker["status"]): string {
	switch (status) {
		case "idle":
			return "bg-green-100 text-green-800 border-green-200";
		case "busy":
			return "bg-blue-100 text-blue-800 border-blue-200";
		case "starting":
		case "stopping":
			return "bg-amber-100 text-amber-800 border-amber-200";
		case "stopped":
			return "bg-gray-100 text-gray-800 border-gray-200";
		case "lost":
			return "bg-red-100 text-red-800 border-red-200";
		default:
			return "bg-gray-100 text-gray-800 border-gray-200";
	}
}

export default function WorkersAll() {
	const [workers, setWorkers] = useState<Worker[]>([]);
	const [clusters, setClusters] = useState<Cluster[]>([]);
	const [clusterId, setClusterId] = useState<string>("all");
	const [role, setRole] = useState<string>("all");
	const [type, setType] = useState<string>("all");
	const [status, setStatus] = useState<string>("all");
	const [loading, setLoading] = useState(true);

	async function refresh() {
		setLoading(true);
		try {
			const [cs, ws] = await Promise.all([
				listClusters({ page_size: 200 }),
				listWorkers({
					cluster_id: clusterId !== "all" ? clusterId : undefined,
					role: role !== "all" ? (role as Worker["role"]) : undefined,
					type: type !== "all" ? (type as Worker["type"]) : undefined,
					status: status !== "all" ? (status as Worker["status"]) : undefined,
					page_size: 500,
				}),
			]);
			setClusters(cs.clusters || []);
			setWorkers(ws.workers || []);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Failed to load workers");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clusterId, role, type, status]);

	const clusterMap = useMemo(() => {
		const m = new Map<string, Cluster>();
		clusters.forEach((c) => m.set(c.id, c));
		return m;
	}, [clusters]);

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<Server className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Workers</h1>
				<span className="text-sm text-muted-foreground ml-2">
					Cross-cluster grid. FlowMesh + Lumilake, CPU + GPU, every node.
				</span>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{workers.length === 0
									? "No workers"
									: `${workers.length} worker${workers.length === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Real-time state. Use the cluster detail page to deregister.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2 flex-wrap">
							<Select value={clusterId} onValueChange={setClusterId}>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All clusters</SelectItem>
									{clusters.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value={role} onValueChange={setRole}>
								<SelectTrigger className="w-36">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All roles</SelectItem>
									<SelectItem value="flowmesh">FlowMesh</SelectItem>
									<SelectItem value="lumilake">Lumilake</SelectItem>
								</SelectContent>
							</Select>
							<Select value={type} onValueChange={setType}>
								<SelectTrigger className="w-32">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All types</SelectItem>
									<SelectItem value="cpu">CPU</SelectItem>
									<SelectItem value="gpu">GPU</SelectItem>
								</SelectContent>
							</Select>
							<Select value={status} onValueChange={setStatus}>
								<SelectTrigger className="w-36">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All status</SelectItem>
									<SelectItem value="idle">Idle</SelectItem>
									<SelectItem value="busy">Busy</SelectItem>
									<SelectItem value="starting">Starting</SelectItem>
									<SelectItem value="stopping">Stopping</SelectItem>
									<SelectItem value="stopped">Stopped</SelectItem>
									<SelectItem value="lost">Lost</SelectItem>
								</SelectContent>
							</Select>
							<Button
								variant="outline"
								size="sm"
								onClick={refresh}
								disabled={loading}
							>
								<RefreshCw
									className={cn("w-4 h-4", loading && "animate-spin")}
								/>
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{loading && workers.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : workers.length === 0 ? (
						<p className="text-sm text-muted-foreground py-12 text-center">
							No workers match.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Cluster</th>
										<th className="text-left py-2 px-2 font-medium">Role</th>
										<th className="text-left py-2 px-2 font-medium">Type</th>
										<th className="text-left py-2 px-2 font-medium">Node</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-left py-2 px-2 font-medium">Last heartbeat</th>
									</tr>
								</thead>
								<tbody>
									{workers.map((w) => {
										const cl = clusterMap.get(w.cluster_id);
										return (
											<tr
												key={w.id}
												className="border-b last:border-0 hover:bg-accent/40"
											>
												<td className="py-2 px-2">
													{cl ? (
														<Link
															to={`/app/admin/clusters/${encodeURIComponent(cl.id)}`}
															className="text-indigo-600 hover:underline"
														>
															{cl.name}
														</Link>
													) : (
														<code className="text-xs">{w.cluster_id.slice(0, 8)}…</code>
													)}
												</td>
												<td className="py-2 px-2 capitalize">{w.role}</td>
												<td className="py-2 px-2">
													<span className="inline-flex items-center gap-1">
														{w.type === "gpu" ? (
															<Zap className="w-3.5 h-3.5 text-amber-500" />
														) : (
															<Cpu className="w-3.5 h-3.5 text-slate-500" />
														)}
														{w.type}
													</span>
												</td>
												<td className="py-2 px-2 text-muted-foreground font-mono text-xs">
													{w.node_id.slice(0, 8)}…
												</td>
												<td className="py-2 px-2">
													<span
														className={cn(
															"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
															statusBadge(w.status),
														)}
													>
														{w.status}
													</span>
												</td>
												<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
													{w.last_heartbeat
														? formatDateTime(new Date(w.last_heartbeat).getTime() / 1000)
														: "—"}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</>
	);
}
