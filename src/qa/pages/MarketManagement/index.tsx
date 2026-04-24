import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	ChevronLeft,
	ChevronRight,
	LineChart,
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
import { cn, formatDateTime } from "@/lib/utils";
import {
	createMarket,
	deleteMarket,
	listMarkets,
	updateMarket,
	type CreateMarketRequest,
	type MarketItem,
} from "@/api/qa-admin";

import MarketEditDialog, { type MarketEditTarget } from "./edit-dialog";

const PAGE_SIZE = 20;

export default function MarketManagement() {
	const [markets, setMarkets] = useState<MarketItem[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);

	const [editOpen, setEditOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<MarketEditTarget | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<MarketItem | null>(null);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	async function refresh() {
		setLoading(true);
		try {
			const r = await listMarkets({ page, page_size: PAGE_SIZE });
			setMarkets(r.data?.markets || []);
			setTotal(r.total || 0);
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Failed to load portfolios");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page]);

	async function handleCreate(data: CreateMarketRequest) {
		try {
			await createMarket(data);
			toast.success("Portfolio created");
			setEditOpen(false);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Create failed");
		}
	}

	async function handleRename(id: number, name: string) {
		try {
			await updateMarket(id, { name });
			toast.success("Portfolio renamed");
			setEditOpen(false);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Rename failed");
		}
	}

	async function handleDelete(m: MarketItem) {
		try {
			await deleteMarket(m.id);
			toast.success("Portfolio deleted");
			setDeleteTarget(null);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Delete failed");
		}
	}

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<LineChart className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Portfolio management</h1>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total === 0
									? "No portfolios"
									: `${total} portfolio${total === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Named symbol bundles shown to users when creating a strategy or competition.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={refresh}
								disabled={loading}
							>
								<RefreshCw
									className={cn("w-4 h-4 mr-1", loading && "animate-spin")}
								/>
								Refresh
							</Button>
							<Button
								size="sm"
								onClick={() => {
									setEditTarget({ mode: "create" });
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
					{loading && markets.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : markets.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No portfolios yet. Use <strong>Create</strong> to add one.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Name</th>
										<th className="text-left py-2 px-2 font-medium">Symbols</th>
										<th className="text-left py-2 px-2 font-medium">Live price source</th>
										<th className="text-left py-2 px-2 font-medium">Created</th>
										<th className="text-right py-2 px-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{markets.map((m) => (
										<tr key={m.id} className="border-b last:border-0">
											<td className="py-2 px-2 font-medium">{m.name || "—"}</td>
											<td className="py-2 px-2 max-w-[320px] truncate font-mono text-xs" title={m.symbols.join(", ")}>
												{m.symbols.length === 0 ? "—" : m.symbols.join(", ")}
											</td>
											<td className="py-2 px-2 text-muted-foreground">
												{m.live_price_source || "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{formatDateTime(m.create_time)}
											</td>
											<td className="py-2 px-2 text-right">
												<div className="inline-flex items-center gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => {
															setEditTarget({ mode: "edit", id: m.id, name: m.name });
															setEditOpen(true);
														}}
														title="Rename"
													>
														<Pencil className="w-4 h-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setDeleteTarget(m)}
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
				<MarketEditDialog
					open={editOpen}
					onOpenChange={setEditOpen}
					target={editTarget}
					onCreate={handleCreate}
					onRename={handleRename}
				/>
			)}

			<AlertDialog
				open={!!deleteTarget}
				onOpenChange={(v) => !v && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete portfolio?</AlertDialogTitle>
						<AlertDialogDescription>
							<strong>{deleteTarget?.name}</strong> will be removed. Competitions that
							reference it will break — delete only when you're sure nothing is using it.
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
