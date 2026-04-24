import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
	ArrowLeft,
	Copy,
	Loader2,
	RefreshCw,
	Server,
	Terminal,
	Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	buildConnectSnippet,
	cancelRental,
	getTask,
	streamTaskLogs,
	type LogLine,
	type LogStreamState,
	type Task,
	type TaskStatus,
} from "@/api/flowmesh";
import {
	estimateRentalCost,
	getUserBalance,
	type UserBalance,
} from "@/api/billing";
import { useAuth } from "@/hooks/useAuth";
import { getLocalRentals, removeLocalRental } from "./storage";

function statusBadge(s: TaskStatus | "UNKNOWN"): string {
	switch (s) {
		case "DONE":
		case "CANCELLED":
			return "bg-slate-100 text-slate-700 border-slate-200";
		case "DISPATCHED":
			return "bg-green-100 text-green-800 border-green-200";
		case "PENDING":
			return "bg-amber-100 text-amber-800 border-amber-200";
		case "FAILED":
			return "bg-red-100 text-red-800 border-red-200";
		default:
			return "bg-gray-100 text-gray-700 border-gray-200";
	}
}

// FlowMesh's task statuses are useful internally but confusing as UI
// labels ("DISPATCHED" doesn't read as "running" to most users). Map
// the wire-level status to the word the user actually wants to see.
function statusLabel(s: TaskStatus | "UNKNOWN"): string {
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

export default function GpuRentalDetail() {
	const { id: rawId } = useParams<{ id: string }>();
	const id = rawId || "";
	const navigate = useNavigate();
	const { user } = useAuth();

	const [task, setTask] = useState<Task | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [cancelOpen, setCancelOpen] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [logs, setLogs] = useState<LogLine[]>([]);
	const [logState, setLogState] = useState<LogStreamState>("connecting");
	const [followTail, setFollowTail] = useState(true);
	const logContainerRef = useRef<HTMLDivElement>(null);

	// Billing: user's balance + running-total cost ticker (elapsed seconds
	// × rate). Refreshed every ~5s so the user sees the bill accrue.
	const [balance, setBalance] = useState<UserBalance | null>(null);
	const [, setNowTick] = useState(0);
	useEffect(() => {
		const iv = setInterval(() => setNowTick((t) => t + 1), 1000);
		return () => clearInterval(iv);
	}, []);
	useEffect(() => {
		let alive = true;
		const refresh = async () => {
			try {
				const b = await getUserBalance();
				if (alive) setBalance(b);
			} catch {
				if (alive) setBalance(null);
			}
		};
		void refresh();
		const iv = setInterval(refresh, 15_000);
		return () => {
			alive = false;
			clearInterval(iv);
		};
	}, []);

	const localRental = useMemo(() => {
		if (!user?.id) return null;
		return getLocalRentals(String(user.id)).find((r) => r.task_id === id) || null;
	}, [user?.id, id]);

	// Poll /tasks/:id. Faster cadence before ssh_info lands, slower after.
	useEffect(() => {
		let alive = true;
		let timer: number | null = null;
		const fetchOnce = async () => {
			try {
				const t = await getTask(id);
				if (!alive) return;
				setTask(t);
				setLoadError(null);
				const hasSsh = !!t.latest_update?.ssh;
				const isTerminal = ["DONE", "FAILED", "CANCELLED"].includes(t.status);
				const nextMs = isTerminal ? 30_000 : hasSsh ? 10_000 : 3_000;
				timer = window.setTimeout(fetchOnce, nextMs);
			} catch (e) {
				if (!alive) return;
				setLoadError((e as Error)?.message ?? "fetch failed");
				timer = window.setTimeout(fetchOnce, 10_000);
			} finally {
				if (alive) setLoading(false);
			}
		};
		void fetchOnce();
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
		};
	}, [id]);

	// Log stream — open once we know the task exists. Stop on terminal state.
	useEffect(() => {
		if (!task) return;
		if (["DONE", "FAILED", "CANCELLED"].includes(task.status)) return;
		let unsub: (() => void) | null = null;
		setLogState("connecting");
		(async () => {
			unsub = await streamTaskLogs(
				id,
				(line) => {
					setLogs((old) => {
						const next = [...old, line];
						return next.length > 500 ? next.slice(-500) : next;
					});
				},
				(s) => setLogState(s),
			);
		})();
		return () => {
			if (unsub) unsub();
		};
	}, [id, task?.status]);

	// Auto-scroll the log pane when new lines arrive.
	useEffect(() => {
		if (!followTail) return;
		const el = logContainerRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [logs, followTail]);

	async function onCancel() {
		setCancelling(true);
		try {
			// cancelRental looks up the workflow_id from the task record
			// when we don't have one in localStorage (cross-device case).
			await cancelRental(id, localRental?.workflow_id);
			toast.success("Cancellation requested");
			setCancelOpen(false);
		} catch (e) {
			toast.error((e as Error)?.message ?? "Cancel failed");
		} finally {
			setCancelling(false);
		}
	}

	async function onCleanup() {
		if (!user?.id) return;
		removeLocalRental(String(user.id), id);
		toast.success("Removed from list");
		navigate("/app/gpu-rentals");
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Copied");
		} catch {
			toast.error("Clipboard failed");
		}
	}

	const snippet = task ? buildConnectSnippet(task, id) : null;
	const ssh = task?.latest_update?.ssh;
	const ttlExpiryMs = ssh?.expires_at ? Date.parse(ssh.expires_at) : null;
	const secsLeft =
		ttlExpiryMs != null ? Math.max(0, Math.floor((ttlExpiryMs - Date.now()) / 1000)) : null;
	const isTerminal = task ? ["DONE", "FAILED", "CANCELLED"].includes(task.status) : false;

	// Running cost — elapsed seconds since rental creation × the wizard's
	// flat rate. Actual billing comes from the worker's published rate
	// (settles into the ledger at teardown); this is just a live
	// indicator. Stops ticking once the task is terminal.
	const elapsedSec =
		localRental && !isTerminal
			? Math.max(0, Math.floor(Date.now() / 1000) - localRental.created_at)
			: 0;
	const runningCost = localRental
		? estimateRentalCost(
				localRental.spec_summary.gpu,
				localRental.spec_summary.cpu ?? 0,
				elapsedSec,
			).estimateForTtl
		: 0;
	const balanceNum = balance ? Number(balance.amount) : 0;
	const balanceWarning =
		balance !== null &&
		!isTerminal &&
		secsLeft !== null &&
		localRental !== null &&
		balanceNum <
			estimateRentalCost(
				localRental.spec_summary.gpu,
				localRental.spec_summary.cpu ?? 0,
				secsLeft,
			).estimateForTtl;

	return (
		<>
			<header className="flex items-center gap-3 mb-6 flex-wrap">
				<Link to="/app/gpu-rentals">
					<Button variant="ghost" size="sm">
						<ArrowLeft className="w-4 h-4 mr-1" />
						GPU rentals
					</Button>
				</Link>
				<Server className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">
					{localRental?.name || (loading ? "Loading…" : "Rental")}
				</h1>
				{task && (
					<span
						className={cn(
							"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
							statusBadge(task.status),
						)}
					>
						{statusLabel(task.status)}
					</span>
				)}
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => window.location.reload()}
						disabled={loading}
					>
						<RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
						Refresh
					</Button>
					{!isTerminal ? (
						<Button
							variant="outline"
							size="sm"
							className="text-red-600 hover:bg-red-50"
							onClick={() => setCancelOpen(true)}
						>
							<Trash2 className="w-4 h-4 mr-1" />
							Cancel
						</Button>
					) : (
						<Button
							variant="outline"
							size="sm"
							className="text-slate-600"
							onClick={onCleanup}
						>
							<Trash2 className="w-4 h-4 mr-1" />
							Remove
						</Button>
					)}
				</div>
			</header>

			{loadError && !task && (
				<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
					<CardContent className="py-12 text-center">
						<p className="text-sm text-muted-foreground mb-2">
							Couldn't reach this rental: <code>{loadError}</code>
						</p>
						<p className="text-xs text-muted-foreground">
							Task id <code>{id}</code> — confirm it's still live on the FlowMesh Host, or remove it from the list.
						</p>
					</CardContent>
				</Card>
			)}

			{task && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Status card */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base">
								Status: {statusLabel(task.status)}
							</CardTitle>
							<CardDescription>
								{task.status === "PENDING"
									? "Queued — waiting for a worker with matching hardware."
									: task.status === "DISPATCHED"
										? task.latest_update?.ssh
											? "Running on a worker. Use the Connect card to ssh in."
											: "Running on a worker — sshd is still coming up."
										: "Terminal state."}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3 text-sm">
							<Field label="Task id" value={<code className="text-xs">{id}</code>} />
							{localRental?.workflow_id && (
								<Field
									label="Workflow id"
									value={<code className="text-xs">{localRental.workflow_id}</code>}
								/>
							)}
							<Field label="Worker" value={task.assigned_worker || "—"} />
							{localRental && (
								<Field
									label="Created"
									value={formatDateTime(localRental.created_at)}
								/>
							)}
							{ssh?.expires_at && (
								<Field
									label="TTL expires"
									value={`${new Date(ssh.expires_at).toLocaleTimeString()} (${secsLeft != null ? fmtCountdown(secsLeft) : "?"} left)`}
								/>
							)}
							{ssh?.session_id && (
								<Field
									label="Session"
									value={<code className="text-xs">{ssh.session_id}</code>}
								/>
							)}
							{localRental && (
								<Field
									label="Elapsed cost (est.)"
									value={
										<span>
											${runningCost.toFixed(4)}{" "}
											<span className="text-xs text-muted-foreground">
												· {fmtCountdown(elapsedSec)} elapsed
											</span>
										</span>
									}
								/>
							)}
							<Field
								label="Balance"
								value={
									balance === null
										? "—"
										: `$${Number(balance.amount).toFixed(2)}`
								}
							/>
							{balanceWarning && (
								<p className="text-xs text-red-700">
									Balance won't cover the remaining TTL at this rate.{" "}
									<Link
										to="/dashboard/billing"
										className="underline font-medium"
									>
										Top up
									</Link>{" "}
									to avoid overdraft.
								</p>
							)}
						</CardContent>
					</Card>

					{/* Connect card */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-2">
						<CardHeader>
							<CardTitle className="text-base flex items-center gap-2">
								<Terminal className="w-4 h-4 text-indigo-600" />
								Connect
							</CardTitle>
							<CardDescription>
								{snippet
									? `${snippet.mode} mode — paste in your local shell.`
									: "Waiting for sshd readiness. This usually takes 10–60s after DISPATCHED."}
							</CardDescription>
						</CardHeader>
						<CardContent>
							{snippet ? (
								<div className="space-y-3">
									{snippet.variants.map((v, i) => (
										<div key={i}>
											<div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
												<span>{v.label}</span>
												{v.needs && (
													<span className="text-[11px] text-slate-400">
														needs: {v.needs}
													</span>
												)}
											</div>
											<div className="flex items-start gap-2">
												<pre
													className={cn(
														"flex-1 text-xs p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all font-mono",
														i === 0
															? "bg-slate-900 text-slate-100"
															: "bg-slate-50 border border-slate-200 text-slate-800",
													)}
												>
													{v.command}
												</pre>
												<Button
													size="sm"
													variant="outline"
													onClick={() => copy(v.command)}
												>
													<Copy className="w-3 h-3" />
												</Button>
											</div>
										</div>
									))}
									<p className="text-xs text-muted-foreground">{snippet.hint}</p>
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									<Loader2 className="w-4 h-4 inline animate-spin mr-1" />
									waiting for ssh_info…
								</p>
							)}
						</CardContent>
					</Card>

					{/* Logs */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-3">
						<CardHeader>
							<div className="flex items-center justify-between flex-wrap gap-2">
								<div>
									<CardTitle className="text-base">Logs</CardTitle>
									<CardDescription>
										Live stream from FlowMesh. Last 500 lines kept in memory.
									</CardDescription>
								</div>
								<label className="inline-flex items-center gap-2 text-sm cursor-pointer">
									<input
										type="checkbox"
										checked={followTail}
										onChange={(e) => setFollowTail(e.target.checked)}
									/>
									<span>Follow tail</span>
								</label>
							</div>
						</CardHeader>
						<CardContent>
							<div
								ref={logContainerRef}
								className="max-h-[360px] overflow-y-auto font-mono text-xs bg-slate-900 text-slate-100 rounded-md p-3"
							>
								{logs.length === 0 ? (
									<p className="text-slate-400">
										{isTerminal
											? "(no logs — task is in a terminal state)"
											: logState === "ended"
												? "No task-level logs for this rental. Interactive SSH containers run sshd silently — ssh in with the Connect card above; stdout is in your shell, not here."
												: logState === "error"
													? "Log stream error — refresh the page to retry."
													: logState === "connecting"
														? "Connecting to log stream…"
														: "waiting for log lines…"}
									</p>
								) : (
									logs.map((l, i) => (
										<div key={i} className="whitespace-pre-wrap break-all">
											{l.ts && (
												<span className="text-slate-500 mr-2">{l.ts}</span>
											)}
											{l.level && (
												<span className="text-amber-300 mr-2">[{l.level}]</span>
											)}
											{l.message}
										</div>
									))
								)}
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			<AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel this rental?</AlertDialogTitle>
						<AlertDialogDescription>
							The FlowMesh Host will cancel the workflow; the worker tears the container down and any active SSH session disconnects. You can always create a new rental.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep running</AlertDialogCancel>
						<AlertDialogAction
							onClick={onCancel}
							disabled={cancelling}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							{cancelling && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
							Cancel rental
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
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

function fmtCountdown(s: number): string {
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}
