// /studio/library — one quiet destination for everything you can pull
// in or inspect as a building block: Marketplace (apps), Skills, and
// Experiments live here as tabs instead of three top-level nav entries
// (operator feedback 2026-06-12: "left nav too many — consolidate").
//
// Old top-level routes (/studio/marketplace, /studio/skills,
// /studio/experiments) redirect into the tabs so deep links and chat
// links keep working.
//
// The Library is browsing, not conversation — its docked chat was removed
// on 2026-08-10. The chat lives on /studio and inside app workspaces; here
// it only competed with the content for width.
//
// Lumen (2026-11): the page owns its title (PageHeader, serif) and the three
// sections are underline tabs under it — the top strip no longer repeats
// "Library" (TopStatusStrip ownHeader), and the bordered pill row is gone.
//
// The heading says "Marketplace", the sidebar row's name (operator's naming,
// 2026-09-13), and the first tab is "Apps" (Apps · Skills · Studies). URLs
// keep their /studio/library/* shape so old links still work.

import { Outlet, useLocation } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { PageContainer } from "@/components/ui/page-container";

const TABS = [
	{ to: "/studio/library/marketplace", label: "Apps" },
	{ to: "/studio/library/skills", label: "Skills" },
	{ to: "/studio/library/experiments", label: "Studies" },
];

const SUBTITLE: Record<string, string> = {
	marketplace: "Apps, workflows, memory and datasets others have published — add one in a click.",
	skills: "The capabilities your agents import — health, versions, who uses what.",
	experiments: "Hypotheses your agents are testing, across every agent.",
};

export default function StudioLibraryTabs() {
	const { pathname } = useLocation();
	const section = pathname.split("/")[3] || "marketplace";
	return (
		<div className="flex flex-1 min-h-0 h-full">
			<div className="flex-1 min-w-0 overflow-y-auto">
				<PageContainer>
					<PageHeader title="Marketplace" subtitle={SUBTITLE[section] ?? SUBTITLE.marketplace} tabs={TABS} />
					<div className="pt-6">
						<Outlet />
					</div>
				</PageContainer>
			</div>
		</div>
	);
}
