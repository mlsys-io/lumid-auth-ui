import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
	ArrowLeft,
	KeyRound,
	RefreshCw,
	Shield,
	UserCog,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
import { cn, formatDateTime } from "@/lib/utils";
import {
	ACCESS_SERVICES,
	getUser,
	getUserAccess,
	patchUser,
	revokeSessions,
	type AccessLevel,
	type AccessRow,
	type AdminUserRow,
} from "@/api/users";
import { isSessionExpired } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";

const LEVEL_ORDER: Record<AccessLevel, number> = {
	none: 0,
	read: 1,
	write: 2,
	admin: 3,
};

function levelColor(level: AccessLevel): string {
	switch (level) {
		case "admin":
			return "bg-indigo-600 text-white";
		case "write":
			return "bg-indigo-100 text-indigo-800";
		case "read":
			return "bg-gray-100 text-gray-700";
		case "none":
			return "bg-red-50 text-red-600";
	}
}

export default function UserDetail() {
	const { id: rawId } = useParams<{ id: string }>();
	const id = rawId || "";
	const { user: me } = useAuth();

	const [user, setUser] = useState<AdminUserRow | null>(null);
	const [access, setAccess] = useState<AccessRow[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [revokeOpen, setRevokeOpen] = useState(false);

	async function refresh() {
		setLoading(true);
		try {
			const [u, a] = await Promise.all([getUser(id), getUserAccess(id)]);
			setUser(u);
			setAccess(a);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Failed to load user");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		if (id) refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id]);

	async function onRoleChange(role: "user" | "admin") {
		if (!user) return;
		setSaving(true);
		try {
			const updated = await patchUser(id, { role });
			setUser(updated);
			// Role changes bubble into access immediately.
			const a = await getUserAccess(id);
			setAccess(a);
			toast.success(`Role set to ${role}`);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Update failed");
		} finally {
			setSaving(false);
		}
	}

	async function onStatusChange(
		status: "active" | "suspended" | "pending",
	) {
		if (!user) return;
		setSaving(true);
		try {
			const updated = await patchUser(id, { status });
			setUser(updated);
			const a = await getUserAccess(id);
			setAccess(a);
			toast.success(`Status set to ${status}`);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Update failed");
		} finally {
			setSaving(false);
		}
	}

	async function onRevokeSessions() {
		setSaving(true);
		try {
			const r = await revokeSessions(id);
			toast.success(`Revoked ${r.revoked} session${r.revoked === 1 ? "" : "s"}`);
			setRevokeOpen(false);
			refresh();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Revoke failed");
		} finally {
			setSaving(false);
		}
	}

	const isSelf = me?.id === id;

	return (
		<>
			<header className="flex items-center gap-3 mb-6">
				<Link to="/app/admin/users">
					<Button variant="ghost" size="sm">
						<ArrowLeft className="w-4 h-4 mr-1" />
						Users
					</Button>
				</Link>
				<UserCog className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">
					{user ? user.email : loading ? "Loading…" : "Not found"}
				</h1>
			</header>

			{!user && !loading && (
				<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
					<CardContent className="py-12 text-center text-sm text-muted-foreground">
						No user with id <code>{id}</code>.
					</CardContent>
				</Card>
			)}

			{user && (
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Identity card */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base">Identity</CardTitle>
							<CardDescription>
								Canonical lum.id account. Every downstream service mirrors this row.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<Field label="Email" value={user.email} />
							<Field label="Name" value={user.name || "—"} />
							<Field label="ID" value={<code className="text-xs">{user.id}</code>} />
							<Field
								label="Verified"
								value={user.email_verified ? "yes" : "no"}
							/>
							<Field
								label="Invitation code"
								value={user.invitation_code_used || "—"}
							/>
							<Field
								label="Tokens active"
								value={String(user.active_token_count)}
							/>
							<Field
								label="Last login"
								value={
									user.last_login_at
										? formatDateTime(
												new Date(user.last_login_at).getTime() / 1000,
										  )
										: "never"
								}
							/>
							<Field
								label="Created"
								value={formatDateTime(
									new Date(user.created_at).getTime() / 1000,
								)}
							/>
						</CardContent>
					</Card>

					{/* Role + status + dangerous actions */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base">Role & status</CardTitle>
							<CardDescription>
								{isSelf
									? "This is your own account — use another admin to change your own role."
									: "Changes take effect on the next request (tokens re-introspect against lum.id)."}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label>Role</Label>
								<Select
									value={user.role}
									disabled={saving || isSelf}
									onValueChange={(v) =>
										onRoleChange(v as "user" | "admin")
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="user">user</SelectItem>
										<SelectItem value="admin">admin</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1">
								<Label>Status</Label>
								<Select
									value={user.status}
									disabled={saving || isSelf}
									onValueChange={(v) =>
										onStatusChange(v as "active" | "suspended" | "pending")
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="active">active</SelectItem>
										<SelectItem value="suspended">suspended</SelectItem>
										<SelectItem value="pending">pending</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-xs text-muted-foreground mt-1">
									Suspending cascades to revoking every active PAT + session.
								</p>
							</div>

							<div className="border-t pt-4">
								<Button
									variant="outline"
									disabled={saving || user.active_token_count === 0}
									onClick={() => setRevokeOpen(true)}
								>
									<KeyRound className="w-4 h-4 mr-2" />
									Revoke all sessions ({user.active_token_count})
								</Button>
								<p className="text-xs text-muted-foreground mt-2">
									Kills PATs + sessions without changing role or status.
								</p>
							</div>
						</CardContent>
					</Card>

					{/* Access matrix */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base flex items-center gap-2">
								<Shield className="w-4 h-4 text-indigo-600" />
								Access matrix
							</CardTitle>
							<CardDescription>
								Effective access per service. Sources: role, PAT scopes, or
								"suspended" when the account is locked.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{!access ? (
								<p className="text-sm text-muted-foreground flex items-center gap-2">
									<RefreshCw className="w-4 h-4 animate-spin" />
									Loading…
								</p>
							) : (
								<table className="w-full text-sm">
									<thead className="text-xs text-muted-foreground">
										<tr className="border-b">
											<th className="text-left py-2 pr-3 font-medium">Service</th>
											<th className="text-left py-2 pr-3 font-medium">Level</th>
											<th className="text-left py-2 pr-3 font-medium">From</th>
										</tr>
									</thead>
									<tbody>
										{ACCESS_SERVICES.map((svc) => {
											const row =
												access.find((r) => r.service === svc) || {
													service: svc,
													level: "none" as AccessLevel,
													source: "—",
												};
											return (
												<tr key={svc} className="border-b last:border-0">
													<td className="py-2 pr-3 font-medium">{svc}</td>
													<td className="py-2 pr-3">
														<span
															className={cn(
																"inline-flex items-center rounded-full px-2 py-0.5 text-xs",
																levelColor(row.level),
															)}
														>
															{row.level}
														</span>
													</td>
													<td className="py-2 pr-3 text-muted-foreground font-mono text-xs">
														{row.source}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							)}
							<p className="text-xs text-muted-foreground mt-4">
								Matrix is derived — there's no direct edit here. To grant a
								scope (e.g. <code>runmesh:admin</code>), ask the user to mint
								a PAT with that scope from their own{" "}
								<code>/dashboard/tokens</code> page (matrix-gated — admins can
								grant any scope; regular users can only mint scopes their
								role already allows). Role bumps above short-circuit the
								matrix — admins get <code>admin</code> everywhere.
							</p>
						</CardContent>
					</Card>
				</div>
			)}

			<AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Revoke every active session?</AlertDialogTitle>
						<AlertDialogDescription>
							{user?.active_token_count ?? 0} active PAT
							{user?.active_token_count === 1 ? "" : "s"} and every session cookie
							will be invalidated. The user will need to log in again from every
							device. Role and status are unchanged.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={onRevokeSessions}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Revoke
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

// keep LEVEL_ORDER re-exportable if other views want to sort by severity
export { LEVEL_ORDER };
