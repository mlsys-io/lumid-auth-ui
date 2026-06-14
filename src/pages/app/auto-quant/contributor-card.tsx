// contributor-card.tsx — Theme H: community signals for a forked strategy.
//
// Shows stars/forks/track-records from xp.io for any strategy repo that
// was forked from an upstream. Linking back to the upstream encourages
// the share→discover→fork→credit cycle.

import { Star, GitFork, BarChart2, ExternalLink } from "lucide-react";

export interface ContributorCardProps {
	/** The upstream slug on xp.io (e.g. "a3f48236-…/strategy-momentum"). */
	upstream_slug?: string;
	stars?: number;
	forks?: number;
	track_records?: number;
	/** When the strategy was forked locally. */
	forked_at?: string;
}

export function ContributorCard({
	upstream_slug,
	stars = 0,
	forks = 0,
	track_records = 0,
	forked_at,
}: ContributorCardProps) {
	if (!upstream_slug) return null;

	const upstreamUrl = `https://xp.io/${upstream_slug}`;
	const fmtDate = (iso?: string) => {
		if (!iso) return null;
		return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
	};

	return (
		<div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-xs">
			<div className="flex items-center gap-1.5 text-indigo-700 font-medium mb-2">
				<GitFork className="w-3.5 h-3.5" />
				Forked strategy
				{forked_at && (
					<span className="text-indigo-400 font-normal">(forked {fmtDate(forked_at)})</span>
				)}
			</div>
			<div className="flex items-center gap-4 text-gray-600 mb-2">
				<span className="flex items-center gap-1">
					<Star className="w-3 h-3 text-gold-400" />
					{stars} star{stars === 1 ? "" : "s"}
				</span>
				<span className="flex items-center gap-1">
					<GitFork className="w-3 h-3 text-gray-400" />
					{forks} fork{forks === 1 ? "" : "s"}
				</span>
				<span className="flex items-center gap-1">
					<BarChart2 className="w-3 h-3 text-indigo-400" />
					{track_records} track record{track_records === 1 ? "" : "s"}
				</span>
			</div>
			<a
				href={upstreamUrl}
				target="_blank"
				rel="noreferrer"
				className="inline-flex items-center gap-1 text-indigo-600 hover:underline text-[11px]"
			>
				View upstream on xp.io
				<ExternalLink className="w-3 h-3" />
			</a>
		</div>
	);
}
