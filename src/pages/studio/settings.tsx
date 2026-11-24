// Phase S1.5 — Settings consolidation.
//
// One page with five sections. Each renders inline summaries and
// bridges to the existing deep-management page (tokens / OAuth /
// secrets per-app etc.) where the heavy lifting still lives. Once
// those pages are themselves rebuilt in Studio style we can pull
// their bodies inline too.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Key, Lock, Shield, ArrowRight, MessageSquare, Database, PlugZap } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import apiClient from '@/api/client';
import { useLandingPref } from '@/lib/landing-pref';

type Section = {
	id: string;
	icon: typeof User;
	title: string;
	description: string;
};

const SECTIONS: Section[] = [
	{ id: 'profile',   icon: User,   title: 'Profile',          description: 'Your email, display name, and account basics.' },
	{ id: 'tokens',    icon: Key,    title: 'API tokens',       description: 'Personal access tokens for CLI and integrations.' },
	{ id: 'oauth',     icon: PlugZap,   title: 'Connected services', description: 'Google, Slack, GitHub, and other OAuth grants.' },
	{ id: 'secrets',   icon: Lock,   title: 'Agent secrets',    description: 'API keys your installed agents need (per agent, per key).' },
	{ id: 'privacy',   icon: Shield, title: 'Privacy & sharing', description: 'What your AI keeps private and what it may publish.' },
	{ id: 'chat',      icon: MessageSquare, title: 'Chat & navigation', description: 'How opening something from a list behaves.' },
	// APPENDED, not inserted: the entries above are addressed positionally
	// (SECTIONS[5] is Chat & navigation), so inserting shifts every card below.
	{ id: 'warehouse', icon: Database, title: 'Warehouse access', description: 'A Postgres login for the FinData warehouse, for your own SQL client.' },
];

export default function StudioSettings() {
	const { user } = useAuth();
	return (
		<div>
			<PageHeader
				className="pt-2"
				title="Settings"
				subtitle="Account, tokens, connected services, and privacy — all in one place."
			/>
			{/* Lumen: two-column settings groups (label left, controls right) separated
			    by hairlines — the boxed card-per-section with a bronze icon tile read as
			    seven equal alarms. The page's own header replaces the strip title. */}
			<div className="divide-y divide-border border-t border-border">
				<ProfileSection email={user?.email ?? ''} role={user?.role ?? ''} />
				<TokensSection />
				<OAuthSection />
				<SecretsSection />
				<WarehouseSection />
				<PrivacySection />
				<ChatNavSection />
			</div>
		</div>
	);
}

// ChatNavSection — the configurable landing behavior. Every Studio index
// (Apps, Library, Jobs) terminates in the chat; this picks whether opening a
// row asks the AI right away or just lands you in the chat ready to type.
function ChatNavSection() {
	const [pref, setPref] = useLandingPref();
	const options: Array<{ v: 'ask' | 'type'; title: string; desc: string }> = [
		{ v: 'type', title: 'Just open the chat (default)', desc: 'Lands in the chat with the question pre-filled — you hit send when ready.' },
		{ v: 'ask',  title: 'Ask the AI right away',        desc: 'Opening something fires the question immediately, so the answer streams in.' },
	];
	return (
		<SectionCard {...SECTIONS[5]}>
			<div className="space-y-2" role="radiogroup" aria-labelledby="landing-pref-label">
				<div className="mb-1 text-meta text-ink-600" id="landing-pref-label">When I open something from a list:</div>
				{options.map((o) => (
					<button
						key={o.v}
						type="button"
						role="radio"
						aria-checked={pref === o.v}
						onClick={() => setPref(o.v)}
						className={[
							'lumen-press w-full text-left flex items-start gap-3 rounded-[8px] border px-3 py-2.5 transition-colors duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
							pref === o.v ? 'border-gold-300 bg-gold-50/60' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50',
						].join(' ')}
					>
						<span className={[
							'mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center',
							'transition-colors duration-180',
							pref === o.v ? 'border-gold-600' : 'border-ink-400',
						].join(' ')}>
							{pref === o.v && <span className="w-2 h-2 rounded-full bg-gold-600 animate-in zoom-in-50 fade-in duration-180" />}
						</span>
						<span className="min-w-0">
							<span className="block text-body font-medium text-ink-900">{o.title}</span>
							<span className="block text-meta text-ink-600 mt-0.5">{o.desc}</span>
						</span>
					</button>
				))}
			</div>
		</SectionCard>
	);
}

function SectionCard({
	id, icon: Icon, title, description, children,
}: Section & { children: React.ReactNode }) {
	return (
		<section id={id} className="grid gap-4 py-7 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] md:gap-10 scroll-mt-20">
			<header className="min-w-0">
				<h2 className="flex items-center gap-2 text-title font-medium text-ink-900">
					<Icon className="h-4 w-4 shrink-0 text-ink-500" aria-hidden />
					{title}
				</h2>
				<p className="mt-1 text-meta text-ink-600 text-pretty">{description}</p>
			</header>
			<div className="min-w-0 max-w-[640px] rounded-[12px] border border-border bg-card p-5 shadow-e1">{children}</div>
		</section>
	);
}

/** Internal hop to the page that does the heavy lifting. */
function GoLink({ to, children }: { to: string; children: React.ReactNode }) {
	return (
		<Link
			to={to}
			className="group inline-flex items-center gap-1 rounded text-meta font-medium text-gold-700 hover:text-gold-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		>
			{children}
			<ArrowRight className="h-3.5 w-3.5 transition-transform duration-180 group-hover:translate-x-0.5" aria-hidden />
		</Link>
	);
}

function LineSkeleton({ w = 'w-48' }: { w?: string }) {
	return <Skeleton className={`h-4 ${w} rounded`} />;
}

function ProfileSection({ email, role }: { email: string; role: string }) {
	return (
		<SectionCard {...SECTIONS[0]}>
			<dl className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-body">
				<dt className="text-meta text-ink-600">Email</dt>
				<dd className="truncate font-mono text-meta text-ink-900">{email || <LineSkeleton />}</dd>
				<dt className="text-meta text-ink-600">Role</dt>
				<dd>
					<span className="inline-flex rounded-full bg-ink-100 px-2 py-0.5 text-caption font-medium text-ink-700">
						{role || 'user'}
					</span>
				</dd>
			</dl>
			<div className="mt-4 border-t border-ink-100 pt-3">
				<GoLink to="/account/profile">Edit profile</GoLink>
			</div>
		</SectionCard>
	);
}

// WarehouseSection — the FinData SQL seat, surfaced the same way as API
// tokens because it is the same shape: you mint it yourself and it is shown
// once.
//
// It lives here because it had NO navigation entry at all. fa21526 removed the
// link from the Studio rail ("SQL access ... move to their owners") but never
// added it to an owner, leaving /studio/account/findata-sql reachable only via
// a companion button on the docs page. A page nobody can find is a page nobody
// uses.
//
// The status endpoint is always 200 for a signed-in caller and explains WHY in
// `reason`, so this renders the explanation rather than an error — most users
// are not entitled, and "ask an operator" is a different instruction from
// "mint one".
function WarehouseSection() {
	const [st, setSt] = useState<any | null>(null);
	const [err, setErr] = useState(false);
	useEffect(() => {
		apiClient.get('/api/v1/me/findata-sql')
			.then((r: any) => setSt(r.data?.data ?? r.data ?? null))
			.catch(() => setErr(true));
	}, []);

	const active = st?.credential_active === true;
	const canMint = st?.entitled === true && !!st?.role;

	return (
		<SectionCard {...SECTIONS[6]}>
			<div className="text-body text-ink-800">
				{err ? (
					<span className="text-ink-600">Could not load warehouse status.</span>
				) : st === null ? (
					<LineSkeleton w="w-64" />
				) : active ? (
					<>Active credential for <strong>{st.role}</strong>.</>
				) : canMint ? (
					<>No credential yet for <strong>{st.role}</strong>.</>
				) : (
					<span className="text-ink-600">{st.reason ?? 'Not available on this account.'}</span>
				)}
			</div>
			{/* Only offered when it would actually work. Sending an un-entitled
			    user to a page that can only tell them "ask an operator" is a
			    dead end wearing the clothes of an action. */}
			{canMint && (
				<div className="mt-3">
					<GoLink to="/studio/account/findata-sql">{active ? 'Rotate / revoke credential' : 'Mint a credential'}</GoLink>
				</div>
			)}
			{/* Everyone else gets the honest framing: you do not need this to use
			    the data, only to point your own client at it. */}
			<div className="mt-3 text-meta text-ink-600">
				Not needed to explore the data — Data and chat query as you, with no credential.
			</div>
		</SectionCard>
	);
}

function TokensSection() {
	const [n, setN] = useState<number | null>(null);
	useEffect(() => {
		apiClient.get('/api/v1/identity/personal-access-tokens')
			.then((r: any) => {
				const list = r.data?.data?.tokens || r.data?.tokens || r.data?.data || [];
				setN(Array.isArray(list) ? list.length : 0);
			})
			.catch(() => setN(0));
	}, []);
	return (
		<SectionCard {...SECTIONS[1]}>
			<div className="text-body text-ink-800">
				{n === null ? (
					<LineSkeleton />
				) : (
					<>You have <strong className="font-semibold tabular-nums text-ink-900">{n}</strong> active token{n === 1 ? '' : 's'}.</>
				)}
			</div>
			<div className="mt-4 border-t border-ink-100 pt-3">
				<GoLink to="/studio/account/tokens">Mint or revoke tokens</GoLink>
			</div>
		</SectionCard>
	);
}

function ConnectionRow({
	label,
	connected,
	detail,
	href,
	manageLabel,
	connectLabel,
}: {
	label: string;
	connected: boolean;
	detail: string;
	href: string;
	manageLabel: string;
	connectLabel: string;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
			<div className="flex min-w-0 items-center gap-2.5">
				<span className={[
					'inline-block h-2 w-2 shrink-0 rounded-full',
					connected ? 'bg-gold-500 ring-4 ring-gold-100' : 'bg-ink-300',
				].join(' ')} aria-hidden />
				<span className="text-body font-medium text-ink-900">{label}</span>
				<span className="truncate text-meta text-ink-600">{detail}</span>
			</div>
			<GoLink to={href}>{connected ? manageLabel : connectLabel}</GoLink>
		</div>
	);
}

function OAuthSection() {
	const [google, setGoogle] = useState<{ state?: string; scopes?: string[] } | null>(null);
	const [microsoft, setMicrosoft] = useState<{ state?: string; scopes?: string } | null>(null);
	const [powerAutomate, setPowerAutomate] = useState<{ configured?: boolean } | null>(null);
	useEffect(() => {
		apiClient.get('/api/v1/identity/google-grants')
			.then((r: any) => setGoogle(r.data?.data || null))
			.catch(() => setGoogle(null));
		apiClient.get('/api/v1/identity/microsoft-grants')
			.then((r: any) => setMicrosoft(r.data?.data || null))
			.catch(() => setMicrosoft(null));
		apiClient.get('/api/v1/me/power-automate-tokens')
			.then((r: any) => setPowerAutomate(r.data?.data || null))
			.catch(() => setPowerAutomate(null));
	}, []);

	// Note the three backends use distinct "connected" vocabularies:
	// Google grant state is 'active'; Microsoft grant state is 'connected';
	// Power Automate has no OAuth grant — it's a minted webhook token, so
	// `configured` is the liveness flag.
	const googleConnected = google?.state === 'active';
	const microsoftConnected = microsoft?.state === 'connected';
	const paConfigured = powerAutomate?.configured === true;

	return (
		<SectionCard {...SECTIONS[2]}>
			<div className="divide-y divide-ink-100">
				<ConnectionRow
					label="Google"
					connected={googleConnected}
					detail={googleConnected ? `${(google?.scopes ?? []).length} scope(s) granted` : 'not connected'}
					href="/account/connect/google"
					manageLabel="Manage Google access"
					connectLabel="Connect Google"
				/>
				<ConnectionRow
					label="Microsoft"
					connected={microsoftConnected}
					detail={
						microsoftConnected
							? `Outlook + Graph${microsoft?.scopes ? ` · ${microsoft.scopes.split(' ').length} scope(s)` : ''}`
							: 'not connected'
					}
					href="/account/connect/microsoft"
					manageLabel="Manage Microsoft access"
					connectLabel="Connect Microsoft"
				/>
				<ConnectionRow
					label="Power Automate"
					connected={paConfigured}
					detail={paConfigured ? 'Outlook bridge configured' : 'not configured (Graph-blocked orgs)'}
					href="/account/connect/power-automate"
					manageLabel="Manage Power Automate"
					connectLabel="Set up Power Automate"
				/>
			</div>
		</SectionCard>
	);
}

function SecretsSection() {
	// Per-app secrets are listed by app — we surface a count across
	// the user's installed apps. Click-through to the per-app secrets
	// editor (currently a future studio page; bridge for now).
	const [counts, setCounts] = useState<Record<string, number> | null>(null);
	useEffect(() => {
		(async () => {
			try {
				const apps = await apiClient.get('/api/v1/me/apps').then((r: any) => r.data?.data?.apps || []);
				const tenantApps = (apps as any[]).filter((a) => a.tenant);
				const result: Record<string, number> = {};
				for (const a of tenantApps) {
					try {
						const r = await apiClient.get(`/api/v1/me/apps/${encodeURIComponent(a.name)}/secrets`);
						result[a.name] = (r.data?.data?.secrets || []).length;
					} catch {
						result[a.name] = 0;
					}
				}
				setCounts(result);
			} catch {
				setCounts({});
			}
		})();
	}, []);
	return (
		<SectionCard {...SECTIONS[3]}>
			{counts === null ? (
				<div className="space-y-2.5"><LineSkeleton w="w-full" /><LineSkeleton w="w-3/4" /></div>
			) : Object.keys(counts).length === 0 ? (
				<div className="text-body text-ink-600">No apps installed yet.</div>
			) : (
				<ul className="divide-y divide-ink-100">
					{Object.entries(counts).map(([app, n]) => (
						<li key={app} className="flex items-center justify-between py-2 first:pt-0">
							<span className="font-mono text-meta text-ink-800">{app}</span>
							<span className={n ? 'text-meta tabular-nums text-ink-800' : 'text-meta tabular-nums text-ink-600'}>
								{n} secret{n === 1 ? '' : 's'}
							</span>
						</li>
					))}
				</ul>
			)}
			<div className="mt-4 border-t border-ink-100 pt-3 text-meta text-ink-600">
				To edit an app's secrets, open the app and choose <span className="font-medium">⋯ → Manage agent</span>.
			</div>
		</SectionCard>
	);
}

function PrivacySection() {
	return (
		<SectionCard {...SECTIONS[4]}>
			<p className="text-body text-ink-700 text-pretty">
				By default the watcher bank stays local; assistant + philosophy banks can publish.
			</p>
			<div className="mt-4 border-t border-ink-100 pt-3">
				<GoLink to="/studio/knowledge">Open Knowledge to see what your AI knows</GoLink>
			</div>
		</SectionCard>
	);
}
