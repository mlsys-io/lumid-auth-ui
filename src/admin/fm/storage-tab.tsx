// Research Fleet → Storage: what every cluster's shared folders hold and whether they answer (everyone), and
// how full YOUR home, local disk and sandbox home are on each machine (per user; admins also see everyone).
//
// One card per site, in the order of SANDBOX_SITES. Same paths on every cluster (see /studio/docs/storage), so
// the rows line up across cards. Data: sandbox-control GET /api/storage per site (src/api/sandboxes.ts), words
// from src/lib/storage-status.ts.
import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { getStorage, SANDBOX_SITES, USER_SANDBOX_SITES } from "../../api/sandboxes";
import {
	KIND_LABEL, checkedLine, folderLine, percentUsed, serviceLine, sortByFullness, usageLine, usageTone,
	type StorageStatus, type StorageUsage,
} from "../../lib/storage-status";
import { TONES } from "../../lib/tones";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";

const SITE_LABEL: Record<string, string> = { home: "Home", office: "Office", nus: "NUS" };

function Bar({ used, total, tone }: { used: number; total: number; tone: "ok" | "attention" | "failing" }) {
	const pct = Math.min(100, percentUsed(used, total));
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100" role="img" aria-label={`${percentUsed(used, total)}% used`}>
			<div className={cn("h-full rounded-full", tone === "ok" ? "bg-ink-500" : TONES[tone].dot)} style={{ width: `${pct}%` }} />
		</div>
	);
}

function UsageRow({ u, showUser }: { u: StorageUsage; showUser?: boolean }) {
	const tone = usageTone(u.used_bytes, u.limit_bytes);
	const T = TONES[tone];
	return (
		<li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
			<span className="text-meta text-ink-800">
				{showUser && <span className="font-medium">{u.user} · </span>}
				{KIND_LABEL[u.kind] ?? u.kind}
			</span>
			<span className="text-caption tabular-nums text-ink-600">{percentUsed(u.used_bytes, u.limit_bytes)}%</span>
			<div className="col-span-2"><Bar used={u.used_bytes} total={u.limit_bytes} tone={tone} /></div>
			<span className={cn("col-span-2 flex items-center gap-1 text-caption", tone === "ok" ? "text-ink-600" : T.text)}>
				{tone !== "ok" && <T.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
				{usageLine(u)}
			</span>
		</li>
	);
}

function SiteCard({ site, st, error, isAdmin }: { site: string; st: StorageStatus | null; error: string | null; isAdmin: boolean }) {
	const [showAll, setShowAll] = useState(false);
	const pub = st?.public ?? null;
	const checked = checkedLine(pub?.checked_at ?? st?.updated);
	return (
		<section className="rounded-lg border border-ink-200 bg-card p-4 shadow-e1" data-site={site}>
			<header className="mb-3 flex items-baseline justify-between gap-3">
				<h3 className="font-display text-title text-ink-900">{SITE_LABEL[site] ?? site}</h3>
				<span className={cn("text-caption", checked.stale ? TONES.attention.text : "text-ink-600")}>{error ? "" : checked.text}</span>
			</header>
			{error ? (
				<p className={cn("flex items-center gap-1.5 text-meta", TONES.failing.text)}>
					<TONES.failing.Icon className="h-4 w-4" aria-hidden /> Could not ask this site: {error}
				</p>
			) : !pub ? (
				<p className="text-meta text-ink-600">This site has not reported yet — the first check runs within 10 minutes.</p>
			) : (
				<div className="space-y-4">
					<div>
						<div className="eyebrow mb-2 text-ink-600">Shared folders</div>
						<ul className="space-y-3">
							{pub.folders.map((f) => {
								const tone = !f.ok ? "failing" : usageTone(f.used_bytes ?? 0, f.total_bytes ?? 0);
								return (
									<li key={f.kind} className="space-y-1">
										<div className="flex flex-wrap items-baseline justify-between gap-x-3">
											<span className="text-meta font-medium text-ink-900">{f.label} <code className="ml-1 text-caption font-normal text-ink-600">{f.path}</code></span>
											<span className={cn("flex items-center gap-1 text-caption tabular-nums", f.ok ? "text-ink-600" : TONES.failing.text)}>
												{!f.ok && <TONES.failing.Icon className="h-3.5 w-3.5" aria-hidden />}{folderLine(f)}
											</span>
										</div>
										{f.ok && <Bar used={f.used_bytes ?? 0} total={f.total_bytes ?? 0} tone={tone} />}
										<div className="text-caption text-ink-600">{f.backing}</div>
									</li>
								);
							})}
						</ul>
					</div>
					<ul className="grid gap-1 sm:grid-cols-2">
						{pub.services.map((s) => {
							const T = TONES[s.ok ? "ok" : "failing"];
							return (
								<li key={s.name} className="flex items-center gap-1.5 text-caption text-ink-700">
									<T.Icon className={cn("h-3.5 w-3.5 shrink-0", T.icon)} aria-hidden />
									<span className="font-medium">{s.name}</span>
									<span className={s.ok ? "text-ink-600" : T.text}>{serviceLine(s)}</span>
								</li>
							);
						})}
					</ul>
					<div>
						<div className="eyebrow mb-2 text-ink-600">Yours</div>
						{st && st.mine.length ? (
							<ul className="space-y-3">{st.mine.map((u) => <UsageRow key={`${u.kind}-${u.machine}`} u={u} />)}</ul>
						) : (
							<p className="text-caption text-ink-600">Nothing of yours is capped at this site yet.</p>
						)}
					</div>
					{isAdmin && st?.all && (
						<div>
							<button type="button" onClick={() => setShowAll((v) => !v)} className="eyebrow text-ink-600 hover:text-ink-900">
								{showAll ? "Hide" : "Show"} everyone ({st.all.length})
							</button>
							{showAll && (
								<ul className="mt-2 space-y-3">
									{sortByFullness(st.all).map((u) => <UsageRow key={`${u.user}-${u.kind}-${u.machine}`} u={u} showUser />)}
								</ul>
							)}
						</div>
					)}
					{pub.nodes.some((n) => !n.ok) && (
						<p className={cn("text-caption", TONES.attention.text)}>
							Usage not read from: {pub.nodes.filter((n) => !n.ok).map((n) => n.node).join(", ")}
						</p>
					)}
				</div>
			)}
		</section>
	);
}

export default function StorageTab({ isAdmin }: { isAdmin: boolean }) {
	const sites = isAdmin ? SANDBOX_SITES : USER_SANDBOX_SITES;
	const [state, setState] = useState<Record<string, { st: StorageStatus | null; error: string | null }>>({});
	const [loading, setLoading] = useState(true);
	const load = useCallback(async () => {
		setLoading(true);
		const res = await Promise.all(sites.map(async (s) => {
			try { return [s, { st: await getStorage(s), error: null }] as const; }
			catch (e) {
				const code = (e as { response?: { status?: number } }).response?.status;
				return [s, { st: null, error: code ? `HTTP ${code}` : "no answer" }] as const;
			}
		}));
		setState(Object.fromEntries(res)); setLoading(false);
	}, [sites]);
	useEffect(() => { void load(); }, [load]);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="max-w-2xl text-meta text-ink-700">
					<HardDrive className="mr-1 inline h-4 w-4 align-text-bottom text-ink-600" aria-hidden />
					Every cluster uses the same paths: <code>/home/&lt;you&gt;</code> (500 GB per machine), <code>/mnt/datasets</code>,{" "}
					<code>/mnt/models</code>. <a className="underline underline-offset-2" href="/studio/docs/storage">Where your files live</a>
				</p>
				<Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
					<RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} aria-hidden /> Refresh
				</Button>
			</div>
			<div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
				{sites.map((s) => <SiteCard key={s} site={s} st={state[s]?.st ?? null} error={state[s]?.error ?? null} isAdmin={isAdmin} />)}
			</div>
		</div>
	);
}
