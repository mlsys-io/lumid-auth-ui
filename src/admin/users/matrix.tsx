import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
	ACCESS_SERVICES,
	getUserAccess,
	grantAccess,
	listUsers,
	patchUser,
	revokeAccessGrant,
	type AccessLevel,
	type AccessRow,
	type AccessService,
	type AdminUserRow,
} from "@/api/users";
import { isSessionExpired } from "@/api/client";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";

function levelBg(level: AccessLevel): string {
	switch (level) {
		case "admin":
			return "bg-indigo-600";
		case "write":
			return "bg-indigo-300";
		case "read":
			return "bg-indigo-50";
		case "none":
			return "bg-red-50";
	}
}

function levelFg(level: AccessLevel): string {
	return level === "admin" ? "text-white" : "text-gray-800";
}

// Cap at 50 users; admins beyond that should use the filters + paging
// on the main /users page. The matrix is meant for a bird's-eye view,
// not a paginated table.
const MATRIX_LIMIT = 50;

export default function UsersMatrix() {
	const { user: me } = useAuth();
	const [rows, setRows] = useState<
		Array<{ user: AdminUserRow; access: AccessRow[] | null }>
	>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [savingId, setSavingId] = useState<string | null>(null);

	async function refreshAccess(userId: string) {
		try {
			const a = await getUserAccess(userId);
			setRows((prev) =>
				prev.map((r) => (r.user.id === userId ? { ...r, access: a } : r)),
			);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
		}
	}

	async function onCellChange(
		userId: string,
		service: AccessService,
		next: AccessLevel | "reset",
	) {
		setSavingId(userId);
		try {
			if (next === "reset") {
				await revokeAccessGrant(userId, service);
			} else {
				await grantAccess(userId, service, next);
			}
			await refreshAccess(userId);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Access change failed");
		} finally {
			setSavingId(null);
		}
	}

	async function onRoleChange(
		userId: string,
		next: "user" | "admin" | "super_admin",
	) {
		setSavingId(userId);
		try {
			const updated = await patchUser(userId, { role: next });
			setRows((prev) =>
				prev.map((r) => (r.user.id === userId ? { ...r, user: updated } : r)),
			);
			toast.success(`Role → ${next}`);
			await refreshAccess(userId);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Role change failed");
		} finally {
			setSavingId(null);
		}
	}

	async function load() {
		setLoading(true);
		try {
			const list = await listUsers({ page: 1, page_size: MATRIX_LIMIT });
			setTotal(list.total);
			// Hydrate access in parallel but bounded — 50 concurrent
			// fetches against one same-origin server is fine.
			const seeded = list.users.map((u) => ({
				user: u,
				access: null as AccessRow[] | null,
			}));
			setRows(seeded);
			const settled = await Promise.allSettled(
				list.users.map((u) => getUserAccess(u.id).then((a) => ({ id: u.id, a }))),
			);
			const byId: Record<string, AccessRow[]> = {};
			for (const s of settled) {
				if (s.status === "fulfilled") byId[s.value.id] = s.value.a;
			}
			setRows(seeded.map((r) => ({ ...r, access: byId[r.user.id] || [] })));
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Failed to load matrix");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		load();
	}, []);

	return (
		<>
			<header className="flex items-center gap-3 mb-6">
				<Link to="/app/admin/users">
					<Button variant="ghost" size="sm">
						<ArrowLeft className="w-4 h-4 mr-1" />
						Users
					</Button>
				</Link>
				<Shield className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Access matrix</h1>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total === 0
									? "No users"
									: `${Math.min(total, MATRIX_LIMIT)} of ${total} users`}
							</CardTitle>
							<CardDescription>
								Role + per-service levels are both editable in-place.
								Admin/super_admin rows are pinned at <code>admin</code>{" "}
								everywhere. For regular users, each cell picks from{" "}
								<code>none | read | write | admin</code> (source:{" "}
								<code>grant</code>), or "reset" to drop the explicit grant
								and fall back to role + PAT.
							</CardDescription>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={load}
							disabled={loading}
						>
							<RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{loading && rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">No users yet.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm border-collapse">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 pr-3 font-medium sticky left-0 bg-white/80 z-10">
											User
										</th>
										<th className="text-left py-2 pr-3 font-medium">Role</th>
										{ACCESS_SERVICES.map((svc) => (
											<th key={svc} className="text-center py-2 px-1 font-medium">
												{svc}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{rows.map(({ user, access }) => (
										<tr key={user.id} className="border-b last:border-0 hover:bg-accent/30">
											<td className="py-1.5 pr-3 sticky left-0 bg-white/80 z-10">
												<Link
													to={`/app/admin/users/${encodeURIComponent(user.id)}`}
													className="text-indigo-600 hover:underline"
													title={user.name || user.email}
												>
													{user.email}
												</Link>
												{user.status !== "active" && (
													<span className="ml-2 text-xs text-red-600">
														{user.status}
													</span>
												)}
											</td>
											<td className="py-1.5 pr-3">
												<Select
													value={user.role}
													disabled={
														savingId === user.id || user.id === me?.id
													}
													onValueChange={(v) =>
														onRoleChange(
															user.id,
															v as "user" | "admin" | "super_admin",
														)
													}
												>
													<SelectTrigger className="h-7 w-[110px] text-xs">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="user">user</SelectItem>
														<SelectItem value="admin">admin</SelectItem>
														<SelectItem value="super_admin">super_admin</SelectItem>
													</SelectContent>
												</Select>
											</td>
											{ACCESS_SERVICES.map((svc) => {
												const row =
													access?.find((r) => r.service === svc) || null;
												const lvl: AccessLevel = row?.level || "none";
												// Cells are read-only for admin/super_admin
												// (role already pins admin everywhere) and for
												// suspended users. Otherwise the admin can pick
												// none/read/write/admin or "reset" (drop the
												// explicit grant + fall back to role+PAT).
												const roleLocked =
													user.role === "admin" ||
													user.role === "super_admin" ||
													user.status !== "active";
												return (
													<td
														key={svc}
														className={cn(
															"py-1.5 px-0.5 text-center text-xs font-medium",
															levelBg(lvl),
															levelFg(lvl),
														)}
														title={row?.source || "—"}
													>
														{!access ? (
															"…"
														) : roleLocked ? (
															lvl
														) : (
															<Select
																value={
																	row?.source === "grant" ? lvl : ""
																}
																disabled={savingId === user.id}
																onValueChange={(v) =>
																	onCellChange(
																		user.id,
																		svc,
																		v as AccessLevel | "reset",
																	)
																}
															>
																<SelectTrigger
																	className={cn(
																		"h-6 w-[74px] mx-auto border-0 bg-transparent focus:ring-0 px-1 text-xs justify-center",
																		levelFg(lvl),
																	)}
																>
																	<SelectValue placeholder={lvl} />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="reset">
																		(reset)
																	</SelectItem>
																	<SelectItem value="none">none</SelectItem>
																	<SelectItem value="read">read</SelectItem>
																	<SelectItem value="write">write</SelectItem>
																	<SelectItem value="admin">admin</SelectItem>
																</SelectContent>
															</Select>
														)}
													</td>
												);
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					<div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
						<span className="flex items-center gap-1">
							<span className="w-3 h-3 rounded bg-indigo-600 inline-block" />
							admin
						</span>
						<span className="flex items-center gap-1">
							<span className="w-3 h-3 rounded bg-indigo-300 inline-block" />
							write
						</span>
						<span className="flex items-center gap-1">
							<span className="w-3 h-3 rounded bg-indigo-50 inline-block border" />
							read
						</span>
						<span className="flex items-center gap-1">
							<span className="w-3 h-3 rounded bg-red-50 inline-block border" />
							none
						</span>
					</div>
				</CardContent>
			</Card>
		</>
	);
}
