import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

import {
	getCompetitionCampaign,
	listMarkets,
	type CampaignFields,
	type CreateCompetitionRequest,
	type MarketItem,
} from "@/api/qa-admin";

export interface EditCompetitionInfo extends CreateCompetitionRequest {
	id?: number;
}

export interface EditCompetitionSubmit extends EditCompetitionInfo {
	// Unified-editor extras. When `id` is set and `campaignEnabled`
	// toggles, the submit routes through /with-campaign to atomically
	// upsert/delete the linked campaign row.
	campaignEnabled?: boolean;
	campaign?: CampaignFields | null;
	removeCampaign?: boolean;
}

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (data: EditCompetitionSubmit) => void;
	data?: EditCompetitionInfo | null;
}

interface FormState {
	name: string;
	market_id: number;
	initial_funding: string;
	trading_fees: string;
	start_time: number;
	end_time: number;
}

const EMPTY_FORM: FormState = {
	name: "",
	market_id: 0,
	initial_funding: "",
	trading_fees: "",
	start_time: 0,
	end_time: 0,
};

const CAMPAIGN_TYPES = [
	{ value: "battle", label: "Battle (Celebrity vs Celebrity)" },
	{ value: "prediction", label: "Prediction Market (YES/NO)" },
	{ value: "championship", label: "Championship (Seasonal Event)" },
	{ value: "challenge", label: "Challenge (Thematic)" },
];

const emptyCampaign = (): CampaignFields => ({
	title: "",
	subtitle: "",
	type: "battle",
	description: "",
	image_url: "",
	cta_text: "Join Now",
	cta_url: "/competition",
	start_time: 0,
	end_time: 0,
	status: "active",
	sort_order: 0,
	featured: true,
	meta_json: "{}",
});

// Convert unix seconds ↔ the HTML datetime-local format (YYYY-MM-DDTHH:MM).
// Chose native input over react-datepicker to avoid a heavy dep — hourly
// granularity is the authoritative constraint per the LQA admin.
const tsToLocal = (ts: number): string => {
	if (!ts) return "";
	const d = new Date(ts * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
};
const localToTs = (s: string): number => {
	if (!s) return 0;
	const d = new Date(s);
	if (Number.isNaN(d.getTime())) return 0;
	d.setMinutes(0, 0, 0);
	return Math.floor(d.getTime() / 1000);
};

export default function EditCompetitionDialog({
	open,
	onOpenChange,
	onSubmit,
	data,
}: Props) {
	const [form, setForm] = useState<FormState>(EMPTY_FORM);
	const [markets, setMarkets] = useState<MarketItem[]>([]);
	const [marketsLoading, setMarketsLoading] = useState(false);

	// Campaign sub-section state.
	const [campaignOpen, setCampaignOpen] = useState(false);
	const [campaignEnabled, setCampaignEnabled] = useState(false);
	const [campaign, setCampaign] = useState<CampaignFields>(emptyCampaign());
	// Tracks whether the competition had a linked campaign when the dialog
	// opened — needed so we can signal "delete it" if the admin disables it.
	const [hadCampaign, setHadCampaign] = useState(false);

	// Seed form from incoming `data` when the dialog opens.
	useEffect(() => {
		if (!open) return;
		if (data) {
			setForm({
				name: data.name,
				market_id: data.market_id,
				initial_funding: String(data.initial_funding),
				trading_fees: String((data.trading_fees ?? 0) * 100),
				start_time: data.start_time,
				end_time: data.end_time,
			});
		} else {
			setForm(EMPTY_FORM);
		}
		setCampaign(emptyCampaign());
		setCampaignEnabled(false);
		setCampaignOpen(false);
		setHadCampaign(false);
	}, [data, open]);

	// Load market dropdown once per open.
	useEffect(() => {
		if (!open) return;
		(async () => {
			setMarketsLoading(true);
			try {
				const r = await listMarkets({ page: 1, page_size: 2000 });
				setMarkets(r.data?.markets || []);
			} catch (e: unknown) {
				toast.error((e as Error)?.message || "Failed to load markets");
			} finally {
				setMarketsLoading(false);
			}
		})();
	}, [open]);

	// Load linked campaign when editing an existing competition.
	useEffect(() => {
		if (!open || !data?.id) return;
		(async () => {
			try {
				const r = await getCompetitionCampaign(data.id!);
				if (r.data) {
					setCampaign(r.data);
					setCampaignEnabled(true);
					setCampaignOpen(true);
					setHadCampaign(true);
				}
			} catch {
				// non-fatal — section stays empty
			}
		})();
	}, [data?.id, open]);

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const { start_time, end_time, initial_funding, trading_fees } = form;
		if (start_time >= end_time) {
			toast.error("Start time must be before end time");
			return;
		}
		const funding = Number(initial_funding);
		const fees = Number(trading_fees);
		if (funding <= 0) {
			toast.error("Initial funding must be greater than 0");
			return;
		}
		if (fees <= 0) {
			toast.error("Trading fees must be greater than 0");
			return;
		}
		if (campaignEnabled && !campaign.title) {
			toast.error("Campaign title is required when the featured display is enabled");
			return;
		}
		onSubmit({
			name: form.name,
			market_id: form.market_id,
			initial_funding: funding,
			trading_fees: fees / 100,
			start_time: form.start_time,
			end_time: form.end_time,
			id: data?.id,
			campaignEnabled,
			campaign: campaignEnabled ? campaign : null,
			removeCampaign: hadCampaign && !campaignEnabled,
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{data?.id ? "Edit Competition" : "Create Competition"}
					</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor="name">
							Name<span className="text-red-500"> *</span>
						</Label>
						<Input
							id="name"
							placeholder="e.g. Global Markets Cup"
							value={form.name}
							onChange={(e) => setForm({ ...form, name: e.target.value })}
						/>
					</div>

					<div className="space-y-1">
						<Label htmlFor="market">
							Market<span className="text-red-500"> *</span>
						</Label>
						<Select
							value={form.market_id ? String(form.market_id) : ""}
							onValueChange={(v) =>
								setForm({ ...form, market_id: parseInt(v) })
							}
						>
							<SelectTrigger id="market">
								<SelectValue placeholder="Select market" />
							</SelectTrigger>
							<SelectContent>
								{marketsLoading ? (
									<SelectItem value="_loading" disabled>
										Loading…
									</SelectItem>
								) : (
									markets.map((m) => (
										<SelectItem key={m.id} value={String(m.id)}>
											{m.name}
										</SelectItem>
									))
								)}
							</SelectContent>
						</Select>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label htmlFor="initial_funding">
								Initial Funding<span className="text-red-500"> *</span>
							</Label>
							<Input
								id="initial_funding"
								type="number"
								min={0}
								value={form.initial_funding}
								onChange={(e) =>
									setForm({ ...form, initial_funding: e.target.value })
								}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="trading_fees">
								Trading Fees (%)<span className="text-red-500"> *</span>
							</Label>
							<Input
								id="trading_fees"
								type="number"
								min={0}
								max={100}
								step={0.01}
								value={form.trading_fees}
								onChange={(e) =>
									setForm({ ...form, trading_fees: e.target.value })
								}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label htmlFor="start_time">
								Start Time<span className="text-red-500"> *</span>
							</Label>
							<Input
								id="start_time"
								type="datetime-local"
								step="3600"
								value={tsToLocal(form.start_time)}
								onChange={(e) =>
									setForm({ ...form, start_time: localToTs(e.target.value) })
								}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="end_time">
								End Time<span className="text-red-500"> *</span>
							</Label>
							<Input
								id="end_time"
								type="datetime-local"
								step="3600"
								value={tsToLocal(form.end_time)}
								onChange={(e) =>
									setForm({ ...form, end_time: localToTs(e.target.value) })
								}
							/>
						</div>
					</div>

					{/* Campaign sub-section — only meaningful when editing an
					    existing competition (the /with-campaign endpoint needs
					    an ID). */}
					{data?.id && (
						<div className="border-t pt-4">
							<button
								type="button"
								onClick={() => setCampaignOpen((v) => !v)}
								className="flex items-center gap-2 font-medium text-sm hover:text-indigo-600 cursor-pointer"
							>
								{campaignOpen ? (
									<ChevronDown className="w-4 h-4" />
								) : (
									<ChevronRight className="w-4 h-4" />
								)}
								Featured display (campaign)
								{hadCampaign && (
									<span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full ml-2">
										linked
									</span>
								)}
							</button>

							{campaignOpen && (
								<div className="mt-3 space-y-3 pl-6">
									<div className="flex items-center gap-2">
										<input
											id="campaign_enabled"
											type="checkbox"
											checked={campaignEnabled}
											onChange={(e) => setCampaignEnabled(e.target.checked)}
											className="w-4 h-4"
										/>
										<Label htmlFor="campaign_enabled">
											Show a campaign card on the dashboard for this competition
										</Label>
									</div>

									{campaignEnabled && (
										<div className="space-y-3">
											<div className="grid grid-cols-2 gap-3">
												<div className="space-y-1">
													<Label>
														Title <span className="text-red-500">*</span>
													</Label>
													<Input
														value={campaign.title}
														onChange={(e) =>
															setCampaign({ ...campaign, title: e.target.value })
														}
														placeholder="Cathie Wood vs Warren Buffett"
													/>
												</div>
												<div className="space-y-1">
													<Label>
														Type <span className="text-red-500">*</span>
													</Label>
													<Select
														value={campaign.type}
														onValueChange={(v) =>
															setCampaign({ ...campaign, type: v })
														}
													>
														<SelectTrigger>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{CAMPAIGN_TYPES.map((t) => (
																<SelectItem key={t.value} value={t.value}>
																	{t.label}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</div>
											</div>

											<div className="space-y-1">
												<Label>Subtitle</Label>
												<Input
													value={campaign.subtitle}
													onChange={(e) =>
														setCampaign({ ...campaign, subtitle: e.target.value })
													}
												/>
											</div>

											<div className="space-y-1">
												<Label>Description</Label>
												<Textarea
													value={campaign.description}
													onChange={(e) =>
														setCampaign({
															...campaign,
															description: e.target.value,
														})
													}
													rows={2}
												/>
											</div>

											<div className="grid grid-cols-2 gap-3">
												<div className="space-y-1">
													<Label>CTA text</Label>
													<Input
														value={campaign.cta_text}
														onChange={(e) =>
															setCampaign({
																...campaign,
																cta_text: e.target.value,
															})
														}
													/>
												</div>
												<div className="space-y-1">
													<Label>CTA URL</Label>
													<Input
														value={campaign.cta_url}
														onChange={(e) =>
															setCampaign({
																...campaign,
																cta_url: e.target.value,
															})
														}
													/>
												</div>
											</div>

											<div className="grid grid-cols-3 gap-3">
												<div className="space-y-1">
													<Label>Status</Label>
													<Select
														value={campaign.status}
														onValueChange={(v) =>
															setCampaign({ ...campaign, status: v })
														}
													>
														<SelectTrigger>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="draft">Draft</SelectItem>
															<SelectItem value="active">Active</SelectItem>
															<SelectItem value="ended">Ended</SelectItem>
														</SelectContent>
													</Select>
												</div>
												<div className="space-y-1">
													<Label>Sort order</Label>
													<Input
														type="number"
														value={campaign.sort_order}
														onChange={(e) =>
															setCampaign({
																...campaign,
																sort_order: Number(e.target.value),
															})
														}
													/>
												</div>
												<div className="flex items-end gap-2 pb-1">
													<input
														id="campaign_featured"
														type="checkbox"
														checked={campaign.featured}
														onChange={(e) =>
															setCampaign({
																...campaign,
																featured: e.target.checked,
															})
														}
														className="w-4 h-4"
													/>
													<Label htmlFor="campaign_featured">
														Featured on dashboard
													</Label>
												</div>
											</div>

											<div className="space-y-1">
												<Label>Image URL</Label>
												<Input
													value={campaign.image_url}
													onChange={(e) =>
														setCampaign({
															...campaign,
															image_url: e.target.value,
														})
													}
													placeholder="https://…"
												/>
											</div>

											<div className="space-y-1">
												<Label>Meta JSON (type-specific data)</Label>
												<Textarea
													value={campaign.meta_json}
													onChange={(e) =>
														setCampaign({
															...campaign,
															meta_json: e.target.value,
														})
													}
													rows={4}
													className="font-mono text-xs"
												/>
											</div>
										</div>
									)}
								</div>
							)}
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
						<Button
							type="submit"
							disabled={
								!form.name ||
								!form.market_id ||
								!form.initial_funding ||
								!form.trading_fees ||
								!form.start_time ||
								!form.end_time
							}
						>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
