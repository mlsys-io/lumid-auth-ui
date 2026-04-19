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
	LineChart,
	ExternalLink,
} from 'lucide-react';

// Post-login landing. Intentionally minimal — lum.id is the identity
// authority, product UX lives on the service-specific subdomains.
// This page exists so users see something useful instead of the PAT
// admin screen as their first impression.

interface App {
	name: string;
	tagline: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	external: boolean;
}

const ECOSYSTEM: App[] = [
	{
		name: 'QuantArena',
		tagline: 'Strategies, backtesting, live competitions',
		url: 'https://lumid.market',
		icon: TrendingUp,
		external: true,
	},
	{
		name: 'Runmesh',
		tagline: 'Workflow orchestration at GPU scale',
		url: 'https://runmesh.ai',
		icon: Workflow,
		external: true,
	},
	{
		name: 'Analytics',
		tagline: 'Traffic dashboards (Umami, SSO-gated)',
		url: 'https://analytics.lumid.market',
		icon: BarChart3,
		external: true,
	},
	{
		name: 'FlowMesh',
		tagline: 'Distributed task execution',
		url: 'https://kv.run',
		icon: LineChart,
		external: true,
	},
	{
		name: 'Lumilake',
		tagline: 'Pipeline optimizer (HALO)',
		url: 'https://lumilake.ai',
		icon: Database,
		external: true,
	},
];

export default function Dashboard() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();

	return (
		<div className="min-h-screen bg-background">
			<div className="max-w-5xl mx-auto px-4 py-10">
				<header className="flex items-center justify-between mb-10">
					<div>
						<h1 className="text-2xl font-semibold">Welcome back, {user?.username || user?.email || 'there'}</h1>
						<p className="text-sm text-muted-foreground mt-1">{user?.email}</p>
					</div>
					<Button
						variant="outline"
						size="sm"
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
						<Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate('/account/tokens')}>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<Key className="w-4 h-4" />
									Access Tokens
								</CardTitle>
								<CardDescription>Mint and revoke Personal Access Tokens for CLI, bots, and integrations.</CardDescription>
							</CardHeader>
						</Card>
						<Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate('/account/connect')}>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<Terminal className="w-4 h-4" />
									Install LumidOS
								</CardTitle>
								<CardDescription>Provision the LumidOS CLI + MCP server on any machine with one command.</CardDescription>
							</CardHeader>
						</Card>
					</div>
				</section>

				<section>
					<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
						Apps
					</h2>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{ECOSYSTEM.map((app) => {
							const Icon = app.icon;
							return (
								<a
									key={app.name}
									href={app.url}
									target={app.external ? '_blank' : undefined}
									rel={app.external ? 'noopener noreferrer' : undefined}
									className="block"
								>
									<Card className="h-full cursor-pointer hover:border-primary/50 transition-colors">
										<CardContent className="p-4 flex items-start gap-3">
											<Icon className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-1.5">
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
				</section>
			</div>
		</div>
	);
}
