import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	ChevronLeft,
	ChevronRight,
	FileCode,
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
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDateTime } from "@/lib/utils";
import {
	createTemplate,
	deleteTemplate,
	listTemplates,
	type CreateTemplateRequest,
	type TemplateItem,
} from "@/api/qa-admin";

const PAGE_SIZE = 20;

function tsToLocalDate(ts: number): string {
	if (!ts) return "";
	const d = new Date(ts * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localDateToTs(s: string): number {
	if (!s) return 0;
	const d = new Date(`${s}T00:00:00`);
	if (Number.isNaN(d.getTime())) return 0;
	return Math.floor(d.getTime() / 1000);
}

function CreateTemplateDialog({
	open,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	onSubmit: (data: CreateTemplateRequest) => Promise<void>;
}) {
	const [form, setForm] = useState<CreateTemplateRequest>({
		name: "",
		description: "",
		start_date: 0,
		end_date: 0,
	});

	useEffect(() => {
		if (open) {
			setForm({ name: "", description: "", start_date: 0, end_date: 0 });
		}
	}, [open]);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!form.name) {
			toast.error("Name is required");
			return;
		}
		if (form.start_date && form.end_date && form.start_date >= form.end_date) {
			toast.error("Start date must be before end date");
			return;
		}
		await onSubmit(form);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Create backtesting template</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-3">
					<div className="space-y-1">
						<Label htmlFor="name">
							Name<span className="text-red-500"> *</span>
						</Label>
						<Input
							id="name"
							value={form.name}
							onChange={(e) => setForm({ ...form, name: e.target.value })}
							placeholder="e.g. 2025-full-year-SPY"
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							rows={3}
							value={form.description}
							onChange={(e) => setForm({ ...form, description: e.target.value })}
							placeholder="Context for users of this template"
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label htmlFor="start_date">Start date</Label>
							<Input
								id="start_date"
								type="date"
								value={tsToLocalDate(form.start_date)}
								onChange={(e) =>
									setForm({ ...form, start_date: localDateToTs(e.target.value) })
								}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="end_date">End date</Label>
							<Input
								id="end_date"
								type="date"
								value={tsToLocalDate(form.end_date)}
								onChange={(e) =>
									setForm({ ...form, end_date: localDateToTs(e.target.value) })
								}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit">Create</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export default function TemplateManagement() {
	const [templates, setTemplates] = useState<TemplateItem[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [createOpen, setCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<TemplateItem | null>(null);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	async function refresh() {
		setLoading(true);
		try {
			const r = await listTemplates({ page, page_size: PAGE_SIZE });
			setTemplates(r.data?.templates || []);
			setTotal(r.total || 0);
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Failed to load templates");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [page]);

	async function handleCreate(data: CreateTemplateRequest) {
		try {
			await createTemplate(data);
			toast.success("Template created");
			setCreateOpen(false);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Create failed");
		}
	}

	async function handleDelete(t: TemplateItem) {
		try {
			await deleteTemplate(t.id);
			toast.success("Template deleted");
			setDeleteTarget(null);
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || "Delete failed");
		}
	}

	return (
		<>
			<header className="flex items-center gap-2 mb-6">
				<FileCode className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">Backtesting templates</h1>
			</header>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<CardTitle className="text-base">
								{total === 0
									? "No templates"
									: `${total} template${total === 1 ? "" : "s"}`}
							</CardTitle>
							<CardDescription>
								Named date ranges users can pick when starting a backtest. Read-only for users.
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
							<Button size="sm" onClick={() => setCreateOpen(true)}>
								<Plus className="w-4 h-4 mr-1" />
								Create
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{loading && templates.length === 0 ? (
						<p className="text-sm text-muted-foreground">Loading…</p>
					) : templates.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No templates yet. Use <strong>Create</strong> to add one.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 px-2 font-medium">Name</th>
										<th className="text-left py-2 px-2 font-medium">Description</th>
										<th className="text-left py-2 px-2 font-medium">Start</th>
										<th className="text-left py-2 px-2 font-medium">End</th>
										<th className="text-left py-2 px-2 font-medium">Created</th>
										<th className="text-right py-2 px-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody>
									{templates.map((t) => (
										<tr key={t.id} className="border-b last:border-0">
											<td className="py-2 px-2 font-medium">{t.name}</td>
											<td className="py-2 px-2 max-w-[320px] truncate text-muted-foreground">
												{t.description || "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{t.start_date ? tsToLocalDate(t.start_date) : "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{t.end_date ? tsToLocalDate(t.end_date) : "—"}
											</td>
											<td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
												{formatDateTime(t.create_time)}
											</td>
											<td className="py-2 px-2 text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => setDeleteTarget(t)}
													title="Delete"
												>
													<Trash2 className="w-4 h-4 text-destructive" />
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

			<CreateTemplateDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onSubmit={handleCreate}
			/>

			<AlertDialog
				open={!!deleteTarget}
				onOpenChange={(v) => !v && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete template?</AlertDialogTitle>
						<AlertDialogDescription>
							Removes <strong>{deleteTarget?.name}</strong>. Templates currently
							referenced by an active backtesting task can't be deleted.
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
