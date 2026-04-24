import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	ChevronLeft,
	ChevronRight,
	ClipboardCheck,
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
import { Label } from "@/components/ui/label";
import { cn, formatDateTime } from "@/lib/utils";
import { listAudit, type AuditEntry } from "@/api/users";
import { isSessionExpired } from "@/api/client";

const PAGE_SIZE = 100;

function eventBadge(ev: string): string {
	if (ev.startsWith("admin:")) return "bg-indigo-100 text-indigo-800 border-indigo-200";
	if (ev === "login" || ev === "oauth") return "bg-green-100 text-green-800 border-green-200";
	if (ev === "logout" || ev === "revoke") return "bg-gray-100 text-gray-800 border-gray-200";
	if (ev === "mint") return "bg-blue-100 text-blue-800 border-blue-200";
	if (ev === "introspect") return "bg-purple-100 text-purple-800 border-purple-200";
	return "bg-gray-100 text-gray-800 border-gray-200";
}

export default function Audit() {
	const [entries, setEntries] = useState<AuditEntry[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [userId, setUserId] = useState("");
	const [userIdDebounced, setUserIdDebounced] = useState("");
	const [event, setEvent] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const t = setTimeout(() => setUserIdDebounced(userId.trim()), 300);
		return () => clearTimeout(t);
	}, [userId]);

	useEffect(() => {
		setPage(1);
	}, [userIdDebounced, event]);

	useEffect(() => {
		const ctrl = new AbortController();
		(async () => {
			setLoading(true);
			try {
				const r = await listAudit({
					user_id: userIdDebounced || undefined,
					event: event || undefined,
					page,
					page_size: PAGE_SIZE,
				});
				if (ctrl.signal.aborted) return;
				setEntries(r.entries || []);
				setTotal(r.total || 0);
			} catch (e: unknown) {
				if (ctrl.signal.aborted || isSessionExpired(e)) return;
				toast.error((e as Error)?.message || "Failed to load audit log");
			} finally {
				if (!ctrl.signal.aborted) setLoading(false);
			}
		})();
		return () => ctrl.abort();
	}, [userIdDebounced, event, page]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<ClipboardCheck className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Audit log</h1>
				<span className="text-sm text-muted-foreground ml-2">
					Append-only record of every auth-relevant event across the ecosystem.
				</span>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total.toLocaleString()} event{total === 1 ? "" : "s"}
							</CardTitle>
							<CardDescription>
								Events: login · logout · mint · revoke · introspect · oauth · admin:user:patch · admin:user:revoke-sessions
							</CardDescription>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage((p) => p)}
							disabled={loading}
						>
							<RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
						</Button>
					</div>
					<div className="mt-4 flex items-center gap-3 flex-wrap">
						<div className="relative">
							<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="pl-9 w-80"
								placeholder="Filter by user id…"
								value={userId}
								onChange={(e) => setUserId(e.target.value)}
							/>
						</div>
						<div>
							<Label htmlFor="event" className="sr-only">
								Event
							</Label>
							<Input
								id="event"
								className="w-56"
								placeholder="Event (e.g. login, mint, admin:user:patch)"
								value={event}
								onChange={(e) => setEvent(e.target.value.trim())}
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{loading && entries.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : entries.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No entries match the current filters.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 pr-3 font-medium whitespace-nowrap">When</th>
										<th className="text-left py-2 pr-3 font-medium">Event</th>
										<th className="text-left py-2 pr-3 font-medium">User</th>
										<th className="text-left py-2 pr-3 font-medium">Source</th>
										<th className="text-left py-2 pr-3 font-medium">Path</th>
										<th className="text-right py-2 pr-3 font-medium">Status</th>
										<th className="text-right py-2 pr-3 font-medium">ms</th>
										<th className="text-left py-2 pr-3 font-medium">IP</th>
									</tr>
								</thead>
								<tbody>
									{entries.map((e) => (
										<tr key={e.id} className="border-b last:border-0">
											<td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
												{formatDateTime(new Date(e.created_at).getTime() / 1000)}
											</td>
											<td className="py-1.5 pr-3">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														eventBadge(e.event),
													)}
												>
													{e.event}
												</span>
											</td>
											<td className="py-1.5 pr-3 font-mono text-xs truncate max-w-[220px]">
												{e.user_id || "—"}
											</td>
											<td className="py-1.5 pr-3 text-muted-foreground">
												{e.source || "—"}
											</td>
											<td className="py-1.5 pr-3 font-mono text-xs max-w-[240px] truncate">
												{e.method ? `${e.method} ` : ""}
												{e.path || "—"}
											</td>
											<td className="py-1.5 pr-3 text-right">
												{e.status ? e.status : "—"}
											</td>
											<td className="py-1.5 pr-3 text-right">
												{e.duration_ms ? e.duration_ms : "—"}
											</td>
											<td className="py-1.5 pr-3 font-mono text-xs">{e.ip || "—"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{totalPages > 1 && (
						<div className="flex items-center justify-between mt-4 text-sm">
							<span className="text-muted-foreground">
								Page {page} of {totalPages.toLocaleString()}
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
