import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	ChevronLeft,
	ChevronRight,
	Eye,
	Pencil,
	Plus,
	RefreshCw,
	Sparkles,
	Star,
	Trash2,
	Trophy,
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
import { cn, formatCurrency, formatTimestampToDateHour } from "@/lib/utils";
import {
	createCompetition,
	deleteCompetition,
	listCompetitions,
	setCompetitionFeatured,
	setCompetitionShowcase,
	updateCompetition,
	updateCompetitionWithCampaign,
	type CompetitionItem,
} from "@/api/qa-admin";

import EditCompetitionDialog, {
	type EditCompetitionInfo,
	type EditCompetitionSubmit,
} from "./edit-dialog";

const PAGE_SIZE = 20;

function statusBadge(status: string): string {
	switch (status) {
		case "Ongoing":
			return "bg-green-100 text-green-800 border-green-200";
		case "Upcoming":
			return "bg-blue-100 text-blue-800 border-blue-200";
		case "Completed":
			return "bg-gray-100 text-gray-800 border-gray-200";
		default:
			return "bg-gray-100 text-gray-800 border-gray-200";
	}
}

export default function CompetitionManagement() {
	const [competitions, setCompetitions] = useState<CompetitionItem[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);

	const [editOpen, setEditOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<EditCompetitionInfo | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<CompetitionItem | null>(null);

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

	async function handleSubmit(data: EditCompetitionSubmit) {
		try {
			const { id, campaignEnabled, campaign, removeCampaign, ...compFields } =
				data;
			if (!id) {
				await createCompetition(compFields);
				toast.success("Competition created");
			} else if (campaignEnabled || removeCampaign) {
				await updateCompetitionWithCampaign(id, {
					competition: compFields,
					campaign: campaignEnabled ? campaign : null,
					remove_campaign: !!removeCampaign,
				});
				toast.success("Competition and featured display updated");
			} else {
				await updateCompetition(id, compFields);
				toast.success("Competition updated");
			}
			setEditOpen(false);
			setEditTarget(null);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Save failed");
		}
	}

	async function handleDelete(c: CompetitionItem) {
		try {
			await deleteCompetition(c.id);
			toast.success("Competition deleted");
			setDeleteTarget(null);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Delete failed");
		}
	}

	async function toggleFeatured(c: CompetitionItem) {
		try {
			await setCompetitionFeatured(c.id, !c.featured);
			toast.success(c.featured ? "Unfeatured" : "Set as featured");
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Toggle failed");
		}
	}

	async function toggleShowcase(c: CompetitionItem) {
		try {
			await setCompetitionShowcase(c.id, !c.showcase);
			toast.success(
				c.showcase ? "Removed from showcase" : "Added to showcase (max 3)"
			);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Toggle failed");
		}
	}

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<Trophy className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Competition management</h1>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total === 0 ? "No competitions" : `${total} competition${total === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Star = homepage featured (max 1). Eye = showcase strip (max 3).
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={refresh}
								disabled={loading}
							>
								<RefreshCw className={cn("w-4 h-4 mr-1", loading && "animate-spin")} />
								Refresh
							</Button>
							<Button
								size="sm"
								onClick={() => {
									setEditTarget(null);
									setEditOpen(true);
								}}
							>
								<Plus className="w-4 h-4 mr-1" />
								Create
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{loading && competitions.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : competitions.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No competitions yet. Use <strong>Create</strong> to add one.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-center py-2 px-1 font-medium w-12">Featured</th>
										<th className="text-center py-2 px-1 font-medium w-12">Showcase</th>
										<th className="text-center py-2 px-2 font-medium w-20">Display</th>
										<th className="text-left py-2 px-2 font-medium">Name</th>
										<th className="text-left py-2 px-2 font-medium">Market</th>
										<th className="text-right py-2 px-2 font-medium">Participants</th>
										<th className="text-right py-2 px-2 font-medium">Funding</th>
										<th className="text-right py-2 px-2 font-medium">Fees</th>
										<th className="text-left py-2 px-2 font-medium">Status</th>
										<th className="text-left py-2 px-2 font-medium">Start</th>
										<th className="text-left py-2 px-2 font-medium">End</th>
										<th className="text-right py-2 px-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{competitions.map((c) => (
										<tr key={c.id} className="border-b last:border-0">
											<td className="text-center py-2 px-1">
												<button
													onClick={() => toggleFeatured(c)}
													title={c.featured ? "Remove from featured" : "Set as featured"}
													className="hover:scale-110 transition-transform"
												>
													<Star
														className={cn(
															"w-5 h-5",
															c.featured
																? "fill-yellow-400 text-yellow-400"
																: "text-gray-300 hover:text-yellow-400"
														)}
													/>
												</button>
											</td>
											<td className="text-center py-2 px-1">
												<button
													onClick={() => toggleShowcase(c)}
													title={c.showcase ? "Remove from showcase" : "Add to showcase (max 3)"}
													className="hover:scale-110 transition-transform"
												>
													<Eye
														className={cn(
															"w-5 h-5",
															c.showcase
																? "text-indigo-500"
																: "text-gray-300 hover:text-indigo-400"
														)}
													/>
												</button>
											</td>
											<td className="text-center py-2 px-2">
												{c.campaign ? (
													<span
														className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5"
														title={c.campaign.title}
													>
														<Sparkles className="w-3 h-3" />
														{c.campaign.type}
													</span>
												) : (
													<span className="text-gray-300">—</span>
												)}
											</td>
											<td className="py-2 px-2 max-w-[240px] truncate">{c.name}</td>
											<td className="py-2 px-2 text-muted-foreground">{c.market_name}</td>
											<td className="py-2 px-2 text-right">{c.participant_count}</td>
											<td className="py-2 px-2 text-right">{formatCurrency(c.initial_funding)}</td>
											<td className="py-2 px-2 text-right">{(c.trading_fees * 100).toFixed(2)}%</td>
											<td className="py-2 px-2">
												<span
													className={cn(
														"inline-flex items-center rounded-full px-2 py-0.5 text-xs border",
														statusBadge(c.status)
													)}
												>
													{c.status}
												</span>
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{formatTimestampToDateHour(c.start_time)}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{formatTimestampToDateHour(c.end_time)}
											</td>
											<td className="py-2 px-2 text-right">
												<div className="inline-flex items-center gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => {
															setEditTarget({ ...c });
															setEditOpen(true);
														}}
														title="Edit"
													>
														<Pencil className="w-4 h-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setDeleteTarget(c)}
														title="Delete"
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

			{editOpen && (
				<EditCompetitionDialog
					open={editOpen}
					onOpenChange={setEditOpen}
					data={editTarget}
					onSubmit={handleSubmit}
				/>
			)}

			<AlertDialog
				open={!!deleteTarget}
				onOpenChange={(v) => !v && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete competition?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes <strong>{deleteTarget?.name}</strong> along with its participants,
							trades, and snapshots. Ongoing competitions can't be deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteTarget && handleDelete(deleteTarget)}
							className="bg-destructive text-white hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
