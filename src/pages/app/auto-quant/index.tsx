// /app/auto-quant/index.tsx — Theme I strategy-grid-first operator page.
//
// Route: /dashboard/auto-quant
//
// Three tabs:
//   Strategies (default) — grid of strategy cards with lifecycle badges,
//                          30-cycle sparklines, and Promote buttons.
//   Loops                — table of loops with outcome columns.
//   Budget               — daily LLM spend projection vs xpcloud.yaml cap.
//
// Auth: lm_session cookie (AuthGuard at route level).

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw, Zap, Activity, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LoopRow } from "@/api/super-admin";
import type { StrategyState } from "@/api/super-admin";
import {
	fetchAutoQuantLoops,
	fetchAutoQuantStrategies,
	deriveBudget,
} from "./api";
import { StrategyGrid } from "./strategy-grid";
import { LoopsTable } from "./loops-table";
import { BudgetPanel } from "./budget-panel";

type Tab = "strategies" | "loops" | "budget";

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
	{ id: "strategies", label: "Strategies", icon: <Zap className="w-3.5 h-3.5" /> },
	{ id: "loops",      label: "Loops",      icon: <Activity className="w-3.5 h-3.5" /> },
	{ id: "budget",     label: "Budget",     icon: <DollarSign className="w-3.5 h-3.5" /> },
];

export default function AutoQuantPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const activeTab = (searchParams.get("tab") as Tab) || "strategies";
	const [loops, setLoops] = useState<LoopRow[]>([]);
	const [strategies, setStrategies] = useState<StrategyState[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const cancelRef = useRef(false);

	const load = async (silent = false) => {
		if (!silent) setLoading(true);
		cancelRef.current = false;
		try {
			const [ls, ss] = await Promise.all([
				fetchAutoQuantLoops(),
				fetchAutoQuantStrategies(),
			]);
			if (cancelRef.current) return;
			setLoops(ls);
			setStrategies(ss);
			setError(null);
		} catch (e) {
			if (!cancelRef.current) setError(String(e));
		} finally {
			if (!cancelRef.current) setLoading(false);
		}
	};

	useEffect(() => {
		load();
		return () => { cancelRef.current = true; };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });

	const handlePromote = (name: string, toStage: string) => {
		// Wave 3: POST to /api/v1/auto-quant/strategy/:name/promote { stage }
		toast.info(`Promote "${name}" → ${toStage.replace("_", " ")} — CLI command: /lumid app auto-quant cycle promote_${name}`);
	};

	const budget = deriveBudget(loops);
	const ok = loops.filter((l) => l.status === "ok").length;
	const failing = loops.filter((l) => l.status === "failing").length;

	return (
		<div className="max-w-6xl mx-auto p-6 space-y-5">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
						<Zap className="w-6 h-6 text-indigo-500" />
						Auto-Quant
					</h1>
					<p className="text-sm text-muted-foreground mt-0.5">
						Automated trading research. Loops run on a schedule; strategies evolve through paper → semi → live.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{/* Status summary pills */}
					{!loading && (
						<>
							{ok > 0 && (
								<span className="text-xs px-2 py-0.5 rounded-full bg-gold-50 text-gold-700 border border-gold-200">
									{ok} loop{ok === 1 ? "" : "s"} ok
								</span>
							)}
							{failing > 0 && (
								<span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
									{failing} failing
								</span>
							)}
						</>
					)}
					<Link
						to="/dashboard/inbox?app=auto-quant"
						className="text-xs text-indigo-600 hover:underline"
					>
						Inbox →
					</Link>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => load(true)}
						disabled={loading}
						className="h-8 px-2"
					>
						<RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
					</Button>
				</div>
			</div>

			{/* Error */}
			{error && (
				<div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
					{error}
				</div>
			)}

			{/* Tab strip */}
			<div className="flex gap-0 border-b border-gray-200">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
							activeTab === t.id
								? "border-indigo-500 text-indigo-700"
								: "border-transparent text-muted-foreground hover:text-gray-700 hover:border-gray-300"
						}`}
					>
						{t.icon}
						{t.label}
						{t.id === "strategies" && strategies.length > 0 && (
							<span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
								{strategies.length}
							</span>
						)}
						{t.id === "loops" && loops.length > 0 && (
							<span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
								{loops.length}
							</span>
						)}
					</button>
				))}
			</div>

			{/* Tab content */}
			{loading ? (
				<div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
			) : (
				<>
					{activeTab === "strategies" && (
						<StrategyGrid
							strategies={strategies}
							onPromote={handlePromote}
						/>
					)}
					{activeTab === "loops" && (
						<LoopsTable loops={loops} />
					)}
					{activeTab === "budget" && (
						<BudgetPanel budget={budget} />
					)}
				</>
			)}
		</div>
	);
}
