import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Cpu, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import {
	deleteWorker,
	patchWorker,
	type Node,
	type Worker,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

interface Props {
	workers: Worker[];
	nodes: Node[];
	onChange: () => void;
}

function statusBadge(status: Worker["status"]): string {
	switch (status) {
		case "idle":
			return "bg-green-100 text-green-800 border-green-200";
		case "busy":
			return "bg-blue-100 text-blue-800 border-blue-200";
		case "starting":
			return "bg-amber-100 text-amber-800 border-amber-200";
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

export default function WorkersTab({ workers, nodes, onChange }: Props) {
	const [role, setRole] = useState<string>("all");
	const [type, setType] = useState<string>("all");
	const [status, setStatus] = useState<string>("all");
	const [deleteId, setDeleteId] = useState<string | null>(null);

	const nodeMap = useMemo(() => {
		const m = new Map<string, Node>();
		nodes.forEach((n) => m.set(n.id, n));
		return m;
	}, [nodes]);

	const filtered = useMemo(() => {
		return workers.filter((w) => {
			if (role !== "all" && w.role !== role) return false;
			if (type !== "all" && w.type !== type) return false;
			if (status !== "all" && w.status !== status) return false;
			return true;
		});
	}, [workers, role, type, status]);

	async function onDeleteConfirmed() {
		if (!deleteId) return;
		try {
			await deleteWorker(deleteId);
			toast.success("Worker removed");
			setDeleteId(null);
			onChange();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Delete failed");
		}
	}

	async function onPriceSave(
		id: string,
		field: "cost_per_hour" | "selling_price_per_hour",
		value: number,
	) {
		try {
			await patchWorker(id, { [field]: value });
			toast.success("Saved");
			onChange();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Save failed");
		}
	}

	return (
		<>
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{filtered.length === workers.length
									? `${workers.length} worker${workers.length === 1 ? "" : "s"}`
									: `${filtered.length} of ${workers.length}`}
							</CardTitle>
							<CardDescription>
								Each worker is one process. Heartbeats drive status.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2 flex-wrap">
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
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{filtered.length === 0 ? (
						<p className="text-sm text-muted-foreground py-12 text-center">
							{workers.length === 0
								? "No workers have enrolled yet. Install agents on nodes and start worker processes."
								: "No workers match the current filters."}
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">ID</th>
										<th className="text-left py-2 px-2 font-medium">Role</th>
										<th className="text-left py-2 px-2 font-medium">Type</th>
										<th className="text-left py-2 px-2 font-medium">Node</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-right py-2 px-2 font-medium" title="Supplier-side rate (what we pay)">Cost/hr</th>
										<th className="text-right py-2 px-2 font-medium" title="User-facing rate (what we charge)">Sell/hr</th>
										<th className="text-right py-2 px-2 font-medium" title="Profit per hour = sell - cost">Profit</th>
										<th className="text-left py-2 px-2 font-medium">Last heartbeat</th>
										<th className="text-right py-2 px-2 font-medium"></th>
									</tr>
								</thead>
								<tbody>
									{filtered.map((w) => {
										const n = nodeMap.get(w.node_id);
										return (
											<tr key={w.id} className="border-b last:border-0 hover:bg-accent/40">
												<td className="py-2 px-2 font-mono text-xs">
													{w.id.slice(0, 8)}…
													{w.version && (
														<div className="text-xs text-muted-foreground">v{w.version}</div>
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
														{w.gpu_index != null && (
															<code className="text-xs text-muted-foreground">#{w.gpu_index}</code>
														)}
													</span>
												</td>
												<td className="py-2 px-2 text-muted-foreground">
													{n ? (
														<>
															<div className="text-sm">{n.hostname}</div>
															<div className="text-xs font-mono">{n.address}</div>
														</>
													) : (
														<code className="text-xs">{w.node_id.slice(0, 8)}…</code>
													)}
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
												<td className="py-2 px-2 text-right">
													<PriceCell
														value={w.cost_per_hour}
														onSave={(v) => onPriceSave(w.id, "cost_per_hour", v)}
													/>
												</td>
												<td className="py-2 px-2 text-right">
													<PriceCell
														value={w.selling_price_per_hour}
														onSave={(v) => onPriceSave(w.id, "selling_price_per_hour", v)}
													/>
												</td>
												<td className="py-2 px-2 text-right text-xs">
													{(() => {
														const p = (w.selling_price_per_hour || 0) - (w.cost_per_hour || 0);
														if (p === 0) return <span className="text-muted-foreground">—</span>;
														return (
															<span className={p > 0 ? "text-green-700" : "text-red-700"}>
																{p > 0 ? "+" : ""}${p.toFixed(2)}
															</span>
														);
													})()}
												</td>
												<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
													{w.last_heartbeat ? (
														<HeartbeatCell ts={w.last_heartbeat} />
													) : (
														<span className="text-xs">—</span>
													)}
												</td>
												<td className="py-2 px-2 text-right">
													<Button
														size="sm"
														variant="ghost"
														className="text-red-600 hover:bg-red-50"
														onClick={() => setDeleteId(w.id)}
													>
														<Trash2 className="w-4 h-4" />
													</Button>
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

			<AlertDialog
				open={deleteId !== null}
				onOpenChange={(o) => !o && setDeleteId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Force-deregister this worker?</AlertDialogTitle>
						<AlertDialogDescription>
							The worker process will get a 401 on its next heartbeat and exit. Use this for stuck rows only — a clean stop goes through the worker's own /status endpoint.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={onDeleteConfirmed}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Deregister
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// PriceCell — click-to-edit number cell. Shows "$X.XXXX" (or em-dash for 0)
// in display mode; on click swaps to an input. Enter or blur commits via
// onSave; Escape reverts. Save is no-op if the value didn't change.
function PriceCell({
	value,
	onSave,
}: {
	value: number;
	onSave: (v: number) => void | Promise<void>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(String(value || 0));
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!editing) setDraft(String(value || 0));
	}, [value, editing]);

	useEffect(() => {
		if (editing) inputRef.current?.select();
	}, [editing]);

	function commit() {
		const n = parseFloat(draft);
		setEditing(false);
		if (Number.isFinite(n) && n >= 0 && n !== value) {
			onSave(n);
		} else {
			setDraft(String(value || 0));
		}
	}

	if (editing) {
		return (
			<Input
				ref={inputRef}
				type="number"
				step="0.0001"
				min="0"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					else if (e.key === "Escape") {
						setDraft(String(value || 0));
						setEditing(false);
					}
				}}
				className="h-7 w-20 text-right text-xs ml-auto"
			/>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setEditing(true)}
			className="text-xs hover:underline hover:text-primary"
			title="Click to edit"
		>
			{value > 0 ? `$${value.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
		</button>
	);
}

// HeartbeatCell — surfaces last-heartbeat freshness at a glance.
// < 60s → green; < 5min → amber; older → red. Saves operators from
// reading raw timestamps to figure out whether a worker is alive.
function HeartbeatCell({ ts }: { ts: string }) {
	const t = new Date(ts).getTime();
	const ageS = Math.max(0, Math.floor((Date.now() - t) / 1000));
	const fmt =
		ageS < 60 ? `${ageS}s ago`
		: ageS < 3600 ? `${Math.floor(ageS / 60)}m ago`
		: ageS < 86400 ? `${Math.floor(ageS / 3600)}h ago`
		: `${Math.floor(ageS / 86400)}d ago`;
	const cls =
		ageS < 60 ? "text-green-700"
		: ageS < 300 ? "text-amber-700"
		: "text-red-700";
	return <span className={`text-xs font-medium ${cls}`} title={ts}>{fmt}</span>;
}
