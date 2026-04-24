import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
	ChevronLeft,
	ChevronRight,
	Layers,
	Plus,
	RefreshCw,
	Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
	type Cluster,
	type ClusterStatus,
	type ListClustersParams,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

const PAGE_SIZE = 50;

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

export default function ClustersList() {
	const [clusters, setClusters] = useState<Cluster[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [status, setStatus] = useState<ListClustersParams["status"]>("all");
	const [q, setQ] = useState("");
	const [qDebounced, setQDebounced] = useState("");
	const [loading, setLoading] = useState(true);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const t = setTimeout(() => setQDebounced(q.trim()), 300);
		return () => clearTimeout(t);
	}, [q]);

	useEffect(() => {
		setPage(1);
	}, [status, qDebounced]);

	useEffect(() => {
		const ctrl = new AbortController();
		(async () => {
			setLoading(true);
			try {
				const r = await listClusters({
					status,
					q: qDebounced || undefined,
					page,
					page_size: PAGE_SIZE,
				});
				if (ctrl.signal.aborted) return;
				// Defensive: the cluster API isn't wired up in every env
				// (legacy nginx can return the SPA index as a fallback),
				// so r can be undefined/HTML. Treat that as "no clusters".
				setClusters(r?.clusters || []);
				setTotal(r?.total || 0);
			} catch (e: unknown) {
				if (ctrl.signal.aborted || isSessionExpired(e)) return;
				toast.error((e as Error)?.message || "Failed to load clusters");
			} finally {
				if (!ctrl.signal.aborted) setLoading(false);
			}
		})();
		return () => ctrl.abort();
	}, [status, qDebounced, page, tick]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<Layers className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Clusters</h1>
				<span className="text-sm text-muted-foreground ml-2">
					One cluster = one FlowMesh server + one Lumilake server, paired. Nodes and workers live inside.
				</span>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total === 0 ? "No clusters" : `${total} cluster${total === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Create a cluster, wire its FM + LL servers, then add nodes via install.sh.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setTick((t) => t + 1)}
								disabled={loading}
								title="Refresh"
							>
								<RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
							</Button>
							<Link to="/app/admin/clusters/new">
								<Button size="sm">
									<Plus className="w-4 h-4 mr-1" />
									New cluster
								</Button>
							</Link>
						</div>
					</div>

					<div className="mt-4 flex items-center gap-3 flex-wrap">
						<div className="relative">
							<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="pl-9 w-64"
								placeholder="Search by name…"
								value={q}
								onChange={(e) => setQ(e.target.value)}
							/>
						</div>
						<Select
							value={status || "all"}
							onValueChange={(v) => setStatus(v as ListClustersParams["status"])}
						>
							<SelectTrigger className="w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="pending">Pending</SelectItem>
								<SelectItem value="disabled">Disabled</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</CardHeader>

				<CardContent>
					{loading && clusters.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : clusters.length === 0 ? (
						<div className="py-12 text-center">
							<p className="text-sm text-muted-foreground mb-4">
								No clusters yet. Create one to wire up FlowMesh + Lumilake.
							</p>
							<Link to="/app/admin/clusters/new">
								<Button>
									<Plus className="w-4 h-4 mr-1" />
									Create first cluster
								</Button>
							</Link>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Name</th>
										<th className="text-left py-2 px-2 font-medium">Region</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-left py-2 px-2 font-medium">Billing vendor</th>
										<th className="text-left py-2 px-2 font-medium">Created</th>
									</tr>
								</thead>
								<tbody>
									{clusters.map((c) => (
										<tr key={c.id} className="border-b last:border-0 hover:bg-accent/40">
											<td className="py-2 px-2">
												<Link
													to={`/app/admin/clusters/${encodeURIComponent(c.id)}`}
													className="text-indigo-600 hover:underline font-medium"
												>
													{c.name}
												</Link>
												<div className="text-xs text-muted-foreground font-mono">{c.id}</div>
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{c.region || "—"}
											</td>
											<td className="py-2 px-2">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														statusBadge(c.status),
													)}
												>
													{c.status}
												</span>
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{c.billing_vendor_id ? `#${c.billing_vendor_id}` : "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{c.created_at
													? formatDateTime(new Date(c.created_at).getTime() / 1000)
													: "—"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{totalPages > 1 && (
						<div className="flex items-center justify-between mt-4 text-sm">
							<span className="text-muted-foreground">
								Page {page} of {totalPages} · {total} total
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPage((p) => Math.max(1, p - 1))}
								>
									<ChevronLeft className="w-4 h-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								>
									<ChevronRight className="w-4 h-4" />
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</>
	);
}

// re-export for convenience in other files
export type { ClusterStatus };
