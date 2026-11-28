// Shared plumbing for the lum.id/fm dashboard tabs.
//
// Every tab needs the same three things: fetch a merged fan-out, show which
// sites answered, and re-fetch on demand. The site strip in particular is not
// decoration — see SiteStrip below.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isSessionExpired } from "../../api/client";
import type { FmFanout, FmSiteStatus } from "../../api/fm";
import { answerTime, siteAnswerTitle } from "../../lib/fleet-view";

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
						title={siteAnswerTitle(s)}
						className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
							s.ok
								? "border-ink-200 bg-card text-ink-700"
								: "border-brick-200 bg-brick-50 text-brick-700"
						}`}
					>
						<span
							className={`inline-block h-1.5 w-1.5 rounded-full ${
								s.ok ? "bg-gold-500" : "bg-brick-500"
							}`}
						/>
						<span className="font-medium">{s.site}</span>
						<span className="text-ink-600">{s.ok ? s.count : "—"}</span>
						{s.ok && <span className="text-ink-600">· {answerTime(s.ms)}</span>}
					</span>
				))}
			</div>
			{down.length > 0 && (
				<p className="mt-2 text-xs text-brick-700">
					{down.length === 1 ? "Site" : "Sites"}{" "}
					<strong>{down.map((d) => d.site).join(", ")}</strong> did not answer — rows below
					are incomplete, not empty.
				</p>
			)}
		</div>
	);
}

/** Relative age with a staleness colour. Nodes/workers heartbeat continuously. */
export function Age({ seconds }: { seconds: number | null }) {
	if (seconds === null) return <span className="text-ink-600">—</span>;
	const tone =
		seconds < 120 ? "text-gold-700" : seconds < 600 ? "text-ember-600" : "text-brick-600";
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
	if (!site) return <span className="text-ink-600">—</span>;
	return (
		<span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-700">
			{site}
		</span>
	);
}

export function StatusPill({ status, label }: { status: string; /** Plain words to show instead of the raw status. */ label?: string }) {
	const s = status.toUpperCase();
	const tone =
		s === "IDLE" || s === "DONE"
			? "bg-gold-50 text-gold-700 border-gold-200"
			: s === "BUSY" || s === "DISPATCHED" || s === "RUNNING"
				? "bg-lagoon-50 text-lagoon-700 border-lagoon-200"
				: s === "PENDING" || s === "STARTING"
					? "bg-ember-50 text-ember-700 border-ember-200"
					: s === "FAILED"
						? "bg-brick-50 text-brick-700 border-brick-200"
						: "bg-ink-50 text-ink-600 border-ink-200";
	return <span className={`rounded border px-1.5 py-0.5 text-xs ${tone}`} title={label ? s : undefined}>{label ?? s}</span>;
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
					{title && <h2 className="text-title font-semibold text-ink-900">{title}</h2>}
					{subtitle && (
						<p className={`text-sm text-ink-600 ${title ? "mt-0.5" : ""}`}>{subtitle}</p>
					)}
				</div>
				<button
					onClick={onRefresh}
					disabled={loading}
					className="rounded-md border border-ink-200 bg-card px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50"
				>
					{loading ? "Refreshing…" : "Refresh"}
				</button>
			</div>
			{error && (
				<div className="mb-4 rounded-md border border-brick-200 bg-brick-50 px-3 py-2 text-sm text-brick-700">
					{error}
				</div>
			)}
			{children}
		</section>
	);
}
