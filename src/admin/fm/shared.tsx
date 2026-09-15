// Shared plumbing for the lum.id/fm dashboard tabs.
//
// Every tab needs the same three things: fetch a merged fan-out, show which
// sites answered, and re-fetch on demand. The site strip in particular is not
// decoration — see SiteStrip below.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isSessionExpired } from "../../api/client";
import type { FmFanout, FmSiteStatus } from "../../api/fm";

/**
 * Fetch a merged fan-out, with a manual refresh and an optional poll.
 *
 * Deliberately plain state rather than react-query: this admin area has no
 * query client mounted (react-query is only wired up under `src/lumilake/*`),
 * and adding one here would be a second, divergent data layer in the same page.
 */
export function useFanout<T>(
	fetcher: () => Promise<FmFanout<T>>,
	pollMs = 0,
): {
	data: FmFanout<T> | null;
	loading: boolean;
	error: string | null;
	refresh: () => void;
} {
	const [data, setData] = useState<FmFanout<T> | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Keep the latest fetcher without making it a dependency — callers pass an
	// inline arrow, so depending on it would re-run the effect every render.
	const ref = useRef(fetcher);
	ref.current = fetcher;

	const run = useCallback(async () => {
		try {
			const d = await ref.current();
			setData(d);
			setError(null);
		} catch (e) {
			if (isSessionExpired(e)) return;
			const msg = e instanceof Error ? e.message : "request failed";
			setError(msg);
			toast.error(`lum.id/fm: ${msg}`);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void run();
		if (!pollMs) return;
		// Skip the tick while the tab is in the background. These pollers are not
		// cheap any more: listWorkflows() fans out to EVERY site, and office alone
		// is ~146 KB of workflow rows with no server-side pagination, so a
		// forgotten background tab was re-pulling the whole federation on a timer
		// for nothing. Mount and manual refresh are unaffected, and returning to
		// the tab fires the visibilitychange listener below for an immediate
		// catch-up, so the view is never stale on arrival.
		const tick = () => {
			if (typeof document !== "undefined" && document.hidden) return;
			void run();
		};
		const h = window.setInterval(tick, pollMs);
		const onVisible = () => {
			if (typeof document !== "undefined" && !document.hidden) void run();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			window.clearInterval(h);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [run, pollMs]);

	return { data, loading, error, refresh: () => void run() };
}

/**
 * Per-site reachability strip. Render this on EVERY tab.
 *
 * A merged list silently drops the rows of any site that failed to answer, so
 * without this the page shows a shorter list and no reason — indistinguishable
 * from a site that genuinely has nothing. Telling those two apart is the whole
 * purpose of the federator, and `sites[]` is the only thing that carries it.
 */
export function SiteStrip({ sites }: { sites: FmSiteStatus[] }) {
	if (!sites.length) return null;
	const down = sites.filter((s) => !s.ok);
	return (
		<div className="mb-4">
			<div className="flex flex-wrap gap-2">
				{sites.map((s) => (
					<span
						key={s.site}
						title={s.error ? `${s.site}: ${s.error}` : `${s.site}: ${s.count} row(s) in ${s.ms}ms`}
						className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
							s.ok
								? "border-slate-200 bg-white text-slate-700"
								: "border-red-200 bg-red-50 text-red-700"
						}`}
					>
						<span
							className={`inline-block h-1.5 w-1.5 rounded-full ${
								s.ok ? "bg-emerald-500" : "bg-red-500"
							}`}
						/>
						<span className="font-medium">{s.site}</span>
						<span className="text-slate-400">{s.ok ? s.count : "—"}</span>
						{s.ok && <span className="text-slate-300">{s.ms}ms</span>}
					</span>
				))}
			</div>
			{down.length > 0 && (
				<p className="mt-2 text-xs text-red-700">
					{down.length === 1 ? "Site" : "Sites"}{" "}
					<strong>{down.map((d) => d.site).join(", ")}</strong> did not answer — rows below
					are incomplete, not empty. {down[0].error && <em>({down[0].error})</em>}
				</p>
			)}
		</div>
	);
}

/** Relative age with a staleness colour. Nodes/workers heartbeat continuously. */
export function Age({ seconds }: { seconds: number | null }) {
	if (seconds === null) return <span className="text-slate-400">—</span>;
	const tone =
		seconds < 120 ? "text-emerald-600" : seconds < 600 ? "text-amber-600" : "text-red-600";
	const label =
		seconds < 90
			? `${seconds}s`
			: seconds < 5400
				? `${Math.round(seconds / 60)}m`
				: `${Math.round(seconds / 3600)}h`;
	return <span className={tone}>{label} ago</span>;
}

/**
 * "NVIDIA RTX PRO 4000 Blackwell SFF Edition" -> "RTX PRO 4000 Blackwell".
 *
 * The vendor prefix is constant across the fleet and the marketing suffixes ("SFF Edition",
 * "Generation") never distinguish two cards we own. Lives here because fleet-tab and
 * sandboxes-tab each had a byte-identical private copy, and they must agree: the fleet table and
 * the sandbox picker name the SAME cards, so a rule that drifts between them would show one
 * machine under two names.
 *
 * Takes a plain string, not a worker or a profile — the two callers hold different shapes
 * (`FmWorker.hardware.gpu.devices[].name` vs `GpuProfile.model`) and only the string is common.
 */
export function shortGpu(name: string): string {
	return name
		.replace(/^NVIDIA\s+/i, "")
		.replace(/\s+(SFF\s+)?Edition$/i, "")
		.replace(/\s+Generation$/i, "")
		.replace(/^GeForce\s+/i, "")
		.trim();
}

export function SiteBadge({ site }: { site?: string }) {
	if (!site) return <span className="text-slate-400">—</span>;
	return (
		<span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
			{site}
		</span>
	);
}

export function StatusPill({ status }: { status: string }) {
	const s = status.toUpperCase();
	const tone =
		s === "IDLE" || s === "DONE"
			? "bg-emerald-50 text-emerald-700 border-emerald-200"
			: s === "BUSY" || s === "DISPATCHED" || s === "RUNNING"
				? "bg-blue-50 text-blue-700 border-blue-200"
				: s === "PENDING" || s === "STARTING"
					? "bg-amber-50 text-amber-700 border-amber-200"
					: s === "FAILED"
						? "bg-red-50 text-red-700 border-red-200"
						: "bg-slate-50 text-slate-600 border-slate-200";
	return <span className={`rounded border px-1.5 py-0.5 text-xs ${tone}`}>{s}</span>;
}

// `title` is OPTIONAL and the fm tabs deliberately omit it. Every one of them
// renders inside AdminSectionLayout, which already prints the section <h1> and a
// tab bar that names+highlights the current tab — so a per-tab <h2> repeating that
// label stacked TWO headings and TWO description paragraphs on every page
// ("Infrastructure" over "Sites", each with its own blurb). The rest of the admin
// tree never does this: admin-users.tsx and admin-audit.tsx render no heading at
// all and rely on the section header. Keep it that way; the subtitle carries the
// real information (refresh cadence, data caveats) and survives on its own line.
export function TabShell({
	title,
	subtitle,
	loading,
	error,
	onRefresh,
	children,
}: {
	title?: string;
	subtitle?: string;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	children: React.ReactNode;
}) {
	return (
		<section>
			<div className="mb-4 flex items-start justify-between gap-4">
				<div>
					{title && <h2 className="text-lg font-semibold text-slate-900">{title}</h2>}
					{subtitle && (
						<p className={`text-sm text-slate-600 ${title ? "mt-0.5" : ""}`}>{subtitle}</p>
					)}
				</div>
				<button
					onClick={onRefresh}
					disabled={loading}
					className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
				>
					{loading ? "Refreshing…" : "Refresh"}
				</button>
			</div>
			{error && (
				<div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{error}
				</div>
			)}
			{children}
		</section>
	);
}
