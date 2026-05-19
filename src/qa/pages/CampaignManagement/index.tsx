import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	ArrowDown,
	ArrowUp,
	ChevronLeft,
	ChevronRight,
	Megaphone,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
	listCompetitions,
	updateCompetitionWithCampaign,
	type CampaignFields,
	type CompetitionItem,
	type CreateCompetitionRequest,
} from "@/api/qa-admin";

import CampaignDialog from "./campaign-dialog";

const PAGE_SIZE = 20;

const STATUS_COLORS: Record<string, string> = {
	active: "bg-green-100 text-green-800 border-green-200",
	draft: "bg-yellow-100 text-yellow-800 border-yellow-200",
	ended: "bg-gray-100 text-gray-600 border-gray-200",
};

const TYPE_LABELS: Record<string, string> = {
	battle: "Battle",
	prediction: "Prediction",
	championship: "Championship",
	challenge: "Challenge",
};

export default function CampaignManagement() {
	const [competitions, setCompetitions] = useState<CompetitionItem[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);

	// null = closed, defined = editing/creating for that competition
	const [dialogTarget, setDialogTarget] = useState<{
		competition: CompetitionItem;
		campaign: CampaignFields | null;
	} | null>(null);

	const [removeTarget, setRemoveTarget] = useState<CompetitionItem | null>(null);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	async function refresh() {
		setLoading(true);
		try {
			const r = await listCompetitions({ page, page_size: PAGE_SIZE });
			setCompetitions(r.data?.competitions || []);
			setTotal(r.total || 0);
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Failed to load competitions");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page]);

	function compToRequest(c: CompetitionItem): CreateCompetitionRequest {
		return {
			name: c.name,
			market_id: c.market_id,
			initial_funding: c.initial_funding,
			trading_fees: c.trading_fees,
			start_time: c.start_time,
			end_time: c.end_time,
		};
	}

	async function handleSave(competition: CompetitionItem, campaign: CampaignFields) {
		try {
			await updateCompetitionWithCampaign(competition.id, {
				competition: compToRequest(competition),
				campaign,
				remove_campaign: false,
			});
			toast.success("Campaign saved");
			setDialogTarget(null);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Save failed");
		}
	}

	async function handleMove(competition: CompetitionItem, direction: "up" | "down") {
		const sorted = [...withCampaign].sort(
			(a, b) => (a.campaign!.sort_order - b.campaign!.sort_order) || (a.id - b.id)
		);
		const idx = sorted.findIndex((c) => c.id === competition.id);
		const swapIdx = direction === "up" ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= sorted.length) return;

		const a = sorted[idx];
		const b = sorted[swapIdx];
		try {
			await Promise.all([
				updateCompetitionWithCampaign(a.id, {
					competition: compToRequest(a),
					campaign: { ...a.campaign!, sort_order: swapIdx },
				}),
				updateCompetitionWithCampaign(b.id, {
					competition: compToRequest(b),
					campaign: { ...b.campaign!, sort_order: idx },
				}),
			]);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Reorder failed");
		}
	}

	async function handleRemove(competition: CompetitionItem) {
		try {
			await updateCompetitionWithCampaign(competition.id, {
				competition: compToRequest(competition),
				campaign: null,
				remove_campaign: true,
			});
			toast.success("Campaign removed");
			setRemoveTarget(null);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Remove failed");
		}
	}

	const withCampaign = competitions.filter((c) => c.campaign);
	const withoutCampaign = competitions.filter((c) => !c.campaign);

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<Megaphone className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Campaign management</h1>
			</header>

			{/* Active campaigns */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm mb-6">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{withCampaign.length === 0
									? "No campaigns"
									: `${withCampaign.length} active campaign${withCampaign.length === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Competitions with a featured display card on the dashboard.
							</CardDescription>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={refresh}
							disabled={loading}
						>
							<RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
							Refresh
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{loading && competitions.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : withCampaign.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No campaigns yet. Add one by clicking{" "}
							<strong>Add campaign</strong> next to a competition below.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium w-6">Order</th>
										<th className="text-left py-2 px-2 font-medium">Competition</th>
										<th className="text-left py-2 px-2 font-medium">Campaign title</th>
										<th className="text-left py-2 px-2 font-medium">Type</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-center py-2 px-2 font-medium">Featured</th>
										<th className="text-right py-2 px-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{[...withCampaign]
										.sort((a, b) => (a.campaign!.sort_order - b.campaign!.sort_order) || (a.id - b.id))
										.map((c, i, arr) => (
										<tr key={c.id} className="border-b last:border-0">
											<td className="py-2 px-2">
												<div className="flex flex-col gap-0.5">
													<Button
														variant="ghost"
														size="sm"
														className="h-5 w-5 p-0"
														disabled={i === 0}
														onClick={() => handleMove(c, "up")}
														title="Move up"
													>
														<ArrowUp className="w-3 h-3" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														className="h-5 w-5 p-0"
														disabled={i === arr.length - 1}
														onClick={() => handleMove(c, "down")}
														title="Move down"
													>
														<ArrowDown className="w-3 h-3" />
													</Button>
												</div>
											</td>
											<td className="py-2 px-2 text-muted-foreground max-w-[160px] truncate">
												{c.name}
											</td>
											<td className="py-2 px-2 font-medium max-w-[200px] truncate">
												{c.campaign!.title}
											</td>
											<td className="py-2 px-2">
												<span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs border bg-indigo-50 text-indigo-700 border-indigo-200">
													{TYPE_LABELS[c.campaign!.type] ?? c.campaign!.type}
												</span>
											</td>
											<td className="py-2 px-2">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														STATUS_COLORS[c.campaign!.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
													)}
												>
													{c.campaign!.status}
												</span>
											</td>
											<td className="py-2 px-2 text-center">
												{c.campaign!.featured ? (
													<span className="text-yellow-500 text-xs font-medium">★ Yes</span>
												) : (
													<span className="text-gray-400 text-xs">—</span>
												)}
											</td>
											<td className="py-2 px-2 text-right">
												<div className="inline-flex items-center gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() =>
															setDialogTarget({ competition: c, campaign: c.campaign! })
														}
														title="Edit campaign"
													>
														<Pencil className="w-4 h-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setRemoveTarget(c)}
														title="Remove campaign"
													>
														<Trash2 className="w-4 h-4 text-destructive" />
													</Button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Competitions without a campaign */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base">Competitions without a campaign</CardTitle>
					<CardDescription>
						Add a featured display card to any of these competitions.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{loading && competitions.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : withoutCampaign.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							All competitions have a campaign linked.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Competition</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-right py-2 px-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{withoutCampaign.map((c) => (
										<tr key={c.id} className="border-b last:border-0">
											<td className="py-2 px-2 font-medium">{c.name}</td>
											<td className="py-2 px-2">
												<span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs border bg-gray-100 text-gray-600 border-gray-200">
													{c.status}
												</span>
											</td>
											<td className="py-2 px-2 text-right">
												<Button
													variant="outline"
													size="sm"
													className="gap-1"
													onClick={() =>
														setDialogTarget({ competition: c, campaign: null })
													}
												>
													<Plus className="w-3 h-3" />
													Add campaign
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{totalPages > 1 && (
						<div className="flex items-center justify-between mt-4 text-sm">
							<span className="text-muted-foreground">
								Page {page} of {totalPages}
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPage((p) => Math.max(1, p - 1))}
								>
									<ChevronLeft className="w-4 h-4" />
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								>
									<ChevronRight className="w-4 h-4" />
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{dialogTarget && (
				<CampaignDialog
					open={!!dialogTarget}
					onOpenChange={(v) => !v && setDialogTarget(null)}
					competitionName={dialogTarget.competition.name}
					initial={dialogTarget.campaign}
					onSave={(campaign) => handleSave(dialogTarget.competition, campaign)}
				/>
			)}

			<AlertDialog
				open={!!removeTarget}
				onOpenChange={(v) => !v && setRemoveTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove campaign?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the featured display card for{" "}
							<strong>{removeTarget?.name}</strong>. The competition itself is
							not affected.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => removeTarget && handleRemove(removeTarget)}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
