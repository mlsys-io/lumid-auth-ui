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
	User as UserIcon,
	Ticket,
	Users,
	Server,
	Receipt,
	ClipboardCheck,
	LayoutDashboard,
	GitBranch,
} from 'lucide-react';

// Unified /dashboard — one landing for every user-visible surface:
// account essentials (profile, tokens, CLI install), admin section
// (only visible when role=admin), and the ecosystem app launcher.
// The old /account/admin hub was folded into this page; an admin
// signed in at lum.id now sees everything they can operate in one
// place with no second click.

interface AccountCard {
	title: string;
	desc: string;
	path: string;
	icon: React.ComponentType<{ className?: string }>;
}

interface AdminSurface {
	title: string;
	desc: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	internal?: boolean;
	owner: 'Lumid' | 'Runmesh' | 'QuantArena';
}

interface App {
	name: string;
	tagline: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	external: boolean;
	sso: 'live' | 'pending';
}

const ACCOUNT: AccountCard[] = [
	{ title: 'Profile', desc: 'Display name, avatar, and password — all in one place.', path: '/dashboard/profile', icon: UserIcon },
	{ title: 'Access Tokens', desc: 'Mint and revoke Personal Access Tokens for CLI, bots, and integrations.', path: '/dashboard/tokens', icon: Key },
	{ title: 'Install LumidOS', desc: 'Provision the LumidOS CLI + MCP server on any machine with one command.', path: '/dashboard/connect', icon: Terminal },
];

const ADMIN_SURFACES: AdminSurface[] = [
	{
		title: 'Invitation codes',
		desc: 'Mint, list, revoke invitation codes for the whole ecosystem.',
		url: '/dashboard/admin/invitations',
		icon: Ticket,
		internal: true,
		owner: 'Lumid',
	},
	{
		title: 'Runmesh — dashboard',
		desc: 'Ecosystem-wide activity, users, GPU utilisation.',
		url: '/dashboard/admin/runmesh/dashboard',
		icon: LayoutDashboard,
		internal: true,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — users',
		desc: 'Accounts, roles, quotas.',
		url: '/dashboard/admin/runmesh/users',
		icon: Users,
		internal: true,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — nodes',
		desc: 'GPU node inventory, status, allocation.',
		url: '/dashboard/admin/runmesh/nodes',
		icon: Server,
		internal: true,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — suppliers',
		desc: 'GPU suppliers, pricing, contractual terms.',
		url: '/dashboard/admin/runmesh/suppliers',
		icon: Server,
		internal: true,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — supplier nodes',
		desc: 'Per-supplier node configuration.',
		url: '/dashboard/admin/runmesh/supplier-nodes',
		icon: Server,
		internal: true,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — billing',
		desc: 'User + supplier billing, refunds, reconciliation.',
		url: '/dashboard/admin/runmesh/billing',
		icon: Receipt,
		internal: true,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — workflow review',
		desc: 'Moderation queue for submitted workflows.',
		url: '/dashboard/admin/runmesh/workflow-review',
		icon: ClipboardCheck,
		internal: true,
		owner: 'Runmesh',
	},
	{
		title: 'QuantArena — management',
		desc: 'Competitions, users, leaderboards, strategy moderation.',
		url: 'https://lumid.market/admin/',
		icon: GitBranch,
		owner: 'QuantArena',
	},
];

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
		url: 'https://runmesh.ai/',
		icon: Workflow,
		external: true,
		sso: 'live',
	},
	{
		name: 'Lumilake',
		tagline: 'Pipeline optimizer (HALO)',
		url: 'https://lumilake.ai/sso/lumid',
		icon: Database,
		external: true,
		sso: 'live',
	},
];

export default function Dashboard() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();

	const isAdmin = user?.role === 'admin';
	const adminByOwner = ADMIN_SURFACES.reduce<Record<string, AdminSurface[]>>((acc, s) => {
		(acc[s.owner] ||= []).push(s);
		return acc;
	}, {});

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
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{ACCOUNT.map(({ title, desc, path, icon: Icon }) => (
							<Card
								key={path}
								className="cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md bg-white/80 backdrop-blur-sm"
								onClick={() => navigate(path)}
							>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										<Icon className="w-4 h-4 text-indigo-600" />
										{title}
									</CardTitle>
									<CardDescription>{desc}</CardDescription>
								</CardHeader>
							</Card>
						))}
					</div>
				</section>

				{isAdmin && (
					<section className="mb-10">
						<div className="flex items-center gap-2 mb-4">
							<Shield className="w-4 h-4 text-indigo-600" />
							<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
								Admin
							</h2>
							<span className="text-[10px] uppercase tracking-wide bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
								admin
							</span>
						</div>
						{Object.entries(adminByOwner).map(([owner, items]) => (
							<div key={owner} className="mb-6">
								<h3 className="text-xs font-medium text-muted-foreground mb-2">{owner}</h3>
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{items.map((s) => {
										const Icon = s.icon;
										const body = (
											<Card className="h-full cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md bg-white/80 backdrop-blur-sm">
												<CardHeader>
													<CardTitle className="flex items-center gap-2 text-base">
														<Icon className="w-4 h-4 text-indigo-600" />
														{s.title}
														{!s.internal && (
															<ExternalLink className="w-3 h-3 text-muted-foreground ml-1" />
														)}
													</CardTitle>
													<CardDescription>{s.desc}</CardDescription>
												</CardHeader>
											</Card>
										);
										return s.internal ? (
											<div key={s.title} onClick={() => navigate(s.url)}>
												{body}
											</div>
										) : (
											<a key={s.title} href={s.url} target="_blank" rel="noopener noreferrer">
												{body}
											</a>
										);
									})}
								</div>
							</div>
						))}
					</section>
				)}

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
							// Lumilake SSO is bridged client-side — the OSS-mode
							// frontend accepts any credentials, so we pass the
							// signed-in user's email via ?email= and let it
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
