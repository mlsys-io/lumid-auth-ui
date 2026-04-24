import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
	Cpu,
	Plus,
	RefreshCw,
	Server,
	Terminal,
	Trash2,
	Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
	cancelRental,
	getTask,
	type Task,
	type TaskStatus,
} from "@/api/flowmesh";
import {
	getLocalRentals,
	removeLocalRental,
	type LocalRental,
} from "./storage";

// FlowMesh doesn't expose a user-scoped workflow listing today, so the
// list is backed by localStorage per-user. Each row polls GET /tasks/:id
// on a staggered cadence for live status; stale/CANCELLED rows can be
// cleaned up with one click.

const POLL_MS = 10_000;

function statusBadge(s: TaskStatus | "LOST" | "UNKNOWN"): string {
	switch (s) {
		case "DONE":
			return "bg-gray-100 text-gray-700 border-gray-200";
		case "DISPATCHED":
			return "bg-green-100 text-green-800 border-green-200";
		case "PENDING":
			return "bg-amber-100 text-amber-800 border-amber-200";
		case "FAILED":
			return "bg-red-100 text-red-800 border-red-200";
		case "CANCELLED":
			return "bg-slate-200 text-slate-700 border-slate-300";
		default:
			return "bg-gray-100 text-gray-700 border-gray-200";
	}
}

function statusLabel(s: TaskStatus | "LOST" | "UNKNOWN"): string {
	switch (s) {
		case "PENDING":
			return "queued";
		case "DISPATCHED":
			return "running";
		case "DONE":
			return "finished";
		case "FAILED":
			return "failed";
		case "CANCELLED":
			return "cancelled";
		default:
			return s.toLowerCase();
	}
}

interface Row {
	rental: LocalRental;
	task: Task | null;
	error?: string;
}

export default function GpuRentalsList() {
	const { user } = useAuth();
	const navigate = useNavigate();
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [tick, setTick] = useState(0);

	// Single effect drives both initial load and every poll — always
	// reading the latest localStorage snapshot so rentals added /
	// removed between ticks are picked up without needing the effect
	// to re-mount. Fixes a stale-closure bug in the previous version.
	useEffect(() => {
		if (!user?.id) return;
		let alive = true;
		const uid = String(user.id);

		const refreshAll = async () => {
			const rentals = getLocalRentals(uid);
			// Prime rows synchronously so newly-saved rentals show up
			// immediately, even if their first task fetch is still in flight.
			setRows((old) =>
				rentals.map((r) => {
					const prev = old.find((o) => o.rental.task_id === r.task_id);
					return prev ? { ...prev, rental: r } : { rental: r, task: null };
				}),
			);
			setLoading(false);
			await Promise.all(
				rentals.map(async (r) => {
					try {
						const t = await getTask(r.task_id);
						if (!alive) return;
						setRows((old) =>
							old.map((o) =>
								o.rental.task_id === r.task_id
									? { ...o, task: t, error: undefined }
									: o,
							),
						);
					} catch (e) {
						if (!alive) return;
						setRows((old) =>
							old.map((o) =>
								o.rental.task_id === r.task_id
									? { ...o, error: (e as Error)?.message ?? "fetch failed" }
									: o,
							),
						);
					}
				}),
			);
		};

		void refreshAll();
		const iv = setInterval(() => void refreshAll(), POLL_MS);
		return () => {
			alive = false;
			clearInterval(iv);
		};
	}, [user?.id, tick]);

	async function onCancel(row: Row) {
		try {
			await cancelRental(row.rental.task_id, row.rental.workflow_id);
			toast.success("Cancellation requested");
			setTick((t) => t + 1);
		} catch (e) {
			toast.error((e as Error)?.message ?? "Cancel failed");
		}
	}

	function onCleanup(row: Row) {
		if (!user?.id) return;
		removeLocalRental(String(user.id), row.rental.task_id);
		setRows((old) => old.filter((r) => r.rental.task_id !== row.rental.task_id));
		toast.success("Removed from list");
	}

	const hasAny = rows.length > 0;

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<Server className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">GPU rentals</h1>
				<span className="text-sm text-muted-foreground ml-2">
					Ephemeral GPU containers via FlowMesh SSH tasks. TTL-bounded, billed per hour.
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setTick((t) => t + 1)}
						disabled={loading}
						title="Refresh"
					>
						<RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
					</Button>
					<Link to="/app/gpu-rentals/new">
						<Button size="sm">
							<Plus className="w-4 h-4 mr-1" />
							New rental
						</Button>
					</Link>
				</div>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base">
						{hasAny
							? `${rows.length} rental${rows.length === 1 ? "" : "s"} on this device`
							: "No rentals yet"}
					</CardTitle>
					<CardDescription>
						{hasAny
							? "Cancelled / expired rows stop polling — hit the trash icon to remove them from this list."
							: "Click New rental to provision an SSH-accessible container via FlowMesh."}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{!hasAny ? (
						<div className="py-12 text-center">
							<Button onClick={() => navigate("/app/gpu-rentals/new")}>
								<Plus className="w-4 h-4 mr-1" />
								Create your first rental
							</Button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Name</th>
										<th className="text-left py-2 px-2 font-medium">Spec</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-left py-2 px-2 font-medium">Created</th>
										<th className="text-right py-2 px-2 font-medium"></th>
									</tr>
								</thead>
								<tbody>
									{rows.map((r) => (
										<RentalRow
											key={r.rental.task_id}
											row={r}
											onCancel={() => onCancel(r)}
											onCleanup={() => onCleanup(r)}
										/>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</>
	);
}

function RentalRow({
	row,
	onCancel,
	onCleanup,
}: {
	row: Row;
	onCancel: () => void;
	onCleanup: () => void;
}) {
	const s: TaskStatus | "UNKNOWN" = row.task?.status ?? "UNKNOWN";
	const isLive = s === "PENDING" || s === "DISPATCHED";
	const spec = row.rental.spec_summary;
	return (
		<tr className="border-b last:border-0 hover:bg-accent/40">
			<td className="py-2 px-2">
				<Link
					to={`/app/gpu-rentals/${encodeURIComponent(row.rental.task_id)}`}
					className="text-indigo-600 hover:underline font-medium"
				>
					{row.rental.name}
				</Link>
				<div className="text-xs text-muted-foreground font-mono">
					{row.rental.task_id.slice(0, 16)}…
				</div>
			</td>
			<td className="py-2 px-2 text-muted-foreground">
				<span className="inline-flex items-center gap-1">
					{spec.gpu > 0 ? (
						<Zap className="w-3.5 h-3.5 text-amber-500" />
					) : (
						<Cpu className="w-3.5 h-3.5 text-slate-500" />
					)}
					{spec.gpu > 0
						? `${spec.gpu}× GPU${spec.gpuMemoryGb ? ` ${spec.gpuMemoryGb}GB` : ""}`
						: "CPU only"}
					{spec.cpu != null && spec.cpu > 0 && <span>· {spec.cpu}c</span>}
					{spec.memoryGb != null && spec.memoryGb > 0 && (
						<span>· {spec.memoryGb}GiB</span>
					)}
				</span>
			</td>
			<td className="py-2 px-2">
				{row.error ? (
					<span className="text-xs text-red-600">err: {row.error}</span>
				) : (
					<span
						className={cn(
							"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
							statusBadge(s),
						)}
					>
						{statusLabel(s)}
					</span>
				)}
			</td>
			<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
				{formatDateTime(row.rental.created_at)}
			</td>
			<td className="py-2 px-2 text-right">
				{isLive ? (
					<div className="inline-flex items-center gap-1">
						<Link to={`/app/gpu-rentals/${encodeURIComponent(row.rental.task_id)}`}>
							<Button size="sm" variant="outline">
								<Terminal className="w-4 h-4 mr-1" />
								Connect
							</Button>
						</Link>
						<Button
							size="sm"
							variant="ghost"
							className="text-red-600 hover:bg-red-50"
							onClick={onCancel}
							title="Cancel rental"
						>
							<Trash2 className="w-4 h-4" />
						</Button>
					</div>
				) : (
					<Button
						size="sm"
						variant="ghost"
						className="text-slate-500"
						onClick={onCleanup}
						title="Remove from list"
					>
						<Trash2 className="w-4 h-4" />
					</Button>
				)}
			</td>
		</tr>
	);
}
