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

import { NavLink, Outlet } from "react-router-dom";
import { Store, Puzzle, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
	{ to: "/studio/library/marketplace", label: "Marketplace", icon: Store },
	{ to: "/studio/library/skills", label: "Skills", icon: Puzzle },
	{ to: "/studio/library/experiments", label: "Experiments", icon: FlaskConical },
];

export default function StudioLibraryTabs() {
	return (
		<div className="flex flex-1 min-h-0 h-full">
			{/* Tabbed library content — full width now the chat panel is gone. */}
			<div className="flex-1 min-w-0 flex flex-col">
				<div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
					<div className="space-y-4 max-w-5xl">
						<div className="flex items-center gap-1.5">
							{TABS.map(({ to, label, icon: Icon }) => (
								<NavLink
									key={to}
									to={to}
									className={({ isActive }) =>
										cn(
											"inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border transition-colors",
											isActive
												? "border-gold-300 bg-gold-50 text-gold-900"
												: "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
										)
									}
								>
									<Icon className="w-3.5 h-3.5" />
									{label}
								</NavLink>
							))}
						</div>
						<Outlet />
					</div>
				</div>
			</div>

		</div>
	);
}
