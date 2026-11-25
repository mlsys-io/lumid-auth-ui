// DataJobs — Studio → Data Warehouse → Jobs: the lum.id/data jobs entrance.
//
// Three questions, top to bottom:
//   • Your jobs     — what did I run, is it done, what happened? (drawer: events, Cancel)
//   • New job       — write the job (YAML), see WHERE it will run and HOW each
//                     source is reached before anything starts, then Run.
//   • Sources       — data I can use: mine, shared with me, public — grouped by
//                     the hub that holds it. Add one, share one.
//
// The design rule behind the plan card is the service's: data doesn't move,
// the job goes to the data. So the card leads with the site, and every source
// says in words how it is reached ("Same site", "Private link", "Public
// internet") — a chip, not a legend.
//
// Every payload goes through lib/data-jobs.ts normalisers first; nothing here
// maps over a raw response (reference_null_slice_blank_page).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	Check, ClipboardCopy, Database, Download, FileUp, Loader2, Plus, RotateCw, Search, Share2, Trash2, X,
} from "lucide-react";
import { dataJobs, JobsApiError } from "@/api/dataJobs";
import { fmtBytes } from "@/api/dataLake";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/relative-time";
import { RUN_STATUS_TONE } from "@/lib/runStatus";
import { cn } from "@/lib/utils";
import {
	STARTER_SPEC, addSourceToYaml, groupByHub, isTerminal, jobRunStatus, jobStatusLabel, routeChip, specFromYaml,
	specToYaml, type DataSource, type HubStatus, type Job, type JobEvent, type Plan, type SourceScope, type Visibility,
} from "@/lib/data-jobs";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SPEC_DRAFT_KEY = "studio_data_jobs_spec_draft";
// A native <select>, dressed like ui/Input (there is no Lumen select primitive
// that isn't a full Radix popover).
const SELECT_CLS =
	"h-9 w-full rounded-md border border-border bg-card px-3 text-body text-ink-900 shadow-e1 outline-none transition-[border-color,box-shadow] duration-120 hover:border-ink-300 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15";

function sizeText(bytes: number | null, kind = "exact"): string {
	if (bytes == null || kind === "unknown") return "size unknown";
	const b = fmtBytes(bytes);
	if (kind === "upper_bound") return `up to ${b}`;
	if (kind === "declared") return `about ${b}`;
	return b;
}

function hubName(id: string): string {
	if (!id) return "Unknown hub";
	return `${id.charAt(0).toUpperCase()}${id.slice(1)} hub`;
}

function SectionTitle({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-2 mb-3">
			<div className="min-w-0">
				<h2 className="text-title font-medium text-ink-900">{title}</h2>
				{sub && <p className="text-meta text-ink-600">{sub}</p>}
			</div>
			{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
		</div>
	);
}

/** Lists may carry `hubs:[{id, ok, error}]`; say which hub didn't answer. */
function HubNotice({ hubs }: { hubs: HubStatus[] }) {
	const down = hubs.filter((h) => !h.ok);
	if (!down.length) return null;
	return (
		<p role="status" className="mb-3 rounded-lg border border-ember-200/70 bg-ember-50 px-3 py-2 text-meta text-ember-700">
			{down.map((h) => hubName(h.id)).join(", ")} didn't answer, so {down.length === 1 ? "its" : "their"} items are missing below
			{down[0].error ? ` (${down[0].error})` : ""}.
		</p>
	);
}

// ── Your jobs ───────────────────────────────────────────────────────────────

function JobsList({ onOpen, reloadKey, onHubs }: { onOpen: (id: string) => void; reloadKey: number; onHubs: (h: HubStatus[]) => void }) {
	const [jobs, setJobs] = useState<Job[] | null>(null);
	const [hubs, setHubs] = useState<HubStatus[]>([]);
	const [err, setErr] = useState<unknown>(null);
	const load = useCallback(async () => {
		try {
			const r = await dataJobs.jobs({ limit: 50 });
			setJobs(r.jobs);
			setHubs(r.hubs);
			onHubs(r.hubs);
			setErr(null);
		} catch (e) {
			setErr(e);
		}
	}, [onHubs]);
	useEffect(() => { void load(); }, [load, reloadKey]);
	// Live while something is still going: re-read every 10 s, only while the
	// tab is visible.
	const live = !!jobs?.some((j) => !isTerminal(j.status));
	useEffect(() => {
		if (!live) return;
		const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10_000);
		return () => window.clearInterval(t);
	}, [live, load]);

	if (err && !jobs) {
		const off = err instanceof JobsApiError && err.status === 404;
		return off ? (
			<EmptyState size="sm" icon={Database} title="Jobs aren't switched on yet" body="lum.id/data hasn't enabled the jobs entrance. Your catalog and queries still work." />
		) : (
			<ErrorState size="sm" error={err} what="your jobs" onRetry={() => void load()} />
		);
	}
	if (!jobs) return <Skeleton className="h-24 rounded-xl" />;
	return (
		<div>
			<HubNotice hubs={hubs} />
			{jobs.length === 0 ? (
				<EmptyState size="sm" icon={Database} title="No jobs yet" body="Write one below: name the data it reads, check where it will run, then Run." />
			) : (
				<ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-e1">
					{jobs.map((j) => {
						const st = jobRunStatus(j.status);
						return (
							<li key={j.job_id}>
								<button
									type="button"
									onClick={() => onOpen(j.job_id)}
									className="w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left hover:bg-ink-50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-xl"
								>
									<span className="min-w-0 truncate text-body font-medium text-ink-900">{j.name || j.app || "Data job"}</span>
									<StatusBadge tone={RUN_STATUS_TONE[st]} label={jobStatusLabel(j.status)} pulse={st === "running"} />
									<span className="min-w-0 truncate text-caption text-ink-600">
										{j.app}{j.runtime ? ` · ${j.runtime}` : ""}{j.site ? ` · at ${j.site}` : ""} · {formatRelative(j.created_at)}
									</span>
									{j.error && st === "failed" && (
										<span className="col-span-2 min-w-0 truncate text-caption text-brick-700">{j.error}</span>
									)}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

/** Right-side drawer: one job, its sources and its events; Cancel. */
function JobDrawer({ jobId, onClose, onChanged }: { jobId: string | null; onClose: () => void; onChanged: () => void }) {
	const [job, setJob] = useState<Job | null>(null);
	const [events, setEvents] = useState<JobEvent[] | null>(null);
	const [err, setErr] = useState<unknown>(null);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const load = useCallback(async (id: string) => {
		try {
			const [j, ev] = await Promise.all([dataJobs.job(id), dataJobs.events(id).catch(() => [] as JobEvent[])]);
			setJob(j);
			setEvents(ev);
			setErr(null);
		} catch (e) {
			setErr(e);
		}
	}, []);
	useEffect(() => {
		setJob(null); setEvents(null); setErr(null); setConfirmCancel(false);
		if (jobId) void load(jobId);
	}, [jobId, load]);
	const live = !!job && !isTerminal(job.status);
	useEffect(() => {
		if (!jobId || !live) return;
		const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(jobId); }, 5_000);
		return () => window.clearInterval(t);
	}, [jobId, live, load]);

	const cancel = async () => {
		if (!jobId) return;
		setCancelling(true);
		try {
			const j = await dataJobs.cancel(jobId);
			if (j) setJob(j);
			toast.success("Job cancelled");
			setConfirmCancel(false);
			onChanged();
			void load(jobId);
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setCancelling(false);
		}
	};

	const st = job ? jobRunStatus(job.status) : "queued";
	return (
		<Dialog open={!!jobId} onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent
				className="top-0 left-auto right-0 h-full max-h-screen w-full max-w-full sm:max-w-md translate-x-0 translate-y-0 rounded-none sm:rounded-l-2xl content-start overflow-y-auto data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"
				aria-describedby={undefined}
			>
				<DialogHeader className="text-left pr-8">
					<DialogTitle className="text-title font-medium text-ink-900">{job ? job.name || job.app || "Data job" : "Job"}</DialogTitle>
					{job && (
						<div className="flex flex-wrap items-center gap-2">
							<StatusBadge tone={RUN_STATUS_TONE[st]} label={jobStatusLabel(job.status)} pulse={st === "running"} />
							<span className="text-caption text-ink-600">started {formatRelative(job.created_at)}</span>
						</div>
					)}
				</DialogHeader>
				{err ? (
					<ErrorState size="sm" error={err} what="this job" onRetry={() => jobId && void load(jobId)} />
				) : !job ? (
					<Skeleton className="h-40 rounded-xl" />
				) : (
					<div className="space-y-4">
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-meta">
							<dt className="text-ink-600">App</dt><dd className="text-ink-900 truncate">{job.app || "—"}</dd>
							<dt className="text-ink-600">Runs on</dt><dd className="text-ink-900">{job.runtime || "—"}</dd>
							<dt className="text-ink-600">Site</dt><dd className="text-ink-900">{job.site || "not placed yet"}</dd>
							<dt className="text-ink-600">Hub</dt><dd className="text-ink-900">{job.hub ? hubName(job.hub) : "—"}</dd>
							<dt className="text-ink-600">Job ID</dt><dd className="font-mono text-caption text-ink-700 break-all">{job.job_id}</dd>
						</dl>
						{job.error && (
							<p className="rounded-lg border border-brick-200/70 bg-brick-50 px-3 py-2 text-meta text-brick-700">{job.error}</p>
						)}
						{job.status === "planned" && (
							<p className="text-meta text-ink-600">Accepted and waiting for its runtime to pick it up.</p>
						)}
						<div>
							<h3 className="eyebrow mb-1.5">Data it reads</h3>
							{job.sources.length === 0 ? (
								<p className="text-meta text-ink-600">No sources recorded.</p>
							) : (
								<ul className="space-y-1.5">
									{job.sources.map((s) => {
										const chip = routeChip(s.via);
										return (
											<li key={`${s.ref}:${s.access}`} className="rounded-lg border border-border px-2.5 py-1.5">
												<div className="font-mono text-caption text-ink-800 break-all">{s.ref}</div>
												<div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-600">
													{s.via && <Badge variant={chip.tone} title={chip.hint}>{chip.label}</Badge>}
													<span>{s.access === "write" ? "writes" : "reads"}{s.site ? ` · at ${s.site}` : ""}</span>
													<span>
														{s.actual_bytes ? `${fmtBytes(s.actual_bytes)} moved` : s.est_bytes != null ? `${sizeText(s.est_bytes)} expected` : ""}
													</span>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</div>
						<div>
							<h3 className="eyebrow mb-1.5">What happened</h3>
							{!events ? (
								<Skeleton className="h-16 rounded-lg" />
							) : events.length === 0 ? (
								<p className="text-meta text-ink-600">Nothing recorded yet.</p>
							) : (
								<ol className="space-y-1.5 border-l border-border pl-3">
									{events.map((e) => (
										<li key={e.id} className="text-meta">
											<span className="text-ink-900">
												{e.status ? jobStatusLabel(e.status) : e.kind === "log" ? "Note" : e.kind || "Event"}
											</span>
											<span className="text-ink-600"> · {formatRelative(e.at)}</span>
											{e.message && <div className="text-ink-700 break-words">{e.message}</div>}
										</li>
									))}
								</ol>
							)}
						</div>
						{!isTerminal(job.status) && (
							<div className="pt-1">
								{confirmCancel ? (
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-meta text-ink-700">Cancel this job?</span>
										<Button size="sm" variant="destructive" onClick={() => void cancel()} disabled={cancelling}>
											{cancelling && <Loader2 className="animate-spin" />} Yes, cancel
										</Button>
										<Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>Keep it</Button>
									</div>
								) : (
									<Button size="sm" variant="secondary" onClick={() => setConfirmCancel(true)}>
										<X /> Cancel job
									</Button>
								)}
							</div>
						)}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ── New job: spec editor + plan card ────────────────────────────────────────

function readDraft(): string {
	try {
		return sessionStorage.getItem(SPEC_DRAFT_KEY) || specToYaml(STARTER_SPEC);
	} catch {
		return specToYaml(STARTER_SPEC);
	}
}

function PlanCard({ plan, onRun, running }: { plan: Plan; onRun: () => void; running: boolean }) {
	return (
		<section aria-label="Plan" className="animate-lumen-rise rounded-xl border border-border bg-card p-4 shadow-e1 space-y-3">
			{plan.placed ? (
				<div>
					<div className="text-body text-ink-900">
						Runs at <span className="font-medium">{plan.site}</span>
						{plan.runtime && <> on <span className="font-medium">{plan.runtime}</span></>}
					</div>
					<div className="text-caption text-ink-600">
						{plan.owningHub ? `Recorded on the ${hubName(plan.owningHub).toLowerCase()}` : ""}
						{plan.remoteBytes != null && plan.localBytes != null && (
							<>{plan.owningHub ? " · " : ""}{fmtBytes(plan.localBytes)} read where it runs, {fmtBytes(plan.remoteBytes)} over a network</>
						)}
					</div>
				</div>
			) : (
				<div className="rounded-lg border border-brick-200/70 bg-brick-50 px-3 py-2">
					<div className="text-body font-medium text-brick-700">No site can run this job</div>
					<div className="text-meta text-brick-700">See why below — change the sources or the runtime and check again.</div>
				</div>
			)}

			{plan.sources.length > 0 && (
				<ul className="space-y-1.5">
					{plan.sources.map((s, i) => {
						const chip = routeChip(s.via);
						return (
							<li key={`${s.ref}:${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border px-2.5 py-1.5">
								<span className="min-w-0 flex-1 font-mono text-caption text-ink-800 break-all">{s.ref}</span>
								<Badge variant={chip.tone} title={chip.hint}>{chip.label}</Badge>
								<span className="text-caption text-ink-600 tabular-nums">{sizeText(s.bytes, s.sizeKind)}</span>
							</li>
						);
					})}
				</ul>
			)}

			{plan.reasons.length > 0 && (
				<div>
					<h3 className="eyebrow mb-1">{plan.placed ? "Why here" : "Why not"}</h3>
					<ul className="list-disc pl-5 text-meta text-ink-700 space-y-0.5">
						{plan.reasons.map((r, i) => <li key={i}>{r.msg}</li>)}
					</ul>
				</div>
			)}
			{plan.alternatives.length > 0 && (
				<div>
					<h3 className="eyebrow mb-1">Other sites</h3>
					<ul className="text-meta text-ink-700 space-y-0.5">
						{plan.alternatives.map((a) => (
							<li key={a.site}>
								<span className="font-medium text-ink-900">{a.site}</span>
								{a.blocking.length ? ` — ${a.blocking.map((b) => b.msg).join("; ")}` : " — also possible"}
							</li>
						))}
					</ul>
				</div>
			)}

			{plan.placed && (
				<div className="flex flex-wrap items-center gap-3 pt-1">
					<Button variant="accent" onClick={onRun} disabled={running || !plan.planId}>
						{running ? <Loader2 className="animate-spin" /> : <Check />} Run
					</Button>
					<span className="text-caption text-ink-600">Runs exactly this plan. Plans stay valid for 15 minutes.</span>
				</div>
			)}
		</section>
	);
}

function NewJob({ text, setText, onStarted, hub }: { text: string; setText: (t: string) => void; onStarted: (id: string) => void; hub: string }) {
	const [plan, setPlan] = useState<Plan | null>(null);
	const [planErr, setPlanErr] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);
	const [starting, setStarting] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const parsed = useMemo(() => specFromYaml(text), [text]);
	// A plan is for the spec it was checked against; editing clears it.
	useEffect(() => { setPlan(null); setPlanErr(null); }, [text]);

	const check = async () => {
		if (!parsed.spec) return;
		setChecking(true);
		setPlanErr(null);
		try {
			const p = await dataJobs.plan(parsed.spec);
			// The plan names the site; the hub that records the job is the one
			// this entrance answers for (only `home` today).
			setPlan({ ...p, owningHub: p.owningHub || hub });
		} catch (e) {
			setPlanErr(errMsg(e));
		} finally {
			setChecking(false);
		}
	};
	const run = async () => {
		if (!plan?.planId) return;
		setStarting(true);
		try {
			const j = await dataJobs.runPlan(plan.planId);
			toast.success("Job started");
			setPlan(null);
			if (j) onStarted(j.job_id);
		} catch (e) {
			setPlanErr(errMsg(e));
		} finally {
			setStarting(false);
		}
	};
	const importFile = async (f: File | undefined) => {
		if (!f) return;
		if (f.size > 256 * 1024) return toast.error("That file is too big for a job spec (256 KB max).");
		setText(await f.text());
	};
	const download = () => {
		const name = (parsed.spec?.name || parsed.spec?.app || "job").replace(/[^A-Za-z0-9._-]+/g, "-");
		const url = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `${name}.yaml`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<input
					ref={fileRef}
					type="file"
					accept=".yaml,.yml,.json,application/yaml,application/json,text/yaml"
					className="hidden"
					onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }}
				/>
				<Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><FileUp /> Import YAML</Button>
				<Button size="sm" variant="secondary" onClick={download}><Download /> Download YAML</Button>
				<Button size="sm" variant="ghost" onClick={() => setText(specToYaml(STARTER_SPEC))}>Start over</Button>
			</div>
			<Label htmlFor="job-spec" className="sr-only">Job spec (YAML)</Label>
			<Textarea
				id="job-spec"
				value={text}
				onChange={(e) => setText(e.target.value)}
				spellCheck={false}
				rows={12}
				aria-invalid={parsed.errors.length > 0}
				className="font-mono text-caption leading-5 min-h-48"
			/>
			<p className="text-caption text-ink-600">
				<span className="font-medium text-ink-700">app</span> names your app, <span className="font-medium text-ink-700">runtime</span> is
				auto, flowmesh, lumilake or sandbox, and each <span className="font-medium text-ink-700">source</span> is a ref such as
				findata://schema.table or src://owner/name. <span className="font-medium text-ink-700">payload</span> is passed to the runtime as is.
			</p>
			{parsed.errors.length > 0 && (
				<ul role="alert" className="rounded-lg border border-brick-200/70 bg-brick-50 px-3 py-2 text-meta text-brick-700 list-disc pl-7">
					{parsed.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
				</ul>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button onClick={() => void check()} disabled={!parsed.spec || checking}>
					{checking && <Loader2 className="animate-spin" />} Check where it runs
				</Button>
				{!plan && !planErr && parsed.spec && <span className="text-caption text-ink-600">Nothing starts until you press Run on the plan.</span>}
			</div>
			{planErr && <p role="alert" className="rounded-lg border border-brick-200/70 bg-brick-50 px-3 py-2 text-meta text-brick-700">{planErr}</p>}
			{plan && <PlanCard plan={plan} onRun={() => void run()} running={starting} />}
		</div>
	);
}

// ── Sources ─────────────────────────────────────────────────────────────────

function CreateSourceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
	const [name, setName] = useState("");
	const [ref, setRef] = useState("");
	const [visibility, setVisibility] = useState<Visibility>("private");
	const [maxGb, setMaxGb] = useState("");
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	useEffect(() => { if (open) { setErr(null); } }, [open]);
	const nameOk = /^[A-Za-z0-9._-]{1,96}$/.test(name);
	const gb = maxGb.trim() ? Number(maxGb) : undefined;
	const gbOk = gb === undefined || (Number.isFinite(gb) && gb > 0);
	const save = async () => {
		setBusy(true);
		setErr(null);
		try {
			await dataJobs.createSource({
				name, ref: ref.trim(), visibility,
				max_bytes: gb ? Math.round(gb * 1024 ** 3) : undefined,
				description: description.trim() || undefined,
			});
			toast.success(`Source ${name} added`);
			setName(""); setRef(""); setMaxGb(""); setDescription(""); setVisibility("private");
			onOpenChange(false);
			onCreated();
		} catch (e) {
			setErr(errMsg(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-title font-medium text-ink-900">Add a source</DialogTitle>
					<DialogDescription className="text-meta text-ink-600">
						Give data you can already read a name, so your jobs — and anyone you share it with — can use it. The data stays where it is.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1">
						<Label htmlFor="src-name">Name</Label>
						<Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="daily-prices" aria-invalid={!!name && !nameOk} />
						{!!name && !nameOk && <p className="text-caption text-brick-700">Letters, digits, dot, dash or underscore.</p>}
					</div>
					<div className="space-y-1">
						<Label htmlFor="src-ref">Points at</Label>
						<Input id="src-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="findata://schema.table" className="font-mono" />
						<p className="text-caption text-ink-600">A table (findata://schema.table), a whole schema, or a blob folder (data://home/prefix/).</p>
					</div>
					<div className="space-y-1">
						<Label htmlFor="src-vis">Who can see it</Label>
						<select
							id="src-vis"
							value={visibility}
							onChange={(e) => setVisibility(e.target.value as Visibility)}
							className={SELECT_CLS}
						>
							<option value="private">Only me (until I share it)</option>
							<option value="shared">People I share it with</option>
							<option value="public">Everyone on lum.id</option>
						</select>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label htmlFor="src-max">Read limit (GB, optional)</Label>
							<Input id="src-max" inputMode="decimal" value={maxGb} onChange={(e) => setMaxGb(e.target.value)} aria-invalid={!gbOk} />
						</div>
						<div className="space-y-1">
							<Label htmlFor="src-desc">Note (optional)</Label>
							<Input id="src-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
						</div>
					</div>
					{err && <p role="alert" className="text-meta text-brick-700">{err}</p>}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
					<Button onClick={() => void save()} disabled={!nameOk || !ref.trim() || !gbOk || busy}>
						{busy && <Loader2 className="animate-spin" />} Add source
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ShareDialog({ source, onClose, myId }: { source: DataSource | null; onClose: () => void; myId: string }) {
	const [grantee, setGrantee] = useState("");
	const [access, setAccess] = useState<"read" | "write">("read");
	const [until, setUntil] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	useEffect(() => { setGrantee(""); setAccess("read"); setUntil(""); setErr(null); }, [source?.source_id]);
	const who = grantee.trim();
	// The service takes a lum.id user ID, not an email.
	const whoOk = /^[A-Za-z0-9._-]{1,128}$/.test(who) && who !== myId;
	const run = async (kind: "share" | "unshare") => {
		if (!source) return;
		setBusy(true);
		setErr(null);
		try {
			if (kind === "share") {
				const expires = until ? new Date(`${until}T23:59:59`).toISOString() : undefined;
				await dataJobs.share(source.source_id, { grantee: who, access, expires_at: expires });
				toast.success(`Shared ${source.name}`);
			} else {
				const r = (await dataJobs.unshare(source.source_id, who, access)) as { revoked?: boolean };
				toast.success(r?.revoked === false ? "They didn't have that access" : `Access removed from ${source.name}`);
			}
			onClose();
		} catch (e) {
			setErr(errMsg(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={!!source} onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-title font-medium text-ink-900">Share {source?.name}</DialogTitle>
					<DialogDescription className="text-meta text-ink-600">
						They can use it in their own jobs. The data doesn't move — their jobs go to it.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="space-y-1">
						<Label htmlFor="share-who">Their lum.id user ID</Label>
						<Input id="share-who" value={grantee} onChange={(e) => setGrantee(e.target.value)} className="font-mono" aria-invalid={!!who && !whoOk} />
						<p className="text-caption text-ink-600">
							{who && who === myId ? "That's you." : who.includes("@") ? "Use their user ID, not their email — they can copy it from this tab." : "They can copy it from the top of their Jobs tab."}
						</p>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label htmlFor="share-access">They can</Label>
							<select
								id="share-access"
								value={access}
								onChange={(e) => setAccess(e.target.value as "read" | "write")}
								className={SELECT_CLS}
							>
								<option value="read">Read it</option>
								<option value="write">Read and write it</option>
							</select>
						</div>
						<div className="space-y-1">
							<Label htmlFor="share-until">Until (optional)</Label>
							<Input id="share-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
						</div>
					</div>
					{err && <p role="alert" className="text-meta text-brick-700">{err}</p>}
				</div>
				<DialogFooter className="sm:justify-between">
					<Button variant="ghost" size="sm" onClick={() => void run("unshare")} disabled={!whoOk || busy}>
						Remove their access
					</Button>
					<Button onClick={() => void run("share")} disabled={!whoOk || busy}>
						{busy && <Loader2 className="animate-spin" />} <Share2 /> Share
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const SCOPES: { value: SourceScope; label: string }[] = [
	{ value: "mine", label: "Mine" },
	{ value: "shared", label: "Shared with me" },
	{ value: "public", label: "Public" },
];

function SourcesPanel({ onUse, myId }: { onUse: (ref: string) => void; myId: string }) {
	const [scope, setScope] = useState<SourceScope>("mine");
	const [q, setQ] = useState("");
	const [query, setQuery] = useState("");
	const [data, setData] = useState<{ sources: DataSource[]; hubs: HubStatus[] } | null>(null);
	const [err, setErr] = useState<unknown>(null);
	const [creating, setCreating] = useState(false);
	const [sharing, setSharing] = useState<DataSource | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const reqId = useRef(0);
	const load = useCallback(async () => {
		const mine = ++reqId.current;
		setErr(null);
		try {
			const r = await dataJobs.sources(scope, query);
			if (mine === reqId.current) setData(r);
		} catch (e) {
			if (mine === reqId.current) { setErr(e); setData(null); }
		}
	}, [scope, query]);
	useEffect(() => { setData(null); void load(); }, [load]);
	// Search as you type, without a request per keystroke.
	useEffect(() => { const t = window.setTimeout(() => setQuery(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);

	const remove = async (s: DataSource) => {
		try {
			await dataJobs.deleteSource(s.source_id);
			toast.success(`Deleted ${s.name}`);
			setConfirmDelete(null);
			void load();
		} catch (e) {
			toast.error(errMsg(e));
		}
	};

	const groups = groupByHub(data?.sources ?? []);
	const emptyCopy: Record<SourceScope, { title: string; body: string }> = {
		mine: { title: "You haven't added a source", body: "Add one to name data you can read, use it in jobs, and share it." },
		shared: { title: "Nothing shared with you yet", body: "When someone shares a source with your user ID, it shows up here." },
		public: { title: "No public sources", body: "Sources their owners made public show up here." },
	};

	return (
		<div>
			<div className="flex flex-wrap items-center gap-2 mb-3">
				<Segmented size="sm" aria-label="Which sources" value={scope} onChange={setScope} options={SCOPES} />
				<div className="relative flex-1 min-w-40">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-500" aria-hidden />
					<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or ref" aria-label="Find a source" className="h-8 pl-8 text-meta" />
				</div>
				<Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus /> Add a source</Button>
			</div>
			{data && <HubNotice hubs={data.hubs} />}
			{err ? (
				<ErrorState size="sm" error={err} what="sources" onRetry={() => void load()} />
			) : !data ? (
				<Skeleton className="h-24 rounded-xl" />
			) : groups.length === 0 ? (
				<EmptyState
					size="sm"
					icon={Database}
					title={query ? `Nothing matches "${query}"` : emptyCopy[scope].title}
					body={query ? "Try another word, or clear the search." : emptyCopy[scope].body}
					actionLabel={scope === "mine" && !query ? "Add a source" : undefined}
					onAction={scope === "mine" && !query ? () => setCreating(true) : undefined}
				/>
			) : (
				<div className="space-y-4">
					{groups.map((g) => (
						<div key={g.hub}>
							<h3 className="eyebrow mb-1.5">{hubName(g.hub)}</h3>
							<ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-e1">
								{g.sources.map((s) => {
									const own = !!myId && s.owner === myId;
									return (
										<li key={s.source_id} className="px-3 py-2.5">
											<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
												<span className="min-w-0 truncate text-body font-medium text-ink-900">{s.name}</span>
												<Badge variant={s.visibility === "public" ? "knowledge" : s.visibility === "shared" ? "running" : "idle"}>
													{s.visibility === "public" ? "Public" : s.visibility === "shared" ? "Shared" : "Only you"}
												</Badge>
												{s.size_bytes_est != null && <span className="text-caption text-ink-600 tabular-nums">{fmtBytes(s.size_bytes_est)}</span>}
											</div>
											<div className="font-mono text-caption text-ink-700 break-all">{s.ref || `src://${s.source_id}`}</div>
											{s.description && <div className="text-caption text-ink-600">{s.description}</div>}
											{!own && s.owner && <div className="text-caption text-ink-600">from {s.owner === "system" ? "Lumid" : s.owner}</div>}
											<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
												<Button size="sm" variant="secondary" onClick={() => onUse(`src://${s.source_id}`)}>Use in a job</Button>
												{own && (
													<>
														<Button size="sm" variant="ghost" onClick={() => setSharing(s)}><Share2 /> Share</Button>
														{confirmDelete === s.source_id ? (
															<>
																<span className="text-caption text-ink-700">Delete it? Jobs using it will stop.</span>
																<Button size="sm" variant="destructive" onClick={() => void remove(s)}>Delete</Button>
																<Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Keep</Button>
															</>
														) : (
															<Button size="sm" variant="ghost" onClick={() => setConfirmDelete(s.source_id)} aria-label={`Delete ${s.name}`}>
																<Trash2 /> Delete
															</Button>
														)}
													</>
												)}
											</div>
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</div>
			)}
			<CreateSourceDialog open={creating} onOpenChange={setCreating} onCreated={() => { setScope("mine"); void load(); }} />
			<ShareDialog source={sharing} onClose={() => { setSharing(null); void load(); }} myId={myId} />
		</div>
	);
}

// ── the tab ─────────────────────────────────────────────────────────────────

export default function DataJobs({ jobId, onJobChange, initialSource, onSourceUsed }: {
	jobId: string | null;
	onJobChange: (id: string | null) => void;
	/** A source ref to add to the new-job spec on arrival (the Catalog's "Start a job with it"). */
	initialSource?: string | null;
	onSourceUsed?: () => void;
}) {
	const { user } = useAuth();
	const myId = user?.id != null ? String(user.id) : "";
	const [text, setTextState] = useState(readDraft);
	const [reloadKey, setReloadKey] = useState(0);
	const [hub, setHub] = useState("");
	const onHubs = useCallback((h: HubStatus[]) => setHub(h.find((x) => x.ok)?.id ?? ""), []);
	const setText = (t: string) => {
		setTextState(t);
		try { sessionStorage.setItem(SPEC_DRAFT_KEY, t); } catch { /* private mode */ }
	};
	const editorRef = useRef<HTMLDivElement>(null);
	const addSource = (ref: string) => {
		const next = addSourceToYaml(text, ref);
		if (next === text) {
			toast.message(specFromYaml(text).errors.some((e) => e.startsWith("Not valid YAML")) ? "Fix the YAML first, then add the source." : "Already in the job.");
			return;
		}
		setText(next);
		editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		toast.success("Added to the job");
	};
	const copyId = () => {
		navigator.clipboard?.writeText(myId).then(() => toast.success("User ID copied"), () => toast.error("Couldn't copy"));
	};

	// Arriving from the Catalog with ?source=: put that table in the spec once.
	const usedSource = useRef<string | null>(null);
	useEffect(() => {
		if (!initialSource || usedSource.current === initialSource) return;
		usedSource.current = initialSource;
		addSource(initialSource);
		onSourceUsed?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialSource]);

	return (
		<div className="h-full overflow-y-auto pr-1 pb-8">
			<p className="mb-5 max-w-3xl text-meta text-ink-600">
				Run work where the data already is. Name the data a job reads, check which site it will run at and how each source is
				reached, then Run. Nothing is copied to you.
				{myId && (
					<span className="ml-1 inline-flex items-center gap-1 whitespace-nowrap">
						Your user ID <code className="font-mono text-caption text-ink-800">{myId}</code>
						<button type="button" onClick={copyId} aria-label="Copy your user ID" className="text-ink-500 hover:text-ink-900">
							<ClipboardCopy className="w-3.5 h-3.5" />
						</button>
					</span>
				)}
			</p>

			<section className="mb-8">
				<SectionTitle
					title="Your jobs"
					actions={<Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)}><RotateCw /> Refresh</Button>}
				/>
				<JobsList onOpen={(id) => onJobChange(id)} reloadKey={reloadKey} onHubs={onHubs} />
			</section>

			<div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
				<section ref={editorRef} className="min-w-0 scroll-mt-4">
					<SectionTitle title="New job" sub="Write it here or import a YAML file." />
					<NewJob
						text={text}
						setText={setText}
						hub={hub}
						onStarted={(id) => { setReloadKey((k) => k + 1); onJobChange(id); }}
					/>
				</section>
				<section className="min-w-0">
					<SectionTitle title="Sources" sub="Data you can use in a job, by the hub that holds it." />
					<SourcesPanel onUse={addSource} myId={myId} />
				</section>
			</div>

			<JobDrawer jobId={jobId} onClose={() => onJobChange(null)} onChanged={() => setReloadKey((k) => k + 1)} />
		</div>
	);
}
