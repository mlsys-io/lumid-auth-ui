import { NavLink, Outlet } from "react-router-dom";

type Tab = { to: string; label: string; end?: boolean };

type Props = {
	/** Title shown at the top of the section. */
	title: string;
	/** One-line description under the title. Optional. */
	subtitle?: string;
	/** Ordered tab list — first entry usually has `end: true` so the
	 *  index route doesn't stay highlighted when a child is open.
	 *  Omit for a header-only wrapper (title + subtitle, no tab strip). */
	tabs?: Tab[];
};

/**
 * Shared layout for consolidated admin sections (Users / Infrastructure /
 * Runmesh ops / QuantArena). Renders a title + tab bar + the active child
 * via <Outlet />. URLs are unchanged; the layout is a pathless wrapper
 * route, so deep links into individual admin pages still work.
 */
export default function AdminSectionLayout({ title, subtitle, tabs }: Props) {
	return (
		<div>
			<header className="mb-5">
				<h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
				{subtitle && (
					<p className="mt-1 text-sm text-slate-600">{subtitle}</p>
				)}
			</header>
			{tabs && tabs.length > 0 && (
			<div className="mb-6 border-b border-slate-200 flex gap-5 overflow-x-auto">
				{tabs.map((t) => (
					<NavLink
						key={t.to}
						to={t.to}
						end={t.end}
						className={({ isActive }) =>
							`pb-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
								isActive
									? "text-slate-900 border-indigo-500 font-medium"
									: "text-slate-500 border-transparent hover:text-slate-800"
							}`
						}
					>
						{t.label}
					</NavLink>
				))}
			</div>
			)}
			<Outlet />
		</div>
	);
}
