import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
	ArrowLeft,
	Shield,
	Ticket,
	Users,
	Server,
	Receipt,
	ClipboardCheck,
	GitBranch,
	ExternalLink,
} from 'lucide-react';

interface AdminSurface {
	title: string;
	desc: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	internal?: boolean;
	owner: 'Lumid' | 'Runmesh' | 'QuantArena' | 'Lumilake';
}

const SURFACES: AdminSurface[] = [
	{
		title: 'Invitation codes',
		desc: 'Mint, list, revoke invitation codes for the whole ecosystem.',
		url: '/account/admin/invitations',
		icon: Ticket,
		internal: true,
		owner: 'Lumid',
	},
	{
		title: 'Runmesh — user management',
		desc: 'Accounts, roles, quotas.',
		url: 'https://runmesh.ai/admin/user-management',
		icon: Users,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — suppliers',
		desc: 'GPU suppliers, node configuration, pricing.',
		url: 'https://runmesh.ai/admin/supplier-management',
		icon: Server,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — billing',
		desc: 'User + supplier billing, refunds, reconciliation.',
		url: 'https://runmesh.ai/admin/billing-management',
		icon: Receipt,
		owner: 'Runmesh',
	},
	{
		title: 'Runmesh — workflow review',
		desc: 'Moderation queue for submitted workflows.',
		url: 'https://runmesh.ai/admin/workflow-review',
		icon: ClipboardCheck,
		owner: 'Runmesh',
	},
	{
		title: 'QuantArena — management',
		desc: 'Competitions, users, leaderboards, strategy moderation.',
		url: 'https://management.lumid.market/',
		icon: GitBranch,
		owner: 'QuantArena',
	},
];

export default function AdminHub() {
	const navigate = useNavigate();
	const { user } = useAuth();

	const grouped = SURFACES.reduce<Record<string, AdminSurface[]>>((acc, s) => {
		(acc[s.owner] ||= []).push(s);
		return acc;
	}, {});

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
			<div className="max-w-4xl mx-auto px-4 py-10">
				<header className="flex items-center justify-between mb-8">
					<div className="flex items-center gap-3">
						<Button variant="ghost" size="sm" onClick={() => navigate('/account')}>
							<ArrowLeft className="w-4 h-4 mr-1" />
							Account
						</Button>
						<div className="flex items-center gap-2">
							<Shield className="w-5 h-5 text-indigo-600" />
							<h1 className="text-xl font-semibold">Admin hub</h1>
							<span className="text-xs text-muted-foreground">
								· signed in as {user?.email}
							</span>
						</div>
					</div>
				</header>

				{Object.entries(grouped).map(([owner, items]) => (
					<section key={owner} className="mb-8">
						<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
							{owner}
						</h2>
						<div className="grid gap-3 sm:grid-cols-2">
							{items.map((s) => {
								const Icon = s.icon;
								const CardEl = (
									<Card className="h-full cursor-pointer hover:shadow-lg transition-shadow border-0 shadow-md bg-white/80 backdrop-blur-sm">
										<CardHeader>
											<CardTitle className="flex items-center gap-2 text-base">
												<Icon className="w-4 h-4 text-indigo-600" />
												{s.title}
												{!s.internal && <ExternalLink className="w-3 h-3 text-muted-foreground ml-1" />}
											</CardTitle>
											<CardDescription>{s.desc}</CardDescription>
										</CardHeader>
									</Card>
								);
								return s.internal ? (
									<div key={s.title} onClick={() => navigate(s.url)}>
										{CardEl}
									</div>
								) : (
									<a key={s.title} href={s.url} target="_blank" rel="noopener noreferrer">
										{CardEl}
									</a>
								);
							})}
						</div>
					</section>
				))}

				<p className="text-xs text-muted-foreground mt-2">
					External (↗) cards open the app's own admin UI. Roll-up of every admin surface into lum.id is
					incremental — invitation codes live here natively; the rest link out until their backends accept
					lum.id session tokens.
				</p>
			</div>
		</div>
	);
}
