// Lumen design gallery — every token, scale, primitive, brand piece and motion
// sample on one page, with no auth and no data. This is where a visual change
// gets checked pixel by pixel before it reaches a real surface:
//
//   npx vite --port 5199  ->  http://localhost:5199/auth/design-dev.html
//   (?section=<id> scrolls to one section; screenshots: e2e/design-gallery.mjs)

import { useState } from "react";
import { Bell, Boxes, Database, Inbox, Play, Plus, Search, Sparkles } from "lucide-react";
import * as palette from "@/styles/palette";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Segmented } from "@/components/ui/segmented";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, StatusDot } from "@/components/ui/status-badge";
import { DataTable, DTHead, DTh, DTr, DTd } from "@/components/ui/data-table";
import { StrandMark } from "@/components/illustrations/StrandMark";
import { StrandAvatar } from "@/components/illustrations/StrandAvatar";
import * as Scenes from "@/components/illustrations/scenes";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
	return (
		<section id={id} data-section={id} className="border-t border-border py-10 first:border-0">
			<div className="eyebrow mb-4">{title}</div>
			{children}
		</section>
	);
}

function Swatches({ name, scale }: { name: string; scale: Record<string, string> }) {
	return (
		<div className="mb-3 flex items-center gap-3">
			<div className="w-16 text-meta font-medium text-ink-800">{name}</div>
			<div className="flex flex-1 overflow-hidden rounded-lg border border-border">
				{Object.entries(scale).map(([k, v]) => (
					<div key={k} className="flex-1 h-14 flex items-end p-1.5" style={{ background: v }} title={`${name}-${k} ${v}`}>
						<span className="text-nano font-medium tabular-nums" style={{ color: Number(k) >= 500 ? "#FFFEFB" : "#4F4738" }}>
							{k}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

const SLUGS = [
	"quant-research", "mbb-consultant", "mbb-ai", "python-study-e2e", "auto-sysresearch-mmc", "nl2sql-autoresearch-flowmesh",
	"personal-agent", "lumid-gpu-rentals", "auto-sysresearch", "venue-link-matcher", "lqt-arb-monitor", "qa-sentinel",
	"lumid-market", "lumid-data-findata", "eventx", "kalshi-scan",
];

export default function DesignGallery() {
	const [seg, setSeg] = useState<"all" | "running" | "failed">("all");
	const [replay, setReplay] = useState(0);
	return (
		<div className="min-h-screen bg-background text-foreground">
			<div className="mx-auto max-w-[1120px] px-8 pb-24">
				<PageHeader
					eyebrow="Design system"
					title="Lumen"
					subtitle="Warm paper, ink and bronze. One token system, one type scale, calm motion, and the Strands illustration family."
					actions={
						<>
							<Button variant="secondary" size="sm" onClick={() => setReplay((n) => n + 1)}>
								Replay motion
							</Button>
							<Button size="sm">
								<Plus /> New chat
							</Button>
						</>
					}
				/>

				<Section id="color" title="Colour">
					{(["ink", "gold", "ember", "brick", "lagoon", "plum"] as const).map((n) => (
						<Swatches key={n} name={n} scale={palette[n]} />
					))}
					<div className="mt-5 flex items-center gap-3">
						<div className="w-16 text-meta font-medium text-ink-800">chart</div>
						<div className="flex gap-1.5" data-palette-ok="">
							{palette.chart.map((c, i) => (
								<div key={c} className="flex flex-col items-center gap-1">
									<div className="h-10 w-14 rounded-md" style={{ background: c }} />
									<span className="text-nano tabular-nums text-ink-600">{i + 1}</span>
								</div>
							))}
						</div>
					</div>
				</Section>

				<Section id="type" title="Type">
					<div className="space-y-3">
						<div className="font-display text-h1 font-medium">Good afternoon, Yao</div>
						<div className="font-display text-h2 font-medium">Runs · h2 serif 24</div>
						<div className="font-display text-h3 font-medium">Section title · h3 serif 20</div>
						<div className="text-title font-semibold">Card title · title 17</div>
						<p className="text-read max-w-[68ch]">
							Read 15 — chat and markdown. Beta Optics is a U.S.-based mid-size manufacturer of prescription eyeglass
							lenses; the decision they're weighing is whether to invest in a new, digitised production process.
						</p>
						<p className="text-body text-ink-700">Body 14 — the UI default for labels, rows and controls.</p>
						<p className="text-meta text-ink-600">Meta 13 — secondary lines, row metadata, 2 schemas · 14 tables.</p>
						<p className="text-caption text-ink-600">Caption 12 — timestamps, hints.</p>
						<p className="text-micro text-ink-600">Micro 11 — chips and badges.</p>
						<p className="text-nano text-ink-600">Nano 10 — dense tables only.</p>
						<div className="eyebrow">Eyebrow · section kicker</div>
						<p className="text-body tabular-nums">tabular-nums 1,234,567.89 · 0.0421 · 99.9%</p>
					</div>
				</Section>

				<Section id="elevation" title="Shape & elevation">
					<div className="grid grid-cols-4 gap-5">
						{["shadow-e1", "shadow-e2", "shadow-e3", "lumen-lift shadow-e1"].map((s) => (
							<div key={s} className={`h-24 rounded-xl border border-border bg-card p-3 text-meta text-ink-600 ${s}`}>
								{s === "lumen-lift shadow-e1" ? "hover me (lift)" : s}
							</div>
						))}
					</div>
				</Section>

				<Section id="controls" title="Controls">
					<div className="flex flex-wrap items-center gap-3">
						<Button>Primary</Button>
						<Button variant="accent">
							<Plus /> Add to my account
						</Button>
						<Button variant="secondary">Secondary</Button>
						<Button variant="ghost">Ghost</Button>
						<Button variant="destructive">Delete</Button>
						<Button variant="link">Link</Button>
						<Button size="sm" variant="secondary">
							<Play /> Run now
						</Button>
						<Button size="icon" variant="ghost" aria-label="Notifications">
							<Bell />
						</Button>
						<Button disabled>Disabled</Button>
					</div>
					<div className="mt-6 grid max-w-2xl grid-cols-2 gap-4">
						<div className="relative">
							<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
							<Input placeholder="Search apps…" className="pl-9" />
						</div>
						<Input placeholder="aria-invalid" aria-invalid defaultValue="bad value" />
						<label className="flex items-center gap-2 text-body">
							<Checkbox defaultChecked /> Unread only
						</label>
						<label className="flex items-center gap-2 text-body">
							<Checkbox /> Include archived
						</label>
					</div>
					<div className="mt-6 flex flex-wrap items-center gap-6">
						<Segmented
							aria-label="State"
							value={seg}
							onChange={setSeg}
							options={[
								{ value: "all", label: "All", count: 42 },
								{ value: "running", label: "Running", count: 3 },
								{ value: "failed", label: "Failed", count: 1 },
							]}
						/>
						<Tabs defaultValue="agents">
							<TabsList>
								<TabsTrigger value="agents">Agents</TabsTrigger>
								<TabsTrigger value="workflows">Workflows</TabsTrigger>
								<TabsTrigger value="skills">Skills</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
				</Section>

				<Section id="status" title="Status">
					<div className="flex flex-wrap items-center gap-2.5">
						<StatusBadge tone="ok" />
						<StatusBadge tone="running" pulse />
						<StatusBadge tone="attention" />
						<StatusBadge tone="failing" />
						<StatusBadge tone="idle" />
						<StatusBadge tone="knowledge" />
						<span className="mx-2 h-4 w-px bg-border" />
						{(["ok", "running", "attention", "failing", "idle"] as const).map((t) => (
							<StatusDot key={t} tone={t} pulse={t === "running"} />
						))}
						<span className="mx-2 h-4 w-px bg-border" />
						<Badge>default</Badge>
						<Badge variant="secondary">secondary</Badge>
						<Badge variant="outline">outline</Badge>
						<Badge variant="destructive">destructive</Badge>
					</div>
				</Section>

				<Section id="brand" title="Brand · StrandMark">
					<div key={replay} className="flex items-end gap-10">
						<div className="flex flex-col items-center gap-2">
							<StrandMark size={96} state="draw" />
							<span className="text-caption text-ink-600">draw</span>
						</div>
						<div className="flex flex-col items-center gap-2">
							<StrandMark size={96} state="thinking" />
							<span className="text-caption text-ink-600">thinking</span>
						</div>
						<div className="flex flex-col items-center gap-2">
							<StrandMark size={96} />
							<span className="text-caption text-ink-600">idle</span>
						</div>
						<div className="flex flex-col items-center gap-2">
							<img src="/auth/spiral.png" alt="" style={{ height: 96 }} />
							<span className="text-caption text-ink-600">old PNG</span>
						</div>
						<div className="flex items-center gap-2 rounded-lg bg-sidebar px-4 py-3">
							<StrandMark size={22} />
							<span className="font-display text-[18px] font-semibold tracking-tight">Lumid Studio</span>
						</div>
						<div className="flex items-center gap-3">
							<StrandMark size={20} />
							<StrandMark size={16} state="thinking" />
						</div>
					</div>
				</Section>

				<Section id="avatars" title="Brand · StrandAvatar">
					<div className="grid grid-cols-8 gap-4">
						{SLUGS.map((s) => (
							<div key={s} className="flex flex-col items-center gap-1.5">
								<StrandAvatar slug={s} size={40} />
								<span className="w-full truncate text-center text-nano text-ink-600">{s}</span>
							</div>
						))}
					</div>
					<div className="mt-5 flex items-center gap-3">
						{SLUGS.slice(0, 8).map((s) => (
							<StrandAvatar key={s} slug={s} size={16} />
						))}
					</div>
				</Section>

				<Section id="scenes" title="Strands · scenes">
					<div key={replay} className="grid grid-cols-3 gap-5">
						{Object.entries(Scenes).map(([name, Scene]) => (
							<div key={name} className="flex flex-col items-center rounded-xl border border-border bg-card px-4 py-6 shadow-e1">
								<div className="w-40 text-ink-300">
									<Scene />
								</div>
								<span className="mt-2 text-caption text-ink-600">{name}</span>
							</div>
						))}
					</div>
				</Section>

				<Section id="states" title="States">
					<div className="grid grid-cols-2 gap-5">
						<EmptyState
							art={<Scenes.EmptyRuns />}
							title="No runs in this window"
							body="Runs appear here as your workflows execute. Widen the window, or start one now."
							actionLabel="Run a workflow"
							onAction={() => {}}
						/>
						<ErrorState
							error={{ message: "Request failed with status code 500", response: { status: 500 } }}
							what="your inbox"
							art={<Scenes.ErrorFrayed />}
							onRetry={() => {}}
						/>
						<EmptyState icon={Inbox} size="sm" title="All caught up" body="Drafts that need your review land here." />
						<div className="space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-e1">
							<Skeleton className="h-4 w-2/5" />
							<Skeleton className="h-3 w-4/5" />
							<Skeleton className="h-3 w-3/5" />
							<div className="flex items-center gap-2 pt-2">
								<span className="lumen-sweep inline-flex items-center gap-1.5 rounded-full border border-lagoon-200/70 bg-lagoon-50 px-2 py-0.5 text-micro font-medium text-lagoon-700">
									<span className="h-1.5 w-1.5 rounded-full bg-lagoon-500 animate-lumen-breathe" /> Running · step 3 of 7
								</span>
							</div>
						</div>
					</div>
				</Section>

				<Section id="data" title="Data">
					<div className="mb-5 grid grid-cols-4 gap-4">
						<StatTile label="Memories" value={1284} hint="across 9 agents" icon={Sparkles} />
						<StatTile label="Runs · 24h" value={312} hint="3 running" icon={Boxes} tone="running" />
						<StatTile label="Failing" value={2} tone="failing" hint="since 09:14" />
						<StatTile label="Tables" value={112} hint="14 schemas" icon={Database} />
					</div>
					<DataTable>
						<DTHead>
							<tr>
								<DTh>Workflow</DTh>
								<DTh>Status</DTh>
								<DTh align="right">Runs</DTh>
								<DTh align="right">p50</DTh>
								<DTh align="right">Updated</DTh>
							</tr>
						</DTHead>
						<tbody>
							{[
								["quant-research / backtest", "ok", 1204, "2.4s", "9m ago"],
								["mbb-consultant / score", "running", 88, "11.0s", "now"],
								["nl2sql / autoresearch", "attention", 342, "4.1s", "2h ago"],
								["venue-link-matcher / settle", "failing", 17, "—", "1d ago"],
							].map(([n, s, r, p, u]) => (
								<DTr key={n as string}>
									<DTd className="font-medium text-ink-900">{n}</DTd>
									<DTd>
										<StatusBadge tone={s as "ok"} />
									</DTd>
									<DTd align="right">{(r as number).toLocaleString()}</DTd>
									<DTd align="right">{p}</DTd>
									<DTd align="right" className="text-ink-600">
										{u}
									</DTd>
								</DTr>
							))}
						</tbody>
					</DataTable>
				</Section>
			</div>
		</div>
	);
}
