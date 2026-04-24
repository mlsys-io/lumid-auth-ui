import { Link } from "react-router-dom";
import { ExternalLink, FileText, Key, Server, Shield, Users } from "lucide-react";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

const SCOPE_CATALOG: Array<{
	service: string;
	icon: typeof Server;
	scopes: Array<{ scope: string; purpose: string }>;
}> = [
	{
		service: "lum.id (identity)",
		icon: Shield,
		scopes: [
			{ scope: "*", purpose: "global admin — granted by role=admin" },
			{ scope: "lumid:profile:read", purpose: "default for authenticated users" },
		],
	},
	{
		service: "QuantArena",
		icon: Users,
		scopes: [
			{ scope: "qa:*", purpose: "full QA access" },
			{ scope: "qa:trading:submit", purpose: "place orders via /api/v1/trade" },
			{ scope: "qa:leaderboard:read", purpose: "read leaderboards / public data" },
			{ scope: "qa:admin:*", purpose: "admin endpoints under /api/v1/admin/*" },
		],
	},
	{
		service: "Runmesh",
		icon: Server,
		scopes: [
			{ scope: "runmesh:admin", purpose: "runmesh-admin Java console" },
			{ scope: "runmesh:billing:*", purpose: "billing / invoices" },
		],
	},
	{
		service: "Lumilake",
		icon: Server,
		scopes: [
			{ scope: "lumilake:*", purpose: "full Lumilake access" },
			{ scope: "lumilake:jobs:submit", purpose: "submit analytics jobs" },
			{ scope: "lumilake:jobs:cancel", purpose: "cancel any job" },
			{ scope: "lumilake:metadata:write", purpose: "register DB/S3 sources" },
			{ scope: "lumilake:trace:read", purpose: "read execution traces" },
			{ scope: "lumilake:principals:manage", purpose: "API-key admin" },
		],
	},
	{
		service: "FlowMesh",
		icon: Server,
		scopes: [
			{ scope: "flowmesh:*", purpose: "full FlowMesh access" },
			{ scope: "flowmesh:workflows:submit", purpose: "submit workflows" },
			{ scope: "flowmesh:workflows:cancel", purpose: "cancel workflows" },
			{ scope: "flowmesh:workers:manage", purpose: "start/stop workers" },
			{ scope: "flowmesh:results:read", purpose: "read task results" },
			{ scope: "flowmesh:results:write", purpose: "post task results (workers)" },
			{ scope: "flowmesh:system:metrics", purpose: "read /system/metrics" },
		],
	},
	{
		service: "xpcloud",
		icon: Server,
		scopes: [
			{ scope: "xpcloud:*", purpose: "full xpcloud access" },
			{ scope: "xpcloud:repos:read", purpose: "read repos" },
			{ scope: "xpcloud:repos:write", purpose: "push to repos" },
			{ scope: "xpcloud:repos:admin", purpose: "transfer, delete" },
			{ scope: "xpcloud:pulls:open", purpose: "open PRs" },
			{ scope: "xpcloud:pulls:merge", purpose: "merge PRs" },
		],
	},
];

export default function Setup() {
	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<FileText className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Setup</h1>
				<span className="text-sm text-muted-foreground ml-2">
					Reference for admin bootstrap, scope catalog, and cross-service conventions.
				</span>
			</header>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2">
							<Users className="w-4 h-4 text-indigo-600" />
							First-time admin bootstrap
						</CardTitle>
						<CardDescription>
							When you first deploy lumid-identity, promote one account to admin.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-sm space-y-3">
						<ol className="list-decimal pl-5 space-y-2">
							<li>
								Seed the admin user on first startup. The compose entrypoint
								calls <code>SeedAdminUser()</code> using the <code>admin:…</code>{" "}
								keys in <code>configs/identity.yaml</code>.
							</li>
							<li>
								Log in at <Link to="/auth/login" className="text-indigo-600 hover:underline">
									/auth/login
								</Link>{" "}
								with those credentials.
							</li>
							<li>
								Visit{" "}
								<Link to="/app/admin/users" className="text-indigo-600 hover:underline">
									/app/admin/users
								</Link>
								{" "}and promote any additional admins via their user-detail page.
							</li>
							<li>
								Mint an invitation code at{" "}
								<Link to="/app/admin/invitations" className="text-indigo-600 hover:underline">
									/app/admin/invitations
								</Link>{" "}
								so new sign-ups can complete registration.
							</li>
						</ol>
						<p className="text-xs text-muted-foreground mt-4">
							You cannot change your own role or status from this console —
							that requires a second admin. The <code>role</code> claim in the
							session JWT takes effect on the next service round-trip (tokens
							re-introspect against lum.id's JWKS + /oauth/introspect).
						</p>
					</CardContent>
				</Card>

				<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2">
							<Shield className="w-4 h-4 text-indigo-600" />
							Access model
						</CardTitle>
						<CardDescription>
							One user, one identity, one source of truth.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-sm space-y-3">
						<p>
							<strong>Canonical:</strong> <code>lumid_identity.users</code> (here
							at lum.id). Runmesh's <code>sys_user</code>, QuantArena's{" "}
							<code>tbl_user</code>, and Lumilake's <code>principals</code> are
							lazy mirrors of this row, keyed by email. First request after
							lum.id issues a JWT populates the mirror automatically.
						</p>
						<p>
							<strong>Role</strong> (admin / user) on the canonical row gates
							every admin endpoint ecosystem-wide. It's read from the lum.id
							JWT's <code>role</code> claim — a user promoted here becomes admin
							on every service on the next request, no service-by-service grant.
						</p>
						<p>
							<strong>Scopes</strong> on Personal Access Tokens refine access
							for programmatic clients (bots, CI, the Lumid CLI). Grant them
							when the user mints a PAT from{" "}
							<Link to="/account/connect" className="text-indigo-600 hover:underline">
								/account/connect
							</Link>
							; they show up in this user's access matrix.
						</p>
						<p className="text-xs text-muted-foreground">
							Full spec:{" "}
							<a
								href="https://github.com/mlsys-io/lumid_identity/blob/main/docs/unified-auth.md"
								target="_blank"
								rel="noreferrer"
								className="text-indigo-600 hover:underline inline-flex items-center gap-1"
							>
								unified-auth.md
								<ExternalLink className="w-3 h-3" />
							</a>
						</p>
					</CardContent>
				</Card>
			</div>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm mt-6">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Key className="w-4 h-4 text-indigo-600" />
						Scope catalog
					</CardTitle>
					<CardDescription>
						Exhaustive list of PAT scopes recognized across the ecosystem. The
						access matrix above computes a level per service by scanning these
						on the user's active PATs.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						{SCOPE_CATALOG.map((grp) => {
							const Icon = grp.icon;
							return (
								<div key={grp.service}>
									<h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
										<Icon className="w-4 h-4 text-indigo-600" />
										{grp.service}
									</h3>
									<table className="w-full text-sm">
										<tbody>
											{grp.scopes.map((s) => (
												<tr key={s.scope} className="border-b last:border-0">
													<td className="py-1 pr-3 font-mono text-xs whitespace-nowrap">
														{s.scope}
													</td>
													<td className="py-1 text-muted-foreground">
														{s.purpose}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							);
						})}
					</div>
				</CardContent>
			</Card>
		</>
	);
}
