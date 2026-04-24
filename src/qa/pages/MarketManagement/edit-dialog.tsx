import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";

import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
	listLivePriceSources,
	listSymbols,
	type CreateMarketRequest,
	type SymbolItem,
} from "@/api/qa-admin";

export type MarketEditTarget =
	| { mode: "create" }
	| { mode: "edit"; id: number; name: string };

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target: MarketEditTarget | null;
	onCreate: (data: CreateMarketRequest) => Promise<void>;
	onRename: (id: number, name: string) => Promise<void>;
}

const EMPTY_CREATE: CreateMarketRequest = {
	name: "",
	symbols: [],
	live_price_source: "",
};

export default function MarketEditDialog({
	open,
	onOpenChange,
	target,
	onCreate,
	onRename,
}: Props) {
	// Create-mode state.
	const [form, setForm] = useState<CreateMarketRequest>(EMPTY_CREATE);
	const [sources, setSources] = useState<string[]>([]);
	const [symbols, setSymbols] = useState<SymbolItem[]>([]);
	const [symbolSearch, setSymbolSearch] = useState("");
	const [symbolsLoading, setSymbolsLoading] = useState(false);
	const [popoverOpen, setPopoverOpen] = useState(false);

	// Edit-mode state (rename-only; LQA backend doesn't let admins change symbols after creation).
	const [renameValue, setRenameValue] = useState("");

	const isCreate = target?.mode === "create";

	// Reset on open.
	useEffect(() => {
		if (!open) return;
		if (target?.mode === "edit") {
			setRenameValue(target.name);
		} else {
			setForm(EMPTY_CREATE);
			setSymbolSearch("");
			setSymbols([]);
		}
	}, [open, target]);

	// Price source list (create only).
	useEffect(() => {
		if (!open || !isCreate) return;
		(async () => {
			try {
				const r = await listLivePriceSources();
				setSources(r.data?.sources || []);
			} catch (e: unknown) {
				toast.error((e as Error)?.message || "Failed to load price sources");
			}
		})();
	}, [open, isCreate]);

	// Debounced symbol search when source is picked.
	useEffect(() => {
		if (!isCreate || !form.live_price_source) return;
		const timer = setTimeout(async () => {
			setSymbolsLoading(true);
			try {
				const r = await listSymbols({
					source: form.live_price_source,
					fuzzy: symbolSearch || undefined,
				});
				setSymbols((r.data?.symbols || []).slice(0, 500));
			} catch (e: unknown) {
				toast.error((e as Error)?.message || "Failed to load symbols");
			} finally {
				setSymbolsLoading(false);
			}
		}, 350);
		return () => clearTimeout(timer);
	}, [isCreate, form.live_price_source, symbolSearch]);

	function toggleSymbol(sym: string) {
		setForm((f) => ({
			...f,
			symbols: f.symbols.includes(sym)
				? f.symbols.filter((s) => s !== sym)
				: [...f.symbols, sym],
		}));
	}

	function removeSymbol(sym: string) {
		setForm((f) => ({ ...f, symbols: f.symbols.filter((s) => s !== sym) }));
	}

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (isCreate) {
			if (!form.name || !form.live_price_source || form.symbols.length === 0) {
				toast.error("Name, source and at least one symbol are required");
				return;
			}
			await onCreate(form);
		} else if (target?.mode === "edit") {
			if (!renameValue.trim()) {
				toast.error("Name is required");
				return;
			}
			await onRename(target.id, renameValue.trim());
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-full max-w-2xl max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isCreate ? "Create Portfolio" : "Rename Portfolio"}
					</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					{isCreate ? (
						<>
							<div className="space-y-1">
								<Label htmlFor="name">
									Name<span className="text-red-500"> *</span>
								</Label>
								<Input
									id="name"
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
									placeholder="e.g. US-major-crypto"
								/>
							</div>

							<div className="space-y-1">
								<Label>
									Live price source<span className="text-red-500"> *</span>
								</Label>
								<Select
									value={form.live_price_source}
									onValueChange={(v) =>
										setForm({
											...form,
											live_price_source: v,
											symbols: [],
										})
									}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select source" />
									</SelectTrigger>
									<SelectContent>
										{sources.map((s) => (
											<SelectItem key={s} value={s}>
												{s}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-1">
								<Label>
									Symbols<span className="text-red-500"> *</span>
								</Label>
								<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
									<PopoverTrigger asChild>
										<div
											className={cn(
												"flex flex-wrap gap-1 min-h-10 rounded-md border border-input bg-input-background px-3 py-2 cursor-pointer",
												!form.live_price_source && "opacity-50 pointer-events-none"
											)}
										>
											{form.symbols.length === 0 && (
												<span className="text-sm text-muted-foreground">
													{form.live_price_source
														? "Click to pick symbols"
														: "Pick a price source first"}
												</span>
											)}
											{form.symbols.map((s) => (
												<span
													key={s}
													className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5"
												>
													{s}
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															removeSymbol(s);
														}}
													>
														<X className="w-3 h-3" />
													</button>
												</span>
											))}
										</div>
									</PopoverTrigger>
									<PopoverContent className="p-0 w-[360px]" align="start">
										<div className="p-2 border-b">
											<Input
												placeholder="Search symbols…"
												value={symbolSearch}
												onChange={(e) => setSymbolSearch(e.target.value)}
											/>
										</div>
										<div className="max-h-64 overflow-y-auto">
											{symbolsLoading ? (
												<div className="p-3 text-sm text-muted-foreground">
													Loading…
												</div>
											) : symbols.length === 0 ? (
												<div className="p-3 text-sm text-muted-foreground">
													No symbols
												</div>
											) : (
												symbols.map((s) => {
													const picked = form.symbols.includes(s.symbol);
													return (
														<button
															key={s.symbol}
															type="button"
															onClick={() => toggleSymbol(s.symbol)}
															className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent text-left"
														>
															<span className="w-4">
																{picked && <Check className="w-4 h-4 text-indigo-600" />}
															</span>
															<span className="font-mono">{s.symbol}</span>
															{s.name && (
																<span className="text-xs text-muted-foreground truncate">
																	{s.name}
																</span>
															)}
														</button>
													);
												})
											)}
										</div>
									</PopoverContent>
								</Popover>
								<p className="text-xs text-muted-foreground">
									{form.symbols.length} selected
								</p>
							</div>
						</>
					) : (
						<div className="space-y-1">
							<Label htmlFor="rename">
								Name<span className="text-red-500"> *</span>
							</Label>
							<Input
								id="rename"
								value={renameValue}
								onChange={(e) => setRenameValue(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Only the display name can be changed after creation.
							</p>
						</div>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit">{isCreate ? "Create" : "Save"}</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
