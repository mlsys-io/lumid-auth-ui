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
	listUsers,
	type AccessLevel,
	type AccessRow,
	type AdminUserRow,
} from "@/api/users";
import { isSessionExpired } from "@/api/client";

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
	const [rows, setRows] = useState<
		Array<{ user: AdminUserRow; access: AccessRow[] | null }>
	>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);

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
								Rows: most recent {MATRIX_LIMIT} users. Columns: services.
								Cells: effective access (derived from role + PAT scopes —
								view-only here). Click a row to open the user's detail.
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
											<td className="py-1.5 pr-3 text-muted-foreground">{user.role}</td>
											{ACCESS_SERVICES.map((svc) => {
												const row =
													access?.find((r) => r.service === svc) || null;
												const lvl: AccessLevel = row?.level || "none";
												return (
													<td
														key={svc}
														className={cn(
															"py-1.5 px-1 text-center text-xs font-medium",
															levelBg(lvl),
															levelFg(lvl),
														)}
														title={row?.source || "—"}
													>
														{access ? lvl : "…"}
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
