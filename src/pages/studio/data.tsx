// /studio/data — a first-party SYSTEM app (like Library), not a marketplace
// install. One quiet "Data" destination with two tabs:
//   • Catalog  — the federated data-lake viewer (schemas/tables/samples/
//                lineage/freshness across findata, lumid-data, lqt-data).
//   • Explorer — the generic data-app endpoint browser (point at any
//                allowlisted data-app, run its declared endpoints).
//
// Both were previously separate marketplace cards (lumid-data-lake +
// lumid-data-explorer) that overlapped in purpose and confused users; folded
// into one built-in surface. Rendering the native components directly (no
// /me/apps/:app/ui round-trip) is also faster and sidesteps the installed-app
// cross-node surface path entirely.

import { lazy, Suspense, useState } from "react";
import { Database, TableProperties, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

const DataLakeViewer = lazy(() => import("@/components/app-surface/DataLakeViewer"));
const DataAppBrowser = lazy(() => import("@/components/app-surface/DataAppBrowser"));
const SqlConsole = lazy(() => import("@/components/app-surface/SqlConsole"));

type Tab = "catalog" | "explorer" | "query";
const TABS: { id: Tab; label: string; icon: typeof Database }[] = [
	{ id: "catalog", label: "Catalog", icon: Database },
	{ id: "explorer", label: "Explorer", icon: TableProperties },
	// Query runs ad-hoc SELECT through the same path chat's data_query uses.
	// Last in the row on purpose: Catalog is how you find out what to query.
	{ id: "query", label: "Query", icon: Terminal },
];

export default function StudioData() {
	const [tab, setTab] = useState<Tab>("catalog");
	// Mount a tab's component only once first opened, then keep it mounted
	// (hidden) so switching back is instant and its state/cache survive.
	const [seen, setSeen] = useState<Set<Tab>>(() => new Set<Tab>(["catalog"]));
	const open = (id: Tab) => {
		setTab(id);
		setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
	};
	return (
		<div className="flex flex-col flex-1 min-h-0 h-full px-6 py-6">
			<div className="flex items-center gap-1.5 mb-4">
				{TABS.map(({ id, label, icon: Icon }) => (
					<button
						key={id}
						onClick={() => open(id)}
						className={cn(
							"inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border transition-colors",
							tab === id
								? "border-gold-300 bg-gold-50 text-gold-900"
								: "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
						)}
					>
						<Icon className="w-3.5 h-3.5" />
						{label}
					</button>
				))}
			</div>
			<div className="flex-1 min-h-0">
				<Suspense fallback={<div className="text-sm text-muted-foreground px-1 py-2">Loading…</div>}>
					{/* Both stay MOUNTED across tab switches (hidden, not unmounted) so
					    each keeps its loaded catalog + the session cache stays warm. */}
					<div className={tab === "catalog" ? "h-full" : "hidden"}>
						{seen.has("catalog") && <DataLakeViewer config={{ title: "Data" }} />}
					</div>
					<div className={tab === "explorer" ? "h-full" : "hidden"}>
						{seen.has("explorer") && <DataAppBrowser config={{ data_app: "findata", data_app_label: "FinData" }} />}
					</div>
					<div className={tab === "query" ? "h-full" : "hidden"}>
						{seen.has("query") && <SqlConsole />}
					</div>
				</Suspense>
			</div>
		</div>
	);
}
