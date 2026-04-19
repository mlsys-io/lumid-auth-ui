import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
	Key,
	Terminal,
	LogOut,
	TrendingUp,
	BarChart3,
	Workflow,
	Database,
	ExternalLink,
	BrainCircuit,
	Shield,
} from 'lucide-react';

// Post-login landing. Adopts the QuantArena visual language so
// returning users feel continuity between lum.id and market.lum.id:
//   * gradient wash (blue-50 / indigo-50 / purple-50) — same as the
//     login screen
//   * indigo→purple brand chip around the BrainCircuit icon
//   * white/80 backdrop-blur cards

interface App {
	name: string;
	tagline: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	external: boolean;
	sso: 'live' | 'pending';
}

const ECOSYSTEM: App[] = [
	{
		name: 'Analytics',
		tagline: 'Umami — traffic dashboards',
		url: 'https://analytics.lumid.market/dashboard',
		icon: BarChart3,
		external: true,
		sso: 'live',
	},
	{
		name: 'QuantArena',
		tagline: 'Strategies, backtesting, live competitions',
		// Bounces through lum.id/oauth/authorize for SSO and lands on
		// /strategy without a second login. LQA's backend handles the
		// code exchange + upserts the tbl_user row by email.
		url: 'https://lumid.market/backend/api/v1/auth/lumid-sso/start?return_to=/strategy',
		icon: TrendingUp,
		external: true,
		sso: 'live',
	},
	{
		name: 'Runmesh',
		tagline: 'Workflow orchestration at GPU scale',
		// Runmesh's backend LumidIdentityController already
		// introspects rm_pat_* / rmk_* via lum.id (Phase 4). Browser-
		// side the landing page is public, so clicking lands cleanly.
		url: 'https://runmesh.ai/',
		icon: Workflow,
		external: true,
		sso: 'live',
	},
	{
		name: 'Lumilake',
		tagline: 'Pipeline optimizer (HALO)',
		// Fills in user.email at render time — see Dashboard below.
		url: 'https://lumilake.ai/sso/lumid',
		icon: Database,
		external: true,
		sso: 'live',
	},
];

export default function Dashboard() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
			<div className="max-w-5xl mx-auto px-4 py-10">
				<header className="flex items-center justify-between mb-10">
					<div className="flex items-center gap-3">
						<div className="relative p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-md">
							<BrainCircuit className="w-7 h-7 text-white" />
						</div>
						<div>
							<h1 className="text-xl font-semibold leading-tight">
								Welcome back, {user?.username || user?.email?.split('@')[0] || 'there'}
							</h1>
							<p className="text-sm text-muted-foreground">{user?.email}</p>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="bg-white/60 backdrop-blur-sm"
						onClick={async () => {
							await logout();
							navigate('/login');
						}}
					>
						<LogOut className="w-4 h-4 mr-2" />
						Sign out
					</Button>
				</header>

				<section className="mb-10">
					<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
						Your lum.id account
					</h2>
					<div className="grid gap-3 sm:grid-cols-2">
						<Card
							className="cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md bg-white/80 backdrop-blur-sm"
							onClick={() => navigate('/account/tokens')}
						>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<Key className="w-4 h-4 text-indigo-600" />
									Access Tokens
								</CardTitle>
								<CardDescription>
									Mint and revoke Personal Access Tokens for CLI, bots, and integrations.
								</CardDescription>
							</CardHeader>
						</Card>
						<Card
							className="cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md bg-white/80 backdrop-blur-sm"
							onClick={() => navigate('/account/connect')}
						>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<Terminal className="w-4 h-4 text-indigo-600" />
									Install LumidOS
								</CardTitle>
								<CardDescription>
									Provision the LumidOS CLI + MCP server on any machine with one command.
								</CardDescription>
							</CardHeader>
						</Card>
						{user?.role === 'admin' && (
							<Card
								className="cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md bg-white/80 backdrop-blur-sm sm:col-span-2"
								onClick={() => navigate('/account/admin')}
							>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										<Shield className="w-4 h-4 text-indigo-600" />
										Admin hub
										<span className="text-[10px] uppercase tracking-wide bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full ml-1">
											admin
										</span>
									</CardTitle>
									<CardDescription>
										Invitation codes (native) + links to Runmesh + QuantArena + Lumilake admin surfaces.
									</CardDescription>
								</CardHeader>
							</Card>
						)}
					</div>
				</section>

				<section>
					<div className="flex items-baseline justify-between mb-4 flex-wrap gap-y-2">
						<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Apps</h2>
						<p className="text-xs text-muted-foreground">
							<span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 align-middle" />
							SSO live
							<span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 ml-3 align-middle" />
							Separate login (flip pending)
						</p>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
						{ECOSYSTEM.map((app) => {
							const Icon = app.icon;
							const dotClass = app.sso === 'live' ? 'bg-emerald-500' : 'bg-amber-500';
							// Lumilake SSO is bridged client-side — the
							// frontend's OSS-mode auth accepts any
							// credentials, so we pass the signed-in
							// user's email via ?email= and let it
							// fabricate a local session.
							const href =
								app.name === 'Lumilake' && user?.email
									? `${app.url}?email=${encodeURIComponent(user.email)}${
											user.username
												? `&name=${encodeURIComponent(user.username)}`
												: ''
									  }`
									: app.url;
							return (
								<a
									key={app.name}
									href={href}
									target={app.external ? '_blank' : undefined}
									rel={app.external ? 'noopener noreferrer' : undefined}
									className="block"
								>
									<Card className="h-full cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md bg-white/80 backdrop-blur-sm">
										<CardContent className="p-4 flex items-start gap-3">
											<div className="p-2 bg-gradient-to-br from-indigo-500/10 to-purple-600/10 rounded-lg flex-shrink-0">
												<Icon className="w-5 h-5 text-indigo-600" />
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-1.5">
													<span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
													<span className="font-medium text-sm">{app.name}</span>
													{app.external && <ExternalLink className="w-3 h-3 text-muted-foreground" />}
												</div>
												<p className="text-xs text-muted-foreground mt-1 leading-relaxed">{app.tagline}</p>
											</div>
										</CardContent>
									</Card>
								</a>
							);
						})}
					</div>
					<p className="text-xs text-muted-foreground mt-4">
						Green-dot apps round-trip through lum.id for auth — no second login. Amber apps still have
						their own login today; they turn green the moment the AUTH_MODE cutover lands and nothing else
						changes on this page.
					</p>
				</section>
			</div>
		</div>
	);
}
