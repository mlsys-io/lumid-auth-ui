// /studio/data — a first-party SYSTEM app (like Library), not a marketplace
// install. One quiet "Data" destination with four tabs:
//   • Catalog  — the federated data-lake viewer (schemas/tables/samples/
//                lineage/freshness across findata, lumid-data, lqt-data).
//   (FinData's Polymarket + Kalshi browser lives INSIDE the Catalog, under
//    FinData — `?view=markets`. It was a tab here, which made one dataset read
//    as a feature of the whole warehouse; `?tab=markets` still redirects.)
//   • Explorer — the generic data-app endpoint browser (point at any
//                allowlisted data-app, run its declared endpoints).
//   • Query    — ad-hoc SELECT through the same path chat's data_query uses.
//   (Jobs — the lum.id/data jobs entrance — is reachable at ?tab=jobs but not
//    a tab: people meet data at workflow setup, results and inspection.)
// …plus a docked chat rail, grounded on DATA_KEY.
//
// Both were previously separate marketplace cards (lumid-data-lake +
// lumid-data-explorer) that overlapped in purpose and confused users; folded
// into one built-in surface. Rendering the native components directly (no
// /me/apps/:app/ui round-trip) is also faster and sidesteps the installed-app
// cross-node surface path entirely.
//
// The chat was the last thing lumid-data-lake still had that this page didn't,
// and the reason that app outlived the fold — browsing a catalog and asking a
// question about it are one workflow, and they were split across a built-in
// page and a marketplace card with the same two tabs. The rail closes that: the
// app is retired, and its opener + chips now live in StudioChat's DATA_KEY
// branch. A rail beside the tabs, NOT a fourth tab, so the catalog you're
// asking about stays on screen while you ask.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Database, Sparkles, TableProperties } from "lucide-react";
import ChatRail from "@/components/ChatRail";
import RunningNow from "@/components/RunningNow";
import { DATA_KEY } from "@/components/StudioChat";
import { cn } from "@/lib/utils";

const DataLakeViewer = lazy(() => import("@/components/app-surface/DataLakeViewer"));
const DataAppBrowser = lazy(() => import("@/components/app-surface/DataAppBrowser"));
const AskData = lazy(() => import("@/components/app-surface/AskData"));
const DataJobs = lazy(() => import("@/components/app-surface/DataJobs"));

type Tab = "catalog" | "explorer" | "query" | "jobs";
const TAB_IDS: Tab[] = ["catalog", "explorer", "query", "jobs"];
const TABS: { id: Tab; label: string; icon: typeof Database }[] = [
	{ id: "catalog", label: "Catalog", icon: Database },
	// Query runs ad-hoc SELECT through the same path chat's data_query uses.
	// After Catalog on purpose: Catalog is how you find out what to query.
	// "Ask" since 2026-11-25: a question in plain words, answered by the chosen
	// store's data agent (AskData). The SQL console is folded inside it.
	{ id: "query", label: "Ask", icon: Sparkles },
	// No Jobs tab: people meet data when they set up a workflow, harvest its
	// results, or inspect what's there — not by writing job specs. `?tab=jobs`
	// still renders (old links), it just isn't advertised.
	// The raw data-app endpoint browser. Last and labelled as such: it lists
	// HTTP routes, not datasets, and read as a second catalog when it sat
	// second.
	{ id: "explorer", label: "API endpoints", icon: TableProperties },
];

// Its own open/closed preference, so hiding the chat on an app workspace
// doesn't also hide it here. The rail WIDTH is shared (see ChatRail) — one drag
// should set the rail width everywhere.
const CHAT_OPEN_KEY = "studio_data_chat_open";

export default function StudioData() {
	// `?tab=` and `?job=` are URL state so a run row can link straight to one
	// job. Catalog stays the default and leaves the URL clean.
	const [params, setParams] = useSearchParams();
	const fromUrl = params.get("tab") as Tab | null;
	const tab: Tab = fromUrl && TAB_IDS.includes(fromUrl) ? fromUrl : "catalog";
	const jobId = tab === "jobs" ? params.get("job") : null;
	const source = tab === "jobs" ? params.get("source") : null;
	// Old links to the Prediction markets tab land on its new home in the Catalog.
	const rawTab = params.get("tab");
	useEffect(() => {
		if (rawTab !== "markets") return;
		const sp = new URLSearchParams(params);
		sp.delete("tab");
		sp.set("view", "markets");
		setParams(sp, { replace: true });
	}, [rawTab, params, setParams]);
	const clearSource = () => {
		const sp = new URLSearchParams(params);
		sp.delete("source");
		setParams(sp, { replace: true });
	};
	// Mount a tab's component only once first opened, then keep it mounted
	// (hidden) so switching back is instant and its state/cache survive.
	const [seen, setSeen] = useState<Set<Tab>>(() => new Set<Tab>([tab]));
	const open = (id: Tab) => {
		const sp = new URLSearchParams(params);
		if (id === "catalog") sp.delete("tab"); else sp.set("tab", id);
		if (id !== "jobs") sp.delete("job");
		setParams(sp, { replace: true });
		setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
	};
	const setJob = (id: string | null) => {
		const sp = new URLSearchParams(params);
		sp.set("tab", "jobs");
		if (id) sp.set("job", id); else sp.delete("job");
		setParams(sp, { replace: !id });
	};
	// A tab opened by URL (back/forward, a link) mounts too, and on a narrow
	// screen its label scrolls into view (the strip scrolls sideways).
	const tablist = useRef<HTMLDivElement>(null);
	useEffect(() => {
		setSeen((s) => (s.has(tab) ? s : new Set(s).add(tab)));
		tablist.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [tab]);
	return (
		<div className="flex flex-1 min-h-0 h-full">
			{/* LEFT — tabs + the surface they select. */}
			<div className="flex-1 min-w-0 flex flex-col min-h-0 border-r border-border px-4 py-5 sm:px-6 sm:py-6">
				{/* Lumen: underline tabs, the same as the Library — these switch
				    VIEWS, so they read as navigation, not as a row of buttons. */}
				<div ref={tablist} role="tablist" aria-label="Data views" className="flex items-center gap-6 mb-5 border-b border-border overflow-x-auto">
					{TABS.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							role="tab"
							aria-selected={tab === id}
							onClick={() => open(id)}
							className={cn(
								"relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 text-body font-medium transition-colors duration-180",
								tab === id
									? "border-gold-500 text-ink-900"
									: "border-transparent text-ink-600 hover:text-ink-900 hover:border-ink-300",
							)}
						>
							<Icon className="w-4 h-4" />
							{label}
						</button>
					))}
				</div>
				<div className="flex-1 min-h-0">
					<Suspense fallback={<div className="lumen-skeleton h-64 rounded-xl" role="status" aria-label="Loading" />}>
						{/* All stay MOUNTED across tab switches (hidden, not unmounted) so
						    each keeps its loaded catalog + the session cache stays warm. */}
						<div className={tab === "catalog" ? "h-full" : "hidden"}>
							{seen.has("catalog") && <DataLakeViewer config={{ title: "Data Warehouse" }} />}
						</div>
						<div className={tab === "explorer" ? "h-full" : "hidden"}>
							{seen.has("explorer") && <DataAppBrowser config={{ data_app: "findata", data_app_label: "FinData" }} />}
						</div>
						<div className={tab === "query" ? "h-full" : "hidden"}>
							{seen.has("query") && <AskData />}
						</div>
						<div className={tab === "jobs" ? "h-full" : "hidden"}>
							{seen.has("jobs") && <DataJobs jobId={jobId} onJobChange={setJob} initialSource={source} onSourceUsed={clearSource} />}
						</div>
					</Suspense>
				</div>
			</div>

			{/* RIGHT — grounded chat (collapsible; auto-hidden on narrow, where it
			    takes over full width when opened). Same rail as the app workspace. */}
			<ChatRail groundApp={DATA_KEY} openKey={CHAT_OPEN_KEY} top={<RunningNow />} />
		</div>
	);
}
