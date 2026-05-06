import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
	BrainCircuit,
	Workflow,
	Send,
	Github,
	MessageCircle,
	MessagesSquare,
	User as UserIcon,
	LogOut,
	Menu,
	X,
	Server,
	Shield,
	LayoutDashboard,
	Users,
	Receipt,
	Database,
	PlayCircle,
	Trophy,
	Layers,
	KeyRound,
	LineChart,
	ExternalLink,
	BarChart3,
	LayoutGrid,
	Activity,
	Code2,
	Inbox,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LanguageProvider } from '../runmesh/i18n';
import { EnterpriseTipProvider } from '../runmesh/components/EnterpriseTip';
import { useAuthStore } from '../runmesh/stores/useAuthStore';
import { httpUser } from '../runmesh/utils/axios';
import { useEffect } from 'react';
import { Button } from './ui/button';
import { getSimulationStrategies, ApiError } from '../quantarena/api';
import type { SimulationStrategyInfo } from '../quantarena/api/types';
import { cn } from '../lib/utils';

// Unified shell for every authenticated route. Post-2026-04-24 merge,
// this single component serves both the old /app/* product tree and
// the old /dashboard/* identity tree — both now live under /dashboard/*.
// The sidebar covers four groups (Product, Lumilake, Administration,
// Account); admin is role-gated.
//
// LanguageProvider wraps the tree because the ported Runmesh pages'
// useLanguage/t() helpers require it; non-Runmesh pages ignore it.

interface NavItem {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	end?: boolean;
	// Paths that, when active, should NOT light up this entry. Used by
	// "Lumid Market" (`/dashboard/quant`) to defer to "Market data"
	// (`/dashboard/quant/market-data`) since market-data was promoted
	// out of the Quant section into Datasets.
	excludeActiveFor?: string[];
}

// External-destination sidebar item (e.g. Lumid Market lives in its
// own React app at lumid.market; we render a regular `<a>` instead of
// a `NavLink` so the click leaves the lum.id shell.
interface ExternalNavItem {
	href: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}

// 2026-04-24 build / submit / run split:
//   - Workflow Builder  = design surface (n8n canvas)
//   - Runmesh Submit    = pick + submit to FlowMesh, or manage cron
//   - Lumilake Submit   = submit to Lumilake analytics
//   - Running jobs      = unified runtime list, both backends
const PRODUCT_NAV: NavItem[] = [
	{ to: '/dashboard', label: 'Workflow Builder', icon: Workflow, end: true },
	{ to: '/dashboard/runmesh/submit', label: 'Runmesh Submit', icon: Send },
	{ to: '/dashboard/lumilake-submit', label: 'Lumilake Submit', icon: Send },
	{ to: '/dashboard/jobs', label: 'Running jobs', icon: PlayCircle, end: true },
	{ to: '/dashboard/gpu-rentals', label: 'GPU rentals', icon: Server },
];

// Datasets surface — Lumilake lakehouse browser + Market data (the
// QA market-data page promoted up from /dashboard/quant/* on
// 2026-04-30 because it's a dataset-class concern, not a quant-only
// one — equity / crypto OHLCV is fed to lots of pipelines, not just
// LQA strategies). Market data still lives at /dashboard/quant/
// market-data so existing in-app links and the QA tab nav both
// resolve. Financial data added 2026-05-02 — the FinData Vue SPA
// embedded inside lum.id via /findata-embed/ same-origin proxy
// (lumid.data prerequisite Tier E).
const LUMILAKE_NAV: NavItem[] = [
	{ to: '/dashboard/lumilake/data', label: 'Data browsing', icon: Database },
	{ to: '/dashboard/quant/market-data', label: 'Market data', icon: BarChart3 },
	{ to: '/dashboard/datasets/findata', label: 'Financial data', icon: LineChart },
];

// Lumid Market (LQA) sidebar entries are rendered by QuantSection
// below — contextual on /dashboard/quant/* (full LQA nav inline +
// dynamic My contests) and a single "Lumid Market" link elsewhere.
// 2026-05-03 collapse: there is exactly one left rail across the
// whole app; the prior in-page LQA sidebar was deleted.

// Consolidated admin nav: 17 flat items collapsed to 5. Each section
// lands on its first sub-page, with the remaining pages shown as tabs
// inside the section (see pages/app/admin-section-layout.tsx). Deep
// links like /app/admin/users/matrix still resolve because the tab
// navigation is URL-based.
const ADMIN_NAV: NavItem[] = [
	{ to: '/dashboard/admin', label: 'Overview', icon: LayoutDashboard, end: true },
	{ to: '/dashboard/admin/users', label: 'People & access', icon: Users },
	{ to: '/dashboard/admin/clusters', label: 'Infrastructure', icon: Layers },
	{ to: '/dashboard/admin/competitions', label: 'Lumid Market', icon: Trophy },
];

function SidebarItem({
	to,
	label,
	icon: Icon,
	end,
	excludeActiveFor,
	onClick,
}: NavItem & { onClick?: () => void }) {
	const location = useLocation();
	const suppressActive =
		excludeActiveFor?.some(
			(p) => location.pathname === p || location.pathname.startsWith(p + '/'),
		) ?? false;
	return (
		<NavLink
			to={to}
			end={end}
			onClick={onClick}
			className={({ isActive }) => {
				const active = isActive && !suppressActive;
				return `flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md transition-colors ${
					active
						? 'bg-indigo-100 text-indigo-700 font-medium'
						: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
				}`;
			}}
		>
			<Icon className="w-4 h-4 shrink-0" />
			<span className="truncate">{label}</span>
		</NavLink>
	);
}

function SidebarExternalItem({ href, label, icon: Icon, onClick }: ExternalNavItem & { onClick?: () => void }) {
	return (
		<a
			href={href}
			onClick={onClick}
			className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md transition-colors text-slate-600 hover:bg-slate-100 hover:text-slate-900"
			title={`${label} — opens at ${href.replace(/^https?:\/\//, '')}`}
		>
			<Icon className="w-4 h-4 shrink-0" />
			<span className="truncate flex-1">{label}</span>
			<ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
		</a>
	);
}

// Shown beneath every page inside the AppLayout shell (post-2026-04-24
// consolidation). Used to live inside UserDashboard only — now global.
function CommunityFooter() {
	return (
		<footer className="mt-12 border-t border-slate-200 pt-6 pb-2">
			<h3 className="text-sm font-semibold text-slate-800 mb-1">
				Join the Community
			</h3>
			<p className="text-xs text-slate-500 mb-3">
				Connect with team members, contributors, and developers across channels.
			</p>
			<div className="flex items-center gap-3">
				<a
					href="https://github.com/mlsys-io"
					target="_blank"
					rel="noopener noreferrer"
					className="text-slate-500 hover:text-slate-900 transition-colors"
					aria-label="GitHub"
				>
					<Github className="w-4 h-4" />
				</a>
				<a
					href="https://discord.gg/lumid"
					target="_blank"
					rel="noopener noreferrer"
					className="text-slate-500 hover:text-slate-900 transition-colors"
					aria-label="Discord"
				>
					<MessagesSquare className="w-4 h-4" />
				</a>
				<a
					href="mailto:hello@lum.id"
					className="text-slate-500 hover:text-slate-900 transition-colors"
					aria-label="Contact"
				>
					<MessageCircle className="w-4 h-4" />
				</a>
			</div>
		</footer>
	);
}

function SectionLabel({ label }: { label: string }) {
	return (
		<div className="mt-4 mb-1 px-2.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
			<span className="text-slate-500">{label}</span>
			<div className="flex-1 h-px ml-1.5 bg-slate-200" />
		</div>
	);
}

// Quant section — contextual. When the user is outside /dashboard/quant
// the section shows a single "Lumid Market" entry. When inside, the
// entry expands inline to the full LQA nav (Browse + My strategies +
// Strategy + Data sources + Pathways) and a "My contests" subsection
// derived client-side from getSimulationStrategies. Replaces the old
// inner LQA sidebar — one left rail across the whole app.
const ROSTER_INVALIDATE_EVENT = 'competition-roster:invalidate';

type JoinedContest = {
	competition_id: number;
	competition_name: string;
	competing: boolean;
};

function deriveJoined(strategies: SimulationStrategyInfo[]): JoinedContest[] {
	const byId = new Map<number, JoinedContest>();
	for (const s of strategies) {
		if (!s.competition_id) continue;
		const existing = byId.get(s.competition_id);
		const competing = s.status === 'Competing';
		if (existing) {
			existing.competing = existing.competing || competing;
		} else {
			byId.set(s.competition_id, {
				competition_id: s.competition_id,
				competition_name: s.competition_name ?? `Competition ${s.competition_id}`,
				competing,
			});
		}
	}
	return Array.from(byId.values()).sort((a, b) => {
		if (a.competing !== b.competing) return a.competing ? -1 : 1;
		return a.competition_name.localeCompare(b.competition_name);
	});
}

// 3 LQA entries (down from 5 on 2026-05-03):
//   Competitions = Browse + My strategies (combined behind a sub-tab strip)
//   Backtest     = Strategies + Results + Data sources (3 sub-tabs)
//   Pathways     = REST/MCP reference docs
//
// "Browse" and "My strategies" are different views of the same
// competition list, so they share a page. "Data sources" feed
// backtests exclusively, so they live inside Backtest. "Strategy"
// renamed to "Backtest" to reflect what the page actually IS — the
// backtest engine workflow.
const LQA_NAV: NavItem[] = [
	{ to: '/dashboard/quant/competition', label: 'Competitions', icon: LayoutGrid },
	{ to: '/dashboard/quant/strategy', label: 'Backtest', icon: Code2 },
];

function QuantSection({ onItemClick }: { onItemClick?: () => void }) {
	const location = useLocation();
	const inLqa = location.pathname.startsWith('/dashboard/quant');
	const [joined, setJoined] = useState<JoinedContest[]>([]);

	useEffect(() => {
		// Only fetch when the user is in the LQA tree — saves a request
		// for visitors who never go near /dashboard/quant.
		if (!inLqa) return;
		let cancelled = false;
		const load = async () => {
			try {
				const r = await getSimulationStrategies({ page: 1, page_size: 200 });
				if (!cancelled) setJoined(deriveJoined(r.data?.strategies ?? []));
			} catch (e) {
				if (e instanceof ApiError && e.ret_code === 401) return;
				// non-fatal — section just shows static items only
			}
		};
		load();
		const handler = () => load();
		window.addEventListener(ROSTER_INVALIDATE_EVENT, handler);
		return () => {
			cancelled = true;
			window.removeEventListener(ROSTER_INVALIDATE_EVENT, handler);
		};
	}, [inLqa]);

	// Always render the full Lumid Market nav (Competitions + Backtest)
	// regardless of whether the user is already inside /dashboard/quant.
	// The previous "collapse to one item outside LQA" behavior caused
	// surprise: /dashboard showed only Competitions, but clicking into
	// /dashboard/quant/competition/lobby revealed a second Backtest
	// entry. Same nav at every depth is the principle of least
	// astonishment.
	return (
		<>
			<SectionLabel label="Lumid Market" />
			<div className="space-y-px">
				{LQA_NAV.map((item) => (
					<SidebarItem key={item.to} {...item} onClick={onItemClick} />
				))}
			</div>
			{inLqa && joined.length > 0 && (
				<>
					<SectionLabel label="My contests" />
					<div className="space-y-px">
						{joined.map((c) => (
							<ContestSidebarItem key={c.competition_id} contest={c} onClick={onItemClick} />
						))}
					</div>
				</>
			)}
		</>
	);
}

function ContestSidebarItem({
	contest,
	onClick,
}: {
	contest: JoinedContest;
	onClick?: () => void;
}) {
	const to = `/dashboard/quant/competition/${contest.competition_id}`;
	return (
		<NavLink
			to={to}
			end={false}
			onClick={onClick}
			className={({ isActive }) =>
				cn(
					'flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md transition-colors',
					isActive
						? 'bg-indigo-50 text-indigo-700 font-medium'
						: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
				)
			}
		>
			<span
				className={cn(
					'inline-block w-1.5 h-1.5 rounded-full flex-none ml-0.5 mr-1',
					contest.competing ? 'bg-emerald-500' : 'bg-slate-300',
				)}
				aria-hidden
			/>
			<span className="truncate">{contest.competition_name}</span>
		</NavLink>
	);
}

export default function AppLayout() {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const [mobileOpen, setMobileOpen] = useState(false);
	const close = () => setMobileOpen(false);
	// super_admin inherits every admin capability; treat both as admin
	// for sidebar + nav gating. Distinct gates (billing/accounting) can
	// check === 'super_admin' explicitly where needed.
	const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
	const setRunmeshUser = useAuthStore((s) => s.setUser);

	// Bridge lum.id → Runmesh auth store. The ported Runmesh pages
	// (Billing, Stripe/Alipay flow) read user.id from useAuthStore and
	// require a numeric Runmesh sys_user.user_id, not lum.id's UUID.
	// Fetch /runmesh/system/user/profile once on mount — Sa-Token's
	// session is already established via SSO bridge, so this just
	// returns the current user's row.
	useEffect(() => {
		if (!user) return;
		(async () => {
			try {
				const profile = await httpUser.get<any>('/runmesh/system/user/profile');
				const u = profile?.user ?? profile;
				if (u?.userId != null) {
					setRunmeshUser({
						id: u.userId,
						username: u.userName || user.username || '',
						nickname: u.nickName || user.username || '',
						email: u.email || user.email || '',
						role: (user.role as any) || 'user',
					} as any);
				}
			} catch {
				// best-effort — pages that need this data will show their
				// own error state rather than blowing up the whole shell.
			}
		})();
	}, [user, setRunmeshUser]);

	const sidebar = (
		<aside className="w-60 shrink-0 flex flex-col bg-white/90 backdrop-blur-sm border-r border-slate-200/60 h-full">
			{/* Brand */}
			<div className="px-3 py-3 border-b border-slate-200/60 flex items-center gap-2">
				<div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-md shadow-sm">
					<BrainCircuit className="w-4 h-4 text-white" />
				</div>
				<span className="font-semibold text-sm flex-1">lum.id</span>
				<Button
					variant="ghost"
					size="sm"
					className="md:hidden -mr-2 px-2"
					onClick={close}
					aria-label="Close menu"
				>
					<X className="w-4 h-4" />
				</Button>
			</div>

			{/* Nav */}
			<nav className="flex-1 overflow-y-auto px-2 pt-2 pb-4">
				<SectionLabel label="AI Compute" />
				<div className="space-y-px">
					{PRODUCT_NAV.map((item) => (
						<SidebarItem key={item.to} {...item} onClick={close} />
					))}
				</div>

				<SectionLabel label="Datasets" />
				<div className="space-y-px">
					{LUMILAKE_NAV.map((item) => (
						<SidebarItem key={item.to} {...item} onClick={close} />
					))}
				</div>

				<QuantSection onItemClick={close} />

				{isAdmin && (
					<>
						<div className="mt-4 mb-1 px-2.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
							<Shield className="w-3 h-3 text-indigo-600" />
							<span className="text-indigo-700">Administration</span>
							<div className="flex-1 h-px ml-1.5 bg-indigo-200/70" />
						</div>
						<div className="space-y-px">
							{ADMIN_NAV.map((item) => (
								<SidebarItem key={item.to} {...item} onClick={close} />
							))}
						</div>
					</>
				)}

				{/* Account surface — Profile / Tokens / Billing as
				    three standalone sidebar entries. Tokens was
				    previously tabbed under Account; hoisted out
				    2026-04-24 since PATs are a top-level CLI/SDK
				    onboarding concern, not a profile sub-page.
				    Billing is hidden for admins (they manage payment
				    flows via the Admin tree) but the /dashboard/billing
				    route stays reachable so direct links never break. */}
				<SectionLabel label="Account" />
				<div className="space-y-px">
					<SidebarItem to="/dashboard/profile" label="Account" icon={UserIcon} onClick={close} />
					<SidebarItem to="/dashboard/tokens" label="Tokens" icon={KeyRound} onClick={close} />
					<SidebarItem to="/dashboard/inbox" label="Inbox" icon={Inbox} onClick={close} />
					{!isAdmin && (
						<SidebarItem to="/dashboard/billing" label="Billing" icon={Receipt} onClick={close} />
					)}
				</div>
			</nav>

			{/* User footer */}
			<div className="p-2.5 border-t border-slate-200/60">
				<div className="px-2 pt-1 pb-2 flex items-center gap-1.5 min-w-0">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-1.5">
							<span className="text-[13px] font-medium truncate">
								{user?.username || user?.email?.split('@')[0] || 'there'}
							</span>
							{isAdmin ? (
								<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-indigo-100 text-indigo-700">
									<Shield className="w-3 h-3" />
									admin
								</span>
							) : (
								<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-slate-100 text-slate-600">
									user
								</span>
							)}
						</div>
						<p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
					</div>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="w-full justify-start text-[13px] bg-white/60"
					onClick={async () => {
						await logout();
						navigate('/auth/login');
					}}
				>
					<LogOut className="w-3.5 h-3.5 mr-2" />
					Sign out
				</Button>
			</div>
		</aside>
	);

	return (
		<LanguageProvider>
			<EnterpriseTipProvider>
			<div className="min-h-screen bg-slate-50">
				{/* Mobile top bar */}
				<header className="md:hidden bg-white/95 backdrop-blur-sm border-b border-slate-200 flex items-center gap-2 px-3 py-2 sticky top-0 z-30">
					<Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)} aria-label="Open menu">
						<Menu className="w-4 h-4" />
					</Button>
					<div className="flex items-center gap-1.5">
						<BrainCircuit className="w-4 h-4 text-indigo-600" />
						<span className="font-semibold text-sm">lum.id</span>
					</div>
				</header>

				{/* Mobile drawer */}
				{mobileOpen && (
					<div className="md:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
						<button
							type="button"
							className="absolute inset-0 bg-slate-900/40"
							aria-label="Close menu"
							onClick={close}
						/>
						<div className="relative z-10 w-60">{sidebar}</div>
					</div>
				)}

				<div className="max-w-7xl mx-auto flex">
					<div className="hidden md:flex sticky top-0 h-screen">{sidebar}</div>

					<main className="app-main flex-1 min-w-0 bg-slate-50 px-4 md:px-8 py-6 flex flex-col">
						{/* Ported Runmesh + Lumilake pages bring their own
						    Card/header chrome. Wrapping them in an outer
						    Card created a card-in-card nesting with
						    mismatched padding and font sizes. Render the
						    Outlet directly; the .app-main class scopes
						    CSS overrides that normalize typography +
						    background next to the sidebar. */}
						<div className="flex-1">
							<Outlet />
						</div>
						<CommunityFooter />
					</main>
				</div>
			</div>
			</EnterpriseTipProvider>
		</LanguageProvider>
	);
}
