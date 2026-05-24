import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Swords, Target, Trophy, Zap } from "lucide-react";

import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { CampaignFields } from "@/api/qa-admin";

// ── Type definitions ──────────────────────────────────────────────

const CAMPAIGN_TYPES = [
	{
		value: "battle",
		label: "Battle",
		hint: "Celebrity vs Celebrity",
		icon: Swords,
		color: "text-amber-600",
		border: "border-amber-400",
		bg: "bg-amber-50",
		ctaText: "Pick a Side",
	},
	{
		value: "prediction",
		label: "Prediction",
		hint: "YES / NO market",
		icon: Target,
		color: "text-sky-600",
		border: "border-sky-400",
		bg: "bg-sky-50",
		ctaText: "Place Bet",
	},
	{
		value: "championship",
		label: "Championship",
		hint: "Seasonal tournament",
		icon: Trophy,
		color: "text-yellow-600",
		border: "border-yellow-400",
		bg: "bg-yellow-50",
		ctaText: "Register Now",
	},
	{
		value: "challenge",
		label: "Challenge",
		hint: "AI bots vs humans",
		icon: Zap,
		color: "text-cyan-600",
		border: "border-cyan-400",
		bg: "bg-cyan-50",
		ctaText: "Enter Arena",
	},
] as const;

type CampaignTypeValue = (typeof CAMPAIGN_TYPES)[number]["value"];

// ── Meta templates ────────────────────────────────────────────────

interface BattleMeta { team_a_name: string; team_a_score: string; team_b_name: string; team_b_score: string }
interface PredictionMeta { question: string; yes_pct: number; no_pct: number; total_stakes: number }
interface ChampionshipMeta { prize_pool: number; registration_count: number }
interface ChallengeMeta { bot_count: number; human_count: number }

type MetaShape = BattleMeta | PredictionMeta | ChampionshipMeta | ChallengeMeta;

const META_DEFAULTS: Record<CampaignTypeValue, MetaShape> = {
	battle:       { team_a_name: "", team_a_score: "+0%", team_b_name: "", team_b_score: "+0%" },
	prediction:   { question: "", yes_pct: 50, no_pct: 50, total_stakes: 0 },
	championship: { prize_pool: 0, registration_count: 0 },
	challenge:    { bot_count: 0, human_count: 0 },
};

function parseMeta(json: string): Record<string, unknown> {
	try { return JSON.parse(json || "{}") as Record<string, unknown>; } catch { return {}; }
}

function toDatetimeLocal(unix: number): string {
	if (!unix) return "";
	return new Date(unix * 1000).toISOString().slice(0, 16);
}

function fromDatetimeLocal(s: string): number {
	if (!s) return 0;
	return Math.floor(new Date(s).getTime() / 1000);
}

// ── Empty state ───────────────────────────────────────────────────

const empty = (): CampaignFields => ({
	title: "",
	subtitle: "",
	type: "battle",
	description: "",
	image_url: "",
	cta_text: "Pick a Side",
	cta_url: "/competition",
	start_time: 0,
	end_time: 0,
	status: "active",
	sort_order: 0,
	featured: true,
	meta_json: JSON.stringify(META_DEFAULTS["battle"]),
});

// ── Props ─────────────────────────────────────────────────────────

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	competitionName: string;
	initial: CampaignFields | null;
	onSave: (campaign: CampaignFields) => void;
}

// ── Component ─────────────────────────────────────────────────────

export default function CampaignDialog({ open, onOpenChange, competitionName, initial, onSave }: Props) {
	const [form, setForm] = useState<CampaignFields>(empty());
	const [meta, setMetaState] = useState<Record<string, unknown>>({});
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		if (!open) return;
		const f = initial ? { ...initial } : empty();
		setForm(f);
		setMetaState(parseMeta(f.meta_json));
	}, [open, initial]);

	function set(patch: Partial<CampaignFields>) {
		setForm((f) => ({ ...f, ...patch }));
	}

	function patchMeta(patch: Record<string, unknown>) {
		setMetaState((m) => {
			const next = { ...m, ...patch };
			set({ meta_json: JSON.stringify(next) });
			return next;
		});
	}

	function handleTypeChange(v: string) {
		const type = v as CampaignTypeValue;
		const def = META_DEFAULTS[type] ?? {};
		const typeDef = CAMPAIGN_TYPES.find((t) => t.value === type);
		const currentCta = CAMPAIGN_TYPES.find((t) => t.value === form.type)?.ctaText;
		const ctaIsDefault = form.cta_text === currentCta || form.cta_text === "Join Now";
		setMetaState(def as Record<string, unknown>);
		set({
			type,
			meta_json: JSON.stringify(def),
			...(ctaIsDefault && typeDef ? { cta_text: typeDef.ctaText } : {}),
		});
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!form.title.trim()) { toast.error("Title is required"); return; }
		setSubmitting(true);
		try { await onSave(form); } finally { setSubmitting(false); }
	}

	const selectedType = form.type as CampaignTypeValue;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{initial ? "Edit campaign" : "Add campaign"}</DialogTitle>
					<DialogDescription>
						Featured display card for <strong>{competitionName}</strong>
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-5 pt-1">

					{/* ── Type ─────────────────────────────────── */}
					<div className="space-y-1.5">
						<Label>Campaign type <span className="text-red-500">*</span></Label>
						<div className="grid grid-cols-4 gap-2">
							{CAMPAIGN_TYPES.map(({ value, label, hint, icon: Icon, color, border, bg }) => {
								const active = selectedType === value;
								return (
									<button
										key={value}
										type="button"
										onClick={() => handleTypeChange(value)}
										className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all cursor-pointer
											${active ? `${border} ${bg}` : "border-border hover:border-muted-foreground/40"}`}
									>
										<Icon className={`w-5 h-5 ${active ? color : "text-muted-foreground"}`} />
										<span className={`text-xs font-semibold ${active ? color : "text-foreground"}`}>{label}</span>
										<span className="text-[10px] text-muted-foreground leading-tight">{hint}</span>
									</button>
								);
							})}
						</div>
					</div>

					{/* ── Core ─────────────────────────────────── */}
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label>Title <span className="text-red-500">*</span></Label>
							<Input
								value={form.title}
								onChange={(e) => set({ title: e.target.value })}
								placeholder={
									selectedType === "battle" ? "Cathie Wood vs Warren Buffett" :
									selectedType === "prediction" ? "Will BTC hit $100k?" :
									selectedType === "championship" ? "Summer Trading Championship" :
									"Beat the Bots Challenge"
								}
							/>
						</div>
						<div className="space-y-1">
							<Label>Subtitle</Label>
							<Input
								value={form.subtitle}
								onChange={(e) => set({ subtitle: e.target.value })}
								placeholder={
									selectedType === "battle" ? "Who picks the best crypto portfolio?" :
									selectedType === "prediction" ? "Market closes Aug 31" :
									selectedType === "championship" ? "Season 3 · Top 10 win prizes" :
									"Human traders vs AI bots"
								}
							/>
						</div>
					</div>

					<div className="space-y-1">
						<Label>Description</Label>
						<Textarea
							value={form.description}
							onChange={(e) => set({ description: e.target.value })}
							rows={2}
							placeholder="Short copy shown at the bottom of the card"
						/>
					</div>

					{/* ── Type-specific fields ──────────────────── */}
					{selectedType === "battle" && (
						<div className="space-y-1.5">
							<Label className="text-amber-700">Competitors</Label>
							<div className="grid grid-cols-2 gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
								<div className="space-y-2">
									<p className="text-xs font-semibold text-amber-700">Player A</p>
									<Input
										placeholder="Name (e.g. Cathie Wood)"
										value={(meta.team_a_name as string) ?? ""}
										onChange={(e) => patchMeta({ team_a_name: e.target.value })}
									/>
									<Input
										placeholder="Score / return (e.g. +12.4%)"
										value={(meta.team_a_score as string) ?? ""}
										onChange={(e) => patchMeta({ team_a_score: e.target.value })}
									/>
								</div>
								<div className="space-y-2">
									<p className="text-xs font-semibold text-amber-700">Player B</p>
									<Input
										placeholder="Name (e.g. Warren Buffett)"
										value={(meta.team_b_name as string) ?? ""}
										onChange={(e) => patchMeta({ team_b_name: e.target.value })}
									/>
									<Input
										placeholder="Score / return (e.g. +8.1%)"
										value={(meta.team_b_score as string) ?? ""}
										onChange={(e) => patchMeta({ team_b_score: e.target.value })}
									/>
								</div>
							</div>
						</div>
					)}

					{selectedType === "prediction" && (
						<div className="space-y-1.5">
							<Label className="text-sky-700">Market data</Label>
							<div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 space-y-3">
								<Input
									placeholder="Question shown on card (e.g. Will BTC reach $100k by end of Q3?)"
									value={(meta.question as string) ?? ""}
									onChange={(e) => patchMeta({ question: e.target.value })}
								/>
								<div className="grid grid-cols-3 gap-3">
									<div className="space-y-1">
										<Label className="text-xs text-emerald-700">YES %</Label>
										<Input
											type="number"
											min={0}
											max={100}
											placeholder="62"
											value={(meta.yes_pct as number) ?? ""}
											onChange={(e) => {
												const yes = Math.min(100, Math.max(0, Number(e.target.value)));
												patchMeta({ yes_pct: yes, no_pct: 100 - yes });
											}}
										/>
									</div>
									<div className="space-y-1">
										<Label className="text-xs text-rose-700">NO %</Label>
										<Input
											type="number"
											min={0}
											max={100}
											placeholder="38"
											value={(meta.no_pct as number) ?? ""}
											onChange={(e) => {
												const no = Math.min(100, Math.max(0, Number(e.target.value)));
												patchMeta({ no_pct: no, yes_pct: 100 - no });
											}}
										/>
									</div>
									<div className="space-y-1">
										<Label className="text-xs">Total staked ($)</Label>
										<Input
											type="number"
											min={0}
											placeholder="250000"
											value={(meta.total_stakes as number) ?? ""}
											onChange={(e) => patchMeta({ total_stakes: Number(e.target.value) })}
										/>
									</div>
								</div>
							</div>
						</div>
					)}

					{selectedType === "championship" && (
						<div className="space-y-1.5">
							<Label className="text-yellow-700">Prize details</Label>
							<div className="grid grid-cols-2 gap-3 rounded-lg border border-yellow-200 bg-yellow-50/50 p-3">
								<div className="space-y-1">
									<Label className="text-xs">Prize pool ($)</Label>
									<Input
										type="number"
										min={0}
										placeholder="10000"
										value={(meta.prize_pool as number) ?? ""}
										onChange={(e) => patchMeta({ prize_pool: Number(e.target.value) })}
									/>
								</div>
								<div className="space-y-1">
									<Label className="text-xs">Registrations so far</Label>
									<Input
										type="number"
										min={0}
										placeholder="0"
										value={(meta.registration_count as number) ?? ""}
										onChange={(e) => patchMeta({ registration_count: Number(e.target.value) })}
									/>
								</div>
							</div>
						</div>
					)}

					{selectedType === "challenge" && (
						<div className="space-y-1.5">
							<Label className="text-cyan-700">Participant counts</Label>
							<div className="grid grid-cols-2 gap-3 rounded-lg border border-cyan-200 bg-cyan-50/50 p-3">
								<div className="space-y-1">
									<Label className="text-xs text-cyan-700">AI bots</Label>
									<Input
										type="number"
										min={0}
										placeholder="0"
										value={(meta.bot_count as number) ?? ""}
										onChange={(e) => patchMeta({ bot_count: Number(e.target.value) })}
									/>
								</div>
								<div className="space-y-1">
									<Label className="text-xs text-violet-700">Human traders</Label>
									<Input
										type="number"
										min={0}
										placeholder="0"
										value={(meta.human_count as number) ?? ""}
										onChange={(e) => patchMeta({ human_count: Number(e.target.value) })}
									/>
								</div>
							</div>
						</div>
					)}

					{/* ── Schedule ──────────────────────────────── */}
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label>Start date</Label>
							<Input
								type="datetime-local"
								value={toDatetimeLocal(form.start_time)}
								onChange={(e) => set({ start_time: fromDatetimeLocal(e.target.value) })}
							/>
						</div>
						<div className="space-y-1">
							<Label>End date</Label>
							<Input
								type="datetime-local"
								value={toDatetimeLocal(form.end_time)}
								onChange={(e) => set({ end_time: fromDatetimeLocal(e.target.value) })}
							/>
						</div>
					</div>

					{/* ── CTA ───────────────────────────────────── */}
					<div className="space-y-1.5">
						<Label>Call to action</Label>
						<div className="grid grid-cols-2 gap-3">
							<Input
								placeholder="Button label"
								value={form.cta_text}
								onChange={(e) => set({ cta_text: e.target.value })}
							/>
							<Input
								placeholder="/competition/42"
								value={form.cta_url}
								onChange={(e) => set({ cta_url: e.target.value })}
							/>
						</div>
					</div>

					{/* ── Display options ───────────────────────── */}
					<div className="flex items-end gap-4">
						<div className="space-y-1.5 shrink-0">
							<Label>Status</Label>
							<div className="flex rounded-md border overflow-hidden text-xs font-medium">
								{(["draft", "active", "ended"] as const).map((s) => (
									<button
										key={s}
										type="button"
										onClick={() => set({ status: s })}
										className={`px-3 py-1.5 capitalize cursor-pointer transition-colors
											${form.status === s
												? s === "active" ? "bg-emerald-500 text-white"
												  : s === "ended" ? "bg-slate-500 text-white"
												  : "bg-slate-200 text-slate-700"
												: "bg-background text-muted-foreground hover:bg-muted"
											}`}
									>
										{s}
									</button>
								))}
							</div>
						</div>
						<div className="flex items-center gap-2 pb-1.5 ml-auto">
							<input
								id="camp_featured"
								type="checkbox"
								checked={form.featured}
								onChange={(e) => set({ featured: e.target.checked })}
								className="w-4 h-4 accent-emerald-500"
							/>
							<Label htmlFor="camp_featured" className="cursor-pointer">
								Show in dashboard carousel
							</Label>
						</div>
					</div>

					{/* ── Image URL ─────────────────────────────── */}
					<div className="space-y-1">
						<Label>Banner image URL <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
						<Input
							value={form.image_url}
							onChange={(e) => set({ image_url: e.target.value })}
							placeholder="https://…"
						/>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
						<Button type="submit" disabled={!form.title || submitting}>
							{submitting ? "Saving…" : "Save campaign"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
