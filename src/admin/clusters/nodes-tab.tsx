import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { cn, formatDateTime } from "@/lib/utils";
import {
	deleteNode,
	mintBootstrapToken,
	type Node,
	type MintBootstrapResponse,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

interface Props {
	clusterId: string;
	nodes: Node[];
	onChange: () => void;
}

function statusBadge(status: Node["status"]): string {
	switch (status) {
		case "active":
			return "bg-green-100 text-green-800 border-green-200";
		case "draining":
			return "bg-amber-100 text-amber-800 border-amber-200";
		case "offline":
			return "bg-red-100 text-red-800 border-red-200";
		default:
			return "bg-gray-100 text-gray-800 border-gray-200";
	}
}

export default function NodesTab({ clusterId, nodes, onChange }: Props) {
	const [mintOpen, setMintOpen] = useState(false);
	const [ttl, setTtl] = useState("60");
	const [minting, setMinting] = useState(false);
	const [result, setResult] = useState<MintBootstrapResponse | null>(null);

	const [deleteNodeId, setDeleteNodeId] = useState<string | null>(null);

	async function onMint() {
		const ttlNum = Number(ttl);
		if (!ttlNum || ttlNum < 1) {
			toast.error("TTL must be a positive integer (minutes)");
			return;
		}
		setMinting(true);
		try {
			const r = await mintBootstrapToken({
				cluster_id: clusterId,
				ttl_minutes: ttlNum,
			});
			setResult(r);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Mint failed");
		} finally {
			setMinting(false);
		}
	}

	function resetMint() {
		setResult(null);
		setMintOpen(false);
		setTtl("60");
		onChange();
	}

	async function onDeleteConfirmed() {
		if (!deleteNodeId) return;
		try {
			await deleteNode(deleteNodeId);
			toast.success("Node deleted");
			setDeleteNodeId(null);
			onChange();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Delete failed");
		}
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Copied");
		} catch {
			toast.error("Clipboard copy failed");
		}
	}

	return (
		<>
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{nodes.length === 0
									? "No nodes"
									: `${nodes.length} node${nodes.length === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Nodes enroll via <code>install.sh</code>. Mint a bootstrap token to add one.
							</CardDescription>
						</div>
						<Button size="sm" onClick={() => setMintOpen(true)}>
							<Plus className="w-4 h-4 mr-1" />
							Add node
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{nodes.length === 0 ? (
						<div className="py-12 text-center">
							<p className="text-sm text-muted-foreground mb-4">
								No nodes in this cluster yet.
							</p>
							<Button onClick={() => setMintOpen(true)}>
								<Plus className="w-4 h-4 mr-1" />
								Mint bootstrap token
							</Button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Hostname</th>
										<th className="text-left py-2 px-2 font-medium">Address</th>
										<th className="text-left py-2 px-2 font-medium">CPU / Mem</th>
										<th className="text-left py-2 px-2 font-medium">GPUs</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-left py-2 px-2 font-medium">Last seen</th>
										<th className="text-left py-2 px-2 font-medium">Added</th>
										<th className="text-right py-2 px-2 font-medium"></th>
									</tr>
								</thead>
								<tbody>
									{nodes.map((n) => (
										<tr key={n.id} className="border-b last:border-0 hover:bg-accent/40">
											<td className="py-2 px-2">
												<div className="font-medium">{n.hostname || "—"}</div>
												<div className="text-xs text-muted-foreground font-mono">{n.id}</div>
											</td>
											<td className="py-2 px-2 text-muted-foreground font-mono text-xs">
												{n.address || "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{n.cpu_cores || "?"}c / {n.memory_gb || "?"}g
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{n.gpu_count > 0
													? `${n.gpu_count}× ${n.gpu_type || "GPU"} ${n.gpu_memory_gb}g`
													: "—"}
											</td>
											<td className="py-2 px-2">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														statusBadge(n.status),
													)}
												>
													{n.status}
												</span>
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{n.last_seen
													? formatDateTime(new Date(n.last_seen).getTime() / 1000)
													: "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{n.created_at
													? formatDateTime(new Date(n.created_at).getTime() / 1000)
													: "—"}
											</td>
											<td className="py-2 px-2 text-right">
												<Button
													size="sm"
													variant="ghost"
													className="text-red-600 hover:bg-red-50"
													onClick={() => setDeleteNodeId(n.id)}
												>
													<Trash2 className="w-4 h-4" />
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Mint bootstrap dialog */}
			<Dialog
				open={mintOpen}
				onOpenChange={(o) => {
					if (!o) resetMint();
					else setMintOpen(true);
				}}
			>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Add a node</DialogTitle>
						<DialogDescription>
							Mint a one-shot bootstrap token. Copy the install command and paste it on the target node's shell.
						</DialogDescription>
					</DialogHeader>

					{!result ? (
						<div className="space-y-4">
							<div className="space-y-1">
								<Label htmlFor="ttl">TTL (minutes)</Label>
								<Input
									id="ttl"
									type="number"
									min={1}
									max={10080}
									value={ttl}
									onChange={(e) => setTtl(e.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									Short-lived — the token is single-use and expires in the given window. Default 60.
								</p>
							</div>
						</div>
					) : (
						<div className="space-y-3">
							<div>
								<Label className="text-xs text-muted-foreground">Install command</Label>
								<div className="flex items-start gap-2 mt-1">
									<pre className="flex-1 bg-slate-900 text-slate-100 text-xs p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all font-mono">
										{result.install_cmd}
									</pre>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copy(result.install_cmd)}
									>
										<Copy className="w-3 h-3" />
									</Button>
								</div>
							</div>
							<div>
								<Label className="text-xs text-muted-foreground">Raw token (only shown once)</Label>
								<div className="flex items-center gap-2 mt-1">
									<code className="flex-1 text-xs bg-slate-100 p-2 rounded break-all">
										{result.token}
									</code>
									<Button
										size="sm"
										variant="outline"
										onClick={() => copy(result.token)}
									>
										<Copy className="w-3 h-3" />
									</Button>
								</div>
								<p className="text-xs text-muted-foreground mt-1">
									Expires{" "}
									{formatDateTime(new Date(result.expires_at).getTime() / 1000)}.
								</p>
							</div>
						</div>
					)}

					<DialogFooter>
						{!result ? (
							<>
								<Button variant="outline" onClick={resetMint}>
									Cancel
								</Button>
								<Button onClick={onMint} disabled={minting}>
									{minting ? (
										<Loader2 className="w-4 h-4 mr-1 animate-spin" />
									) : (
										<KeyRound className="w-4 h-4 mr-1" />
									)}
									Mint token
								</Button>
							</>
						) : (
							<Button onClick={resetMint}>Done</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteNodeId !== null}
				onOpenChange={(o) => !o && setDeleteNodeId(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this node?</AlertDialogTitle>
						<AlertDialogDescription>
							The record is removed. Any still-running agent + workers on the host will start failing heartbeats and exit. Drain first if you want a clean shutdown.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={onDeleteConfirmed}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
