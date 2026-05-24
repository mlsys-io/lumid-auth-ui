// Phase S1.5 — Settings consolidation.
//
// One page with five sections. Each renders inline summaries and
// bridges to the existing deep-management page (tokens / OAuth /
// secrets per-app etc.) where the heavy lifting still lives. Once
// those pages are themselves rebuilt in Studio style we can pull
// their bodies inline too.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Key, Lock, Shield, ExternalLink, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import apiClient from '@/api/client';

type Section = {
	id: string;
	icon: typeof User;
	title: string;
	description: string;
};

const SECTIONS: Section[] = [
	{ id: 'profile',   icon: User,   title: 'Profile',          description: 'Your email, display name, and account basics.' },
	{ id: 'tokens',    icon: Key,    title: 'API tokens',       description: 'Personal access tokens for CLI and integrations.' },
	{ id: 'oauth',     icon: Lock,   title: 'Connected services', description: 'Google, Slack, GitHub, and other OAuth grants.' },
	{ id: 'secrets',   icon: Lock,   title: 'App secrets',      description: 'API keys your installed apps need (per app, per key).' },
	{ id: 'privacy',   icon: Shield, title: 'Privacy & sharing', description: 'Per-agent auto-publish toggles and data exports.' },
];

export default function StudioSettings() {
	const { user } = useAuth();
	return (
		<div className="space-y-4">
			<header>
				<h1 className="text-lg font-semibold">Settings</h1>
				<p className="text-sm text-slate-500 mt-1">
					Account, tokens, connected services, and privacy — all in one place.
				</p>
			</header>

			<ProfileSection email={user?.email ?? ''} role={user?.role ?? ''} />
			<TokensSection />
			<OAuthSection />
			<SecretsSection />
			<PrivacySection />
		</div>
	);
}

function SectionCard({
	id, icon: Icon, title, description, children,
}: Section & { children: React.ReactNode }) {
	return (
		<section id={id} className="rounded-lg border border-slate-200 bg-white p-4">
			<header className="flex items-start justify-between gap-3 mb-3">
				<div className="flex items-start gap-3 min-w-0">
					<div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
						<Icon className="w-4 h-4" />
					</div>
					<div className="min-w-0">
						<h2 className="font-semibold text-sm">{title}</h2>
						<p className="text-xs text-slate-500 mt-0.5">{description}</p>
					</div>
				</div>
			</header>
			<div className="pl-12">{children}</div>
		</section>
	);
}

function ProfileSection({ email, role }: { email: string; role: string }) {
	return (
		<SectionCard {...SECTIONS[0]}>
			<dl className="grid grid-cols-2 gap-2 text-sm">
				<dt className="text-slate-500">Email</dt>
				<dd className="font-mono text-xs">{email}</dd>
				<dt className="text-slate-500">Role</dt>
				<dd>
					<span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-slate-100 text-slate-700">
						{role || 'user'}
					</span>
				</dd>
			</dl>
			<div className="mt-3">
				<Link to="/account/profile" className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1">
					Edit profile <ExternalLink className="w-3 h-3" />
				</Link>
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
			<div className="text-sm">
				{n === null ? (
					<span className="text-slate-500 italic inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Counting tokens…</span>
				) : (
					<>You have <strong>{n}</strong> active token{n === 1 ? '' : 's'}.</>
				)}
			</div>
			<div className="mt-3">
				<Link to="/dashboard/tokens" className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1">
					Mint / revoke tokens <ExternalLink className="w-3 h-3" />
				</Link>
			</div>
		</SectionCard>
	);
}

function OAuthSection() {
	const [grants, setGrants] = useState<{ state?: string; scopes?: string[] } | null>(null);
	useEffect(() => {
		apiClient.get('/api/v1/identity/google-grants')
			.then((r: any) => setGrants(r.data?.data || null))
			.catch(() => setGrants(null));
	}, []);
	const connected = grants?.state === 'active';
	return (
		<SectionCard {...SECTIONS[2]}>
			<div className="text-sm flex items-center gap-2">
				<span className={[
					'w-2 h-2 rounded-full inline-block',
					connected ? 'bg-emerald-500' : 'bg-slate-300',
				].join(' ')} />
				<span className="font-medium">Google</span>
				<span className="text-slate-500">
					{connected ? `${(grants?.scopes ?? []).length} scope(s) granted` : 'not connected'}
				</span>
			</div>
			<div className="mt-3 flex items-center gap-3">
				<Link to="/account/connect/google" className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1">
					{connected ? 'Manage Google access' : 'Connect Google'} <ExternalLink className="w-3 h-3" />
				</Link>
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
				<div className="text-sm text-slate-500 italic inline-flex items-center gap-1">
					<Loader2 className="w-3 h-3 animate-spin" /> Loading secrets…
				</div>
			) : Object.keys(counts).length === 0 ? (
				<div className="text-sm text-slate-500 italic">No apps installed yet.</div>
			) : (
				<ul className="space-y-1 text-sm">
					{Object.entries(counts).map(([app, n]) => (
						<li key={app} className="flex items-center justify-between">
							<span className="font-mono text-xs">{app}</span>
							<span className="text-slate-500 text-xs">
								{n} secret{n === 1 ? '' : 's'}
							</span>
						</li>
					))}
				</ul>
			)}
			<div className="mt-3 text-xs text-slate-500">
				Per-app secret editing lives at <code className="font-mono">/me/apps/&lt;app&gt;/secrets</code>
				(API surface; UI in a follow-up).
			</div>
		</SectionCard>
	);
}

function PrivacySection() {
	return (
		<SectionCard {...SECTIONS[4]}>
			<div className="text-sm space-y-2">
				<p className="text-slate-600">
					By default the watcher bank stays local; assistant + philosophy banks can publish.
					Per-agent toggle below — saves to <code className="font-mono text-xs">.user-overrides.yaml</code>.
				</p>
				<Link to="/studio/knowledge" className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1">
					Open Knowledge to see what your AI knows <ExternalLink className="w-3 h-3" />
				</Link>
			</div>
		</SectionCard>
	);
}
