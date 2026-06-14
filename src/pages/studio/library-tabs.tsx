// /studio/library — one quiet destination for everything you can pull
// in or inspect as a building block: Marketplace (apps), Skills, and
// Experiments live here as tabs instead of three top-level nav entries
// (operator feedback 2026-06-12: "left nav too many — consolidate").
//
// Old top-level routes (/studio/marketplace, /studio/skills,
// /studio/experiments) redirect into the tabs so deep links and chat
// links keep working.

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
		<div className="space-y-4">
			<div className="flex items-center gap-1.5">
				{TABS.map(({ to, label, icon: Icon }) => (
					<NavLink
						key={to}
						to={to}
						className={({ isActive }) =>
							cn(
								"inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border transition-colors",
								isActive
									? "border-amber-300 bg-amber-50 text-amber-900"
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
	);
}
