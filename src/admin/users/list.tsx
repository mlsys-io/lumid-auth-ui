import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
	ChevronLeft,
	ChevronRight,
	Download,
	RefreshCw,
	Search,
	Shield,
	Users,
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
	csvExportUrl,
	listUsers,
	type AdminUserRow,
	type ListUsersParams,
} from "@/api/users";
import { isSessionExpired } from "@/api/client";

const PAGE_SIZE = 50;

function statusBadge(status: string): string {
	switch (status) {
		case "active":
			return "bg-green-100 text-green-800 border-green-200";
		case "suspended":
			return "bg-red-100 text-red-800 border-red-200";
		case "pending":
			return "bg-amber-100 text-amber-800 border-amber-200";
		default:
			return "bg-gray-100 text-gray-800 border-gray-200";
	}
}

function roleBadge(role: string): string {
	if (role === "super_admin") return "bg-amber-100 text-amber-800 border-amber-200";
	if (role === "admin") return "bg-indigo-100 text-indigo-800 border-indigo-200";
	return "bg-gray-100 text-gray-800 border-gray-200";
}

export default function UsersList() {
	const [users, setUsers] = useState<AdminUserRow[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [status, setStatus] = useState<ListUsersParams["status"]>("all");
	const [role, setRole] = useState<ListUsersParams["role"]>("all");
	const [q, setQ] = useState("");
	const [qDebounced, setQDebounced] = useState("");
	const [loading, setLoading] = useState(true);

	// Debounce search to avoid a request per keystroke.
	useEffect(() => {
		const t = setTimeout(() => setQDebounced(q.trim()), 300);
		return () => clearTimeout(t);
	}, [q]);

	// Reset page when filters change.
	useEffect(() => {
		setPage(1);
	}, [status, role, qDebounced]);

	useEffect(() => {
		const ctrl = new AbortController();
		(async () => {
			setLoading(true);
			try {
				const r = await listUsers({
					status,
					role,
					q: qDebounced || undefined,
					page,
					page_size: PAGE_SIZE,
				});
				if (ctrl.signal.aborted) return;
				setUsers(r.users || []);
				setTotal(r.total || 0);
			} catch (e: unknown) {
				if (ctrl.signal.aborted || isSessionExpired(e)) return;
				toast.error((e as Error)?.message || "Failed to load users");
			} finally {
				if (!ctrl.signal.aborted) setLoading(false);
			}
		})();
		return () => ctrl.abort();
	}, [status, role, qDebounced, page]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<Users className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Users</h1>
				<span className="text-sm text-muted-foreground ml-2">
					One directory for every lum.id account — role + access below cascade to every service.
				</span>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total === 0 ? "No users" : `${total} user${total === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription className="flex items-center gap-2">
								<Shield className="w-3 h-3" />
								Canonical identity — no separate Runmesh / Lumilake / QuantArena user admin.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setPage((p) => p)}
								disabled={loading}
								title="Refresh"
							>
								<RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
							</Button>
							<a
								href={csvExportUrl({
									status,
									role,
									q: qDebounced || undefined,
								})}
							>
								<Button variant="outline" size="sm">
									<Download className="w-4 h-4 mr-1" />
									CSV
								</Button>
							</a>
							<Link to="/app/admin/users/matrix">
								<Button size="sm" variant="outline">
									<Shield className="w-4 h-4 mr-1" />
									Access matrix
								</Button>
							</Link>
						</div>
					</div>

					<div className="mt-4 flex items-center gap-3 flex-wrap">
						<div className="relative">
							<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="pl-9 w-64"
								placeholder="Email or name…"
								value={q}
								onChange={(e) => setQ(e.target.value)}
							/>
						</div>
						<Select
							value={status || "all"}
							onValueChange={(v) => setStatus(v as ListUsersParams["status"])}
						>
							<SelectTrigger className="w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="suspended">Suspended</SelectItem>
								<SelectItem value="pending">Pending</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={role || "all"}
							onValueChange={(v) => setRole(v as ListUsersParams["role"])}
						>
							<SelectTrigger className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All roles</SelectItem>
								<SelectItem value="user">User</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</CardHeader>

				<CardContent>
					{loading && users.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : users.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No users match the current filters.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Email</th>
										<th className="text-left py-2 px-2 font-medium">Name</th>
										<th className="text-left py-2 px-2 font-medium">Role</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-right py-2 px-2 font-medium">Tokens</th>
										<th className="text-left py-2 px-2 font-medium">Last login</th>
										<th className="text-left py-2 px-2 font-medium">Created</th>
									</tr>
								</thead>
								<tbody>
									{users.map((u) => (
										<tr key={u.id} className="border-b last:border-0 hover:bg-accent/40">
											<td className="py-2 px-2">
												<Link
													to={`/app/admin/users/${encodeURIComponent(u.id)}`}
													className="text-indigo-600 hover:underline font-medium"
												>
													{u.email}
												</Link>
												{!u.email_verified && (
													<span
														className="ml-2 inline-flex items-center rounded-full bg-amber-50 text-amber-700 text-xs px-1.5 py-0.5"
														title="Email not verified"
													>
														unverified
													</span>
												)}
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{u.name || "—"}
											</td>
											<td className="py-2 px-2">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														roleBadge(u.role),
													)}
												>
													{u.role}
												</span>
											</td>
											<td className="py-2 px-2">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														statusBadge(u.status),
													)}
												>
													{u.status}
												</span>
											</td>
											<td className="py-2 px-2 text-right">{u.active_token_count}</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{u.last_login_at ? formatDateTime(new Date(u.last_login_at).getTime() / 1000) : "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{u.created_at
													? formatDateTime(new Date(u.created_at).getTime() / 1000)
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
