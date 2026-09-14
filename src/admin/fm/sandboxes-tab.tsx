// Sandboxes — a shell on the fleet, with your files still there next time.
//
// Not admin-gated, and the tab is the same shape as ssh-tab/fleet-tab for that
// reason: `home` is the site anyone may use, so a non-admin sees home and only
// home, while an admin fans out across every site. sandbox-control scopes
// everything to the caller's own identity (own namespace, own quota, own keys,
// own home), so this needs no gate of its own — hiding the tab would only hide a
// user's own work from them.
//
// ---------------------------------------------------------------------------
// TWO SOURCES, ONE LIST.
// ---------------------------------------------------------------------------
// A shell on home/office/NUS is a k8s pod from sandbox-control. A shell on
// `vast` is a FlowMesh SSH task read from `latest_update.ssh` — vast rents boxes
// by the hour and runs no k8s sandbox-control at all. Those are two mechanisms
// and one concept, so both normalise to ComputeShell (api/sandboxes.ts) and land
// in the same table. A user should not have to learn which plumbing produced
// their shell.
//
// Only `vast` is polled for SSH tasks, deliberately. `/fm/<site>/api/v1/tasks`
// is the ONLY tasks path and it has no server-side filter — office's list alone
// is 13.8 MB because every row embeds its full raw_yaml. Polling that here every
// 20s to find shells that are not there would be the most expensive request in
// the app. The sites that serve shells through FlowMesh are the sites listed
// below; everywhere else a shell is a sandbox.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	PUBLIC_SANDBOX_SITE,
	SANDBOX_SITES,
	USER_SANDBOX_SITES,
	createDataset,
	createSandbox,
	deleteDataset,
	deleteSandbox,
	dataSourcesForSite,
	datasetsForSite,
	datasetsWritableForSite,
	listDatasets,
	portPoolForSite,
	gpuProfileForSite,
	imagesForSite,
	isSshTaskActive,
	listSandboxesForSite,
	sandboxToShell,
	sshCommandForSite,
	sshTaskToShell,
	syncKeys,
	uploadDatasetFile,
	type ComputeShell,
	type DatasetEntry,
	type DatasetLimits,
	type Sandbox,
} from "../../api/sandboxes";
import { fanoutForSites, listTasksForSite, type FmFanout, type FmTask } from "../../api/fm";
import { deleteSshKey, listSshKeys, uploadSshKey, type SshKey } from "../../api/ssh-keys";
import { SiteBadge, SiteStrip, TabShell, useFanout } from "./shared";
import { PUBLIC_SITE } from "./fleet-tab";

/** Sites whose shells come from FlowMesh rather than sandbox-control. Admin-only:
 *  vast bills by the hour, which is exactly why it is not on the public tier. */
const SSH_TASK_SITES = ["vast"];

const EMPTY: FmFanout<FmTask> = { items: [], sites: [] };

/** Sentinel for "I'll type my own" -- a real ref can never collide with it. */
const CUSTOM_IMAGE = "__custom__";

/** "NVIDIA RTX PRO 4000 Blackwell SFF Edition" -> "RTX PRO 4000 Blackwell".
 *  Same rule fleet-tab applies: the vendor prefix and the marketing suffixes
 *  never distinguish two cards in this fleet, and this sits inline in a form row. */
function shortGpu(name: string): string {
	return name
		.replace(/^NVIDIA\s+/i, "")
		.replace(/\s+(SFF\s+)?Edition$/i, "")
		.replace(/\s+Generation$/i, "")
		.replace(/^GeForce\s+/i, "")
		.trim();
}

/** Live first — a running shell is the only row anyone is looking for. */
function isLive(r: ComputeShell): boolean {
	if (r.kind === "sandbox") return r.state === "Running" || r.state === "Queued" || r.state === "Pending";
	return ["RUNNING", "DISPATCHED", "PENDING", "QUEUED"].includes(r.state);
}

function StatePill({ r }: { r: ComputeShell }) {
	const s = r.state;
	const tone =
		s === "Running" || s === "RUNNING" || s === "DISPATCHED" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
		: s === "Queued" || s === "QUEUED" || s === "Pending" || s === "PENDING" ? "bg-amber-50 text-amber-700 border-amber-200"
		: s === "Failed" || s === "FAILED" ? "bg-rose-50 text-rose-700 border-rose-200"
		// Terminating is its own state, not a failure: the user asked for this and
		// it takes ~30s. Muted rather than red so it does not read as an error.
		: s === "Terminating" ? "bg-slate-100 text-slate-500 border-slate-200"
		: "bg-slate-50 text-slate-600 border-slate-200";
	return (
		<span className={`rounded border px-1.5 py-0.5 text-xs ${tone}`} title={r.detail ?? undefined}>
			{s}
		</span>
	);
}

function fmtBytes(n?: number): string {
	if (!n) return "—";
	const u = ["B", "KB", "MB", "GB", "TB"];
	let i = 0, v = n;
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function expiresIn(ms: number | null): string {
	if (ms === null) return "—";
	const secs = Math.floor((ms - Date.now()) / 1000);
	if (secs <= 0) return "expired";
	const h = Math.floor(secs / 3600);
	return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(secs / 60))}m`;
}

export default function SandboxesTab({ isAdmin }: { isAdmin: boolean }) {
	// office is user-tier now; the GPU reservation is enforced in sandbox-control,
	// not by hiding the site. NUS stays admin-only.
	const sites = isAdmin ? SANDBOX_SITES : USER_SANDBOX_SITES;
	const [target, setTarget] = useState(PUBLIC_SANDBOX_SITE);
	const [busy, setBusy] = useState(false);
	// The create form lives in a dialog. It has grown to eight controls, and as a
	// permanently-open panel it pushed the thing people actually come here for --
	// the list of their running sandboxes -- below the fold. Creating is
	// occasional; looking is constant.
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("dev");
	const [gpu, setGpu] = useState(0);
	const [ttl, setTtl] = useState(8);
	// "" means "let the site choose". Kept distinct from a concrete ref so the default
	// stays the SERVER's to change -- baking today's default in here is how a UI starts
	// contradicting the service it talks to.
	// Attached data sources. NOT a dataset mount: selecting one injects the env a
	// client needs to reach a live store, so the sandbox queries in place and
	// copies nothing. Empty by default -- attaching is a deliberate act.
	const [sources, setSources] = useState<string[]>([]);
	// Container ports to publish on a real public TCP port. Empty by default:
	// every claim spends a shared, capped load-balancer frontend, so publishing
	// is a deliberate act rather than something a default turns on.
	const [ports, setPorts] = useState<string[]>([]);
	const [image, setImage] = useState("");
	const [customImage, setCustomImage] = useState("");
	// SSH keys live here, not only in account settings. Without a key the whole
	// tab is decorative: you can create a sandbox and then cannot get into it,
	// which is exactly the dead end it produced in practice -- the gateway
	// answers, offers its host key, and refuses with `Permission denied
	// (publickey)`, which reads like a broken gateway rather than a missing key.
	const [keys, setKeys] = useState<SshKey[] | null>(null);
	const [keysOpen, setKeysOpen] = useState(false);
	const [newKey, setNewKey] = useState("");
	const [newKeyTitle, setNewKeyTitle] = useState("");
	const [keyBusy, setKeyBusy] = useState(false);

	// DATASETS ARE MANAGEABLE HERE, not only listable. `/datasets` is mounted
	// read-only inside every sandbox and stays that way -- one `rm -rf` in one box
	// must not be able to destroy a corpus every other box depends on -- so the
	// write path goes through sandbox-control, which holds the only writable
	// handle to the shared tier. Before this, publishing meant having NAS root,
	// and the documented route was "ask an operator".
	const [dsOpen, setDsOpen] = useState(false);
	const [dsBusy, setDsBusy] = useState(false);
	const [dsName, setDsName] = useState("");
	const [dsNote, setDsNote] = useState("");
	// Which dataset a file picker is currently aimed at. One ref for the whole
	// list: a hidden input per row is a lot of DOM for a button most rows never
	// get.
	const [dsUploadTo, setDsUploadTo] = useState("");
	const [dsLimits, setDsLimits] = useState<DatasetLimits | null>(null);
	const dsFileRef = useRef<HTMLInputElement | null>(null);
	// Bumped after every mutation so the render reads the refreshed module cache.
	// The 20 s sandbox poll also refills it, but waiting out a poll to see the
	// thing you just uploaded reads as a failed upload.
	const [dsTick, setDsTick] = useState(0);

	const reloadDatasets = useCallback(async () => {
		try {
			const r = await listDatasets(target);
			setDsLimits(r.limits ?? null);
		} catch {
			// A site with no dataset tier answers 404/501 here. Not an error worth
			// showing: the panel simply has nothing to manage.
		}
		setDsTick((v) => v + 1);
	}, [target]);

	// Re-read when the site changes: datasets are per-site and NOT replicated, so
	// office's list is a different shelf from home's.
	useEffect(() => { if (dsOpen) void reloadDatasets(); }, [dsOpen, reloadDatasets]);

	async function onCreateDataset() {
		const n = dsName.trim().toLowerCase();
		if (!n) return;
		setDsBusy(true);
		try {
			await createDataset(target, n, dsNote.trim());
			setDsName(""); setDsNote("");
			await reloadDatasets();
			toast.success(`published ${n} on ${target}`);
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? `could not publish ${n}`);
		} finally {
			setDsBusy(false);
		}
	}

	async function onUploadDatasetFiles(files: FileList | null) {
		if (!files?.length || !dsUploadTo) return;
		const into = dsUploadTo;
		setDsBusy(true);
		try {
			// Sequential, not parallel: these go to one NFS export through one pod,
			// and a fan-out of large PUTs buys nothing but a less legible failure.
			for (const f of Array.from(files)) {
				await uploadDatasetFile(target, into, f.name, f);
			}
			await reloadDatasets();
			toast.success(`uploaded ${files.length} file(s) to ${into}`);
		} catch (e: any) {
			// A partial batch is possible and the message must not imply otherwise.
			toast.error(e?.response?.data?.detail ?? `upload to ${into} failed — some files may have landed`);
		} finally {
			setDsBusy(false);
			setDsUploadTo("");
			if (dsFileRef.current) dsFileRef.current.value = "";
		}
	}

	async function onDeleteDataset(d: DatasetEntry) {
		// Type-the-name, not a yes/no. This deletes files on a SHARED export that
		// has no snapshot and no undo, and the cost of a misclick is somebody
		// else's corpus.
		const typed = window.prompt(
			`Delete dataset "${d.name}" and its ${d.files ?? 0} file(s) from ${target}? `
			+ "This cannot be undone. Type the name to confirm:");
		if (typed?.trim() !== d.name) return;
		setDsBusy(true);
		try {
			await deleteDataset(target, d.name);
			await reloadDatasets();
			toast.success(`deleted ${d.name}`);
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? `could not delete ${d.name}`);
		} finally {
			setDsBusy(false);
		}
	}

	const loadKeys = useCallback(async () => {
		try { setKeys(await listSshKeys()); } catch { setKeys([]); }
	}, []);
	useEffect(() => { void loadKeys(); }, [loadKeys]);

	async function onAddKey() {
		const pub = newKey.trim();
		// Validate here rather than letting identity 400: the paste is usually
		// either a private key by mistake or a path, and both deserve a specific
		// message instead of "bad request".
		if (pub.startsWith("-----BEGIN")) {
			toast.error("That is a PRIVATE key. Paste the .pub file instead — it starts with ssh-ed25519 or ssh-rsa.");
			return;
		}
		if (!/^(ssh-(rsa|ed25519|dss)|ecdsa-[a-z0-9-]+)\s+\S+/.test(pub)) {
			toast.error("Not a public key. Run: cat ~/.ssh/id_ed25519.pub");
			return;
		}
		setKeyBusy(true);
		try {
			// Default the title to the key's own trailing comment (user@host),
			// which is what people recognise, before falling back to a date.
			const comment = pub.split(/\s+/)[2] ?? "";
			await uploadSshKey({ title: newKeyTitle.trim() || comment || `key-${new Date().toISOString().slice(0, 10)}`, public_key: pub });
			setNewKey(""); setNewKeyTitle("");
			await loadKeys();
			// Upload alone does NOT let you in -- the key still has to reach this
			// site's gateway. Syncing here makes "added" mean "works".
			await syncKeys(target);
			toast.success(`Key added and synced to ${target} — try your ssh command now`);
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? "could not add that key");
		} finally { setKeyBusy(false); }
	}

	async function onDeleteKey(k: SshKey) {
		if (!confirm(`Delete SSH key "${k.title}"?\n\nAny machine using it loses access to your sandboxes.`)) return;
		try {
			await deleteSshKey(k.id);
			await loadKeys();
			await syncKeys(target);
			toast.success("key removed");
		} catch { toast.error("could not remove that key"); }
	}

	const boxes = useFanout<Sandbox>(() => fanoutForSites(sites, listSandboxesForSite), 20_000);
	const shells = useFanout<FmTask>(
		() => (isAdmin ? fanoutForSites(SSH_TASK_SITES, listTasksForSite) : Promise.resolve(EMPTY)),
		20_000,
	);

	const refresh = useCallback(() => {
		boxes.refresh();
		shells.refresh();
	}, [boxes, shells]);

	const rows = useMemo(() => {
		// A task list is history as well as state, so filter BEFORE mapping: only
		// sessions that could still be connected to belong beside a live sandbox.
		const live = (shells.data?.items ?? []).filter((t) => t.task_type === "ssh" && isSshTaskActive(t));
		const merged = [
			...(boxes.data?.items ?? []).map(sandboxToShell),
			...live.map(sshTaskToShell),
		];
		return merged.sort((a, b) => {
			const d = Number(isLive(b)) - Number(isLive(a));
			if (d !== 0) return d;
			return (a.site + a.name).localeCompare(b.site + b.name);
		});
	}, [boxes.data, shells.data]);

	// One strip over both sources: a site that did not answer must be VISIBLE as
	// unanswered, or an empty table and a 403 look identical.
	const siteStatus = useMemo(
		() => [...(boxes.data?.sites ?? []), ...(shells.data?.sites ?? [])],
		[boxes.data, shells.data],
	);

	// Read from the site envelope, NOT from a row: someone with no sandboxes is exactly the
	// person choosing what to rent, and rows are empty for them.
	const gpuInfo = gpuProfileForSite(target);
	const gpusFree = gpuInfo?.gpus_free
		|| ((boxes.data?.items ?? []).find((s) => s.site === target)?.gpus_free ?? "");

	// THE SELECTOR MUST NOT OFFER WHAT CANNOT BE SCHEDULED.
	// A sandbox is one Pod on one node, so the ceiling is max(per-node GPUs) — at home that is
	// 1, against a site total of 4. Offering "2" produced a pod that sat unschedulable forever
	// while the strip cheerfully read "4/4 GPUs free". Until a site answers with a profile we
	// fall back to 1, which is the only count every GPU site is known to satisfy.
	const maxGpu = gpuInfo ? gpuInfo.max_per_sandbox : 1;
	const gpuOptions = Array.from({ length: maxGpu + 1 }, (_, i) => i);

	// Clamp a stale selection when the user switches to a site with a lower ceiling, or the
	// request goes out asking for a GPU count this site can never place.
	useEffect(() => {
		if (gpu > maxGpu) setGpu(maxGpu);
	}, [maxGpu, gpu]);

	// The catalog is served per-site (see imagesForSite). Offer only entries matching the
	// CPU/GPU choice: a CUDA image on a CPU sandbox is several GB of pull for libraries that
	// cannot be used, and a slim CPU image on a GPU box has no CUDA runtime in it at all.
	const pool = portPoolForSite(target);
	// Only real, in-range, de-duplicated numbers reach the request. sandbox-control
	// validates all of this again — it has to, since the pool is shared — but
	// refusing here keeps a typo from costing a create round-trip.
	const wantedPorts = Array.from(new Set(
		ports.map((p) => Number.parseInt(p, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 65535)));
	const siteSources = dataSourcesForSite(target);
	const siteDatasets = datasetsForSite(target);
	const siteImages = imagesForSite(target);
	const imageChoices = (siteImages?.catalog ?? []).filter((c) => Boolean(c.gpu) === gpu > 0);
	const siteDefaultImage = gpu > 0 ? siteImages?.default_gpu : siteImages?.default_cpu;

	// Switching between CPU and GPU invalidates the selection -- the chosen ref is, by the
	// filter above, the wrong kind now. Fall back to the site default rather than silently
	// sending a CUDA image to a CPU sandbox.
	useEffect(() => {
		if (image && image !== CUSTOM_IMAGE && !imageChoices.some((c) => c.ref === image)) setImage("");
	}, [gpu, image, imageChoices]);

	// Rendered beside the GPUs field and NOWHERE ELSE. It was also in the subtitle,
	// so the same 41-char model name appeared twice on one screen -- added here
	// earlier today, and the reason this tab read as cluttered.
	const gpuLabel = gpuInfo?.model
		? `${shortGpu(gpuInfo.model)}${gpuInfo.memory_gb ? ` · ${gpuInfo.memory_gb} GB` : ""}`
		: gpuInfo?.models?.length
			? `${gpuInfo.models.length} GPU types`
			: "";

	async function onCreate() {
		setBusy(true);
		try {
			const chosen = image === CUSTOM_IMAGE ? customImage.trim() : image;
			// Omit the field entirely when empty: sandbox-control reads "absent" as
			// "use this site's default", and an empty string is not the same thing.
			await createSandbox(target, {
				name, gpu, ttl_hours: ttl, image: chosen || undefined,
				data_sources: sources.length ? sources : undefined,
				// Blank boxes are not zeros. Filtered here so an untouched second
				// field never becomes a request to publish port 0.
				ports: wantedPorts.length ? wantedPorts : undefined,
			});
			toast.success(`creating ${name} on ${target}`);
			// Close only on SUCCESS. A failed create keeps the dialog open with the
			// values still in it -- the common failures here (name taken, pool full,
			// GPU refused) are ones you fix by changing one field, and dropping the
			// form would make the user retype everything to act on the message.
			setCreateOpen(false);
			boxes.refresh();
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? `could not create the sandbox on ${target}`);
		} finally { setBusy(false); }
	}

	async function onDelete(r: ComputeShell) {
		// Say what is NOT destroyed. Deleting a container people have files in is
		// exactly where a confirmation should state the blast radius.
		if (!confirm(`Delete sandbox "${r.name}" on ${r.site}?\n\nYour /home is kept — only the container goes.`)) return;
		try {
			await deleteSandbox(r.site, r.name);
			toast.success(`deleted ${r.name} — your home is kept`);
			boxes.refresh();
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? "could not delete");
		}
	}


	const connectHint = sshCommandForSite(target);

	return (
		<TabShell
			subtitle={`A shell with a home directory that outlives the container.${
				isAdmin ? " Every site." : " On home."
			}${gpusFree ? ` ${gpusFree} GPUs free on ${target}.` : ""}${
				// State the ceiling wherever it is below the site total, because "4 free" and
				// "at most 1 per sandbox" are both true at home and only the pair is useful.
				gpuInfo && gpuInfo.max_per_sandbox < gpuInfo.total
					? ` Up to ${gpuInfo.max_per_sandbox} per sandbox — they sit one per machine.`
					: ""
			} Refreshes every 20s.`}
			loading={boxes.loading || shells.loading}
			error={boxes.error ?? shells.error}
			onRefresh={refresh}
		>
			<SiteStrip sites={siteStatus} />

			<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
				{/* Toolbar. SSH keys and Datasets deliberately stay OUT of the create
				    dialog: you need a key BEFORE creating anything, and a user with no
				    key is exactly who must not have that control hidden behind a
				    button labelled "New sandbox". */}
				<div className="flex flex-wrap items-center gap-2">
					<button onClick={() => setCreateOpen(true)}
						className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
						New sandbox
					</button>
					<button onClick={() => setDsOpen((v) => !v)}
						title={`Publish, add to or remove file datasets on ${target} — mounted read-only at /datasets in every sandbox there`}
						className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
						{siteDatasets.length ? `Datasets · ${siteDatasets.length}` : "Datasets"}
					</button>
					<button onClick={() => setKeysOpen((v) => !v)}
						title="Add or remove the SSH keys that let you into your sandboxes"
						className={`rounded-md border px-3 py-1.5 text-sm ${
							keys && keys.length === 0
								? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
								: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
						}`}>
						{keys === null ? "SSH keys" : keys.length === 0 ? "No SSH keys — add one" : `SSH keys · ${keys.length}`}
					</button>
				</div>

				{createOpen && (
				<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
					onClick={() => setCreateOpen(false)}>
				<div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
					onClick={(e) => e.stopPropagation()}>
				<div className="mb-3 flex items-center justify-between">
					<h3 className="text-sm font-medium text-slate-800">New sandbox on {target}</h3>
					<button onClick={() => setCreateOpen(false)}
						className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
				</div>
				<div className="flex flex-wrap items-end gap-3">
					{/* Shown whenever the caller has more than one site to choose from --
					    NOT gated on isAdmin. It used to be `isAdmin &&`, with the reason
					    "a non-admin has exactly one". That stopped being true when nginx
					    v67 moved office out of the admin-gated /sbx/ regex: a plain user
					    now has home AND office (USER_SANDBOX_SITES), so the gate hid the
					    only control that reaches office's RTX 5080s and left them stuck
					    on home with no way to say otherwise.

					    Options come from `sites`, not SANDBOX_SITES: the latter includes
					    NUS, which is deliberately admin-only (USER_GPU_QUOTA=0), and
					    offering a site the caller cannot use is worse than hiding it. */}
					{sites.length > 1 && (
						<label className="text-xs text-slate-600">
							Site
							<select value={target} onChange={(e) => setTarget(e.target.value)}
								className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm">
								{sites.map((s) => <option key={s} value={s}>{s}</option>)}
							</select>
						</label>
					)}
					<label className="text-xs text-slate-600">
						Name
						<input value={name} onChange={(e) => setName(e.target.value)}
							className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
					</label>
					<label className="text-xs text-slate-600">
						GPUs{gpuLabel ? <span className="ml-1 text-slate-400">{gpuLabel}</span> : null}
						<select value={gpu} onChange={(e) => setGpu(Number(e.target.value))}
							className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm">
							{gpuOptions.map((n) => (
								<option key={n} value={n}>{n === 0 ? "none" : n}</option>
							))}
						</select>
					</label>
					<label className="text-xs text-slate-600">
						Image
						<select value={image} onChange={(e) => setImage(e.target.value)}
							className="mt-1 block max-w-[17rem] rounded-md border border-slate-300 px-2 py-1 text-sm">
							{/* Name the default rather than showing a blank: "site default" alone
							    tells the user nothing about what they are about to boot. */}
							<option value="">
								{siteDefaultImage ? `site default — ${siteDefaultImage}` : "site default"}
							</option>
							{imageChoices.map((c) => (
								<option key={c.ref} value={c.ref} title={c.note ?? c.ref}>
									{c.label ?? c.ref}
								</option>
							))}
							<option value={CUSTOM_IMAGE}>custom…</option>
						</select>
					</label>
					{image === CUSTOM_IMAGE && (
						<label className="text-xs text-slate-600">
							Image ref
							<input value={customImage} onChange={(e) => setCustomImage(e.target.value)}
								placeholder="harbor.lum.id/sandbox/name:tag"
								className="mt-1 block w-72 rounded-md border border-slate-300 px-2 py-1 text-sm font-mono" />
							{/* THE TWO THINGS THAT MAKE A CUSTOM REF FAIL, said before it does.
							    Both surface as ImagePullBackOff minutes later, where neither
							    cause is visible: a private Harbor project cannot be pulled at
							    all (sandbox pods carry no pull secret and node trust pulls
							    anonymously), and a wrong-arch image is a valid manifest that
							    fails at exec. */}
							<span className="mt-1 block max-w-xs font-normal leading-snug text-slate-400">
								Ours is <code className="rounded bg-slate-50 px-1">harbor.lum.id/&lt;project&gt;/&lt;name&gt;:&lt;tag&gt;</code>{" "}
								— the same ref at every site. The project must be{" "}
								<strong>public</strong> to be pullable here, and the image{" "}
								<strong>linux/amd64</strong>.{" "}
								<a href="/studio/docs/flowmesh-ssh"
									className="text-indigo-600 hover:underline">How to build and push →</a>
							</span>
						</label>
					)}
					{/* A DROPDOWN, STILL MULTI-SELECT. Rendered as three stacked rows
					    this was the tallest thing on the form; collapsed, it costs one
					    line until you open it. What it must NOT become is a plain
					    <select>: each source injects its OWN variable, so attaching
					    several is normal, and a single-select would quietly reinstate
					    the one-or-nothing picker this replaced.

					    <details> rather than a popover: it is a real disclosure widget,
					    keyboard-accessible and closable by the browser, with no open/close
					    state to keep in sync. */}
					{siteSources.length > 0 && (
						<details className="text-xs text-slate-600">
							<summary className="cursor-pointer select-none rounded-md border border-slate-300 bg-white px-2 py-1.5 marker:content-['']">
								Data
								<span className="ml-1 text-slate-400">
									{sources.length === 0
										? "— none attached"
										: `— ${siteSources.filter((d) => sources.includes(d.id))
												.map((d) => d.label ?? d.id).join(", ")}`}
								</span>
								<span className="ml-1 text-slate-300">▾</span>
							</summary>
							<div className="mt-1 space-y-1 rounded-md border border-slate-200 bg-white p-2">
								<p className="text-[11px] text-slate-400">
									Attaches a live store — nothing is copied or mounted. Pick any number.
								</p>
								{siteSources.map((d) => (
									<label key={d.id}
										className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
										<input type="checkbox" className="mt-0.5" checked={sources.includes(d.id)}
											onChange={(e) => setSources((v) =>
												e.target.checked ? [...v, d.id] : v.filter((x) => x !== d.id))} />
										<span className="min-w-0">
											<span className="font-medium text-slate-700">{d.label ?? d.id}</span>
											{d.note && <span className="text-slate-500"> {d.note}</span>}
											{d.auth && (
												<span className="block text-[11px] text-slate-400">{d.auth}</span>
											)}
										</span>
									</label>
								))}
							</div>
						</details>
					)}
					{/* PUBLIC PORTS. Only rendered where the site actually publishes a
					    pool — office has the code but no published pool, and offering a
					    field there would produce a connect string resolving to nothing.
					    Free/total is the SITE's, not yours: the pool is shared fleet-wide
					    because each port costs a capped LB frontend, so a full pool has to
					    be visible here rather than discovered at the refusal. */}
					{pool.enabled && (
						<fieldset className="text-xs text-slate-600">
							<legend className="mb-1">
								Public ports{" "}
								<span className={pool.free === 0 ? "text-amber-600" : "text-slate-400"}>
									— {pool.free ?? 0} of {pool.pool_size ?? 0} free at this site
								</span>
							</legend>
							<div className="flex flex-wrap items-center gap-2">
								{Array.from({ length: pool.max_per_sandbox ?? 2 }).map((_, i) => (
									<input key={i} value={ports[i] ?? ""} inputMode="numeric"
										onChange={(e) => setPorts((v) => {
											const n = [...v]; n[i] = e.target.value.replace(/[^0-9]/g, ""); return n;
										})}
										placeholder={i === 0 ? "22" : "8888"}
										disabled={(pool.free ?? 0) === 0}
										className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm font-mono disabled:bg-slate-50" />
								))}
								<span className="text-slate-400">
									{(pool.free ?? 0) === 0
										? "pool full — delete a sandbox holding ports to free one"
										: `reachable as ${pool.host ?? "lum.id"}:<assigned>`}
								</span>
							</div>
						</fieldset>
					)}
					{/* Datasets are INFORMATIONAL, not selectable — they are already
					    mounted read-only in every sandbox here. Rendering them as a
					    checkbox would imply an opt-in that does not exist. */}
					{siteDatasets.length > 0 && (
						<div className="text-xs text-slate-600">
							<div className="mb-1">
								Datasets <span className="text-slate-400">at /datasets</span>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								{siteDatasets.map((d) => (
									<span key={d.name}
										title={`${d.note ?? d.name} — ${d.files ?? 0} file(s), ${fmtBytes(d.bytes)}`}
										className="rounded-md border border-slate-200 bg-white px-2 py-1">
										{d.name} <span className="text-slate-400">{fmtBytes(d.bytes)}</span>
									</span>
								))}
							</div>
						</div>
					)}
					<label className="text-xs text-slate-600">
						Expires after
						<select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}
							className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm">
							{/* 24h is the ceiling, and sandbox-control enforces the same number
							    (MAX_TTL_HOURS). Offering 3d here while the server refused it would
							    be the GPU-selector bug again in a different field. */}
							<option value={2}>2h</option><option value={8}>8h</option>
							<option value={24}>24h</option>
						</select>
					</label>
					<button onClick={onCreate} disabled={busy || !name}
						className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
						{busy ? "creating…" : "Create sandbox"}
					</button>
				</div>
				</div>
				</div>
				)}

				{dsOpen && (
					<div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
						<div className="mb-2 text-xs text-slate-500">
							Files for every sandbox on <strong>{target}</strong>, mounted read-only at{" "}
							<code className="rounded bg-slate-50 px-1">/datasets</code>. Publishing happens here
							because that mount stays read-only inside the sandboxes — so one careless{" "}
							<code className="rounded bg-slate-50 px-1">rm</code> cannot take out a corpus
							everyone else is using. Per site, not replicated.
						</div>
						{siteDatasets.length > 0 ? (
							<ul className="mb-3 divide-y divide-slate-100">
								{siteDatasets.map((d) => (
									<li key={d.name} className="flex items-center gap-2 py-1 text-xs">
										<span className="font-medium text-slate-800">{d.name}</span>
										<span className="text-slate-400">
											{d.files ?? 0} file(s) · {fmtBytes(d.bytes)}
										</span>
										{d.note && <span className="truncate text-slate-500">{d.note}</span>}
										{/* Ownership is WHY a row has buttons or not, so it is shown
										    rather than left to be inferred from their absence. */}
										<span className="ml-auto shrink-0 text-slate-400">
											{d.owner ?? "operator"}
										</span>
										{d.can_edit ? (
											<>
												<button disabled={dsBusy}
													onClick={() => { setDsUploadTo(d.name); dsFileRef.current?.click(); }}
													className="shrink-0 text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
													add files
												</button>
												<button disabled={dsBusy} onClick={() => void onDeleteDataset(d)}
													className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-50">
													delete
												</button>
											</>
										) : (
											<span className="shrink-0 text-slate-300" title="Published by an operator — ask an operator to change it">
												read-only
											</span>
										)}
									</li>
								))}
							</ul>
						) : (
							<p className="mb-3 text-xs text-slate-500">
								Nothing published on {target} yet. <code className="rounded bg-slate-50 px-1">ls /datasets</code>{" "}
								in a sandbox there shows the same thing.
							</p>
						)}
						{/* One input for the whole list, aimed by dsUploadTo. */}
						<input ref={dsFileRef} type="file" multiple className="hidden"
							onChange={(e) => void onUploadDatasetFiles(e.target.files)} />
						{datasetsWritableForSite(target) ? (
							<div className="flex flex-wrap items-end gap-2">
								<label className="text-xs text-slate-600">
									New dataset
									<input value={dsName}
										onChange={(e) => setDsName(e.target.value.toLowerCase())}
										placeholder="my-corpus"
										className="mt-1 block w-44 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
								</label>
								<label className="text-xs text-slate-600">
									Description <span className="text-slate-400">(optional)</span>
									<input value={dsNote} onChange={(e) => setDsNote(e.target.value)}
										placeholder="what this holds"
										className="mt-1 block w-64 max-w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
								</label>
								<button onClick={() => void onCreateDataset()} disabled={dsBusy || !dsName.trim()}
									className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
									{dsBusy ? "working…" : "Publish"}
								</button>
							</div>
						) : (
							<p className="text-xs text-slate-500">
								<strong>{target}</strong> has no writable dataset tier — the list above is
								read-only here. Datasets are per-site, so publish on a site that has one.
							</p>
						)}
						<p className="mt-2 text-xs text-slate-500">
							Lowercase name: letters, digits, dot, dash, underscore.
							{dsLimits && (
								<> Limits: {dsLimits.max_file_mb} MB per file, {dsLimits.max_size_gb} GB per
								dataset, {dsLimits.max_per_user} datasets each.</>
							)}{" "}
							For a bulk corpus, <code className="rounded bg-slate-50 px-1">scp</code> to the NAS
							instead — this path goes through one pod.
						</p>
					</div>
				)}

				{keysOpen && (
					<div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
						{keys?.length ? (
							<ul className="mb-3 space-y-1">
								{keys.map((k) => (
									<li key={k.id} className="flex items-center gap-2 text-xs">
										<span className="font-medium text-slate-800">{k.title}</span>
										<span className="font-mono text-slate-500">{k.fingerprint}</span>
										<button onClick={() => void onDeleteKey(k)}
											className="ml-auto text-slate-400 hover:text-red-600">remove</button>
									</li>
								))}
							</ul>
						) : (
							<p className="mb-3 text-xs text-amber-700">
								You have no SSH keys, so every connection will be refused with
								<code className="mx-1 rounded bg-amber-50 px-1">Permission denied (publickey)</code>
								even when the sandbox is running.
							</p>
						)}
						<div className="flex flex-wrap items-end gap-2">
							<label className="text-xs text-slate-600">
								Public key
								<input value={newKey} onChange={(e) => setNewKey(e.target.value)}
									placeholder="ssh-ed25519 AAAAC3... you@laptop"
									className="mt-1 block w-[26rem] max-w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
							</label>
							<label className="text-xs text-slate-600">
								Label <span className="text-slate-400">(optional)</span>
								<input value={newKeyTitle} onChange={(e) => setNewKeyTitle(e.target.value)}
									placeholder="laptop"
									className="mt-1 block w-28 rounded-md border border-slate-300 px-2 py-1 text-sm" />
							</label>
							<button onClick={() => void onAddKey()} disabled={keyBusy || !newKey.trim()}
								className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
								{keyBusy ? "adding…" : "Add key"}
							</button>
						</div>
						<p className="mt-2 text-xs text-slate-500">
							Get it with <code className="rounded bg-slate-50 px-1">cat ~/.ssh/id_ed25519.pub</code>.
							Adding a key also syncs it to <strong>{target}</strong>, so it works immediately.
						</p>
					</div>
				)}
				<p className="mt-2 text-xs text-slate-500">
					{connectHint ? (
						<>
							Connect with <code className="rounded bg-white px-1">{connectHint}</code> — your key
							decides which sandbox you land in.{" "}
						</>
					) : (
						<>
							<strong>{target}</strong> has no SSH gateway yet — sandboxes there are reachable with{" "}
							<code className="rounded bg-white px-1">kubectl exec</code> only.{" "}
						</>
					)}
					Files under <code className="rounded bg-white px-1">/home</code> survive deleting a
					sandbox (per site).{" "}
					<a className="text-indigo-600 hover:underline" href="/studio/docs/sandboxes">Sandbox guide</a>
					{" · "}
					<a className="text-indigo-600 hover:underline" href="/studio/docs/flowmesh-ssh">Build &amp; push your own image</a>
				</p>
			</div>

			<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
						<tr>
							<th className="px-3 py-2">Site</th>
							<th className="px-3 py-2">Shell</th>
							<th className="px-3 py-2">State</th>
							<th className="px-3 py-2">Connect</th>
							<th className="px-3 py-2">Owner</th>
							<th className="px-3 py-2">Expires in</th>
							<th className="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.map((r) => (
							<tr key={r.key} className={`hover:bg-slate-50 ${isLive(r) ? "" : "opacity-60"}`}>
								<td className="px-3 py-2"><SiteBadge site={r.site} /></td>
								<td className="px-3 py-2">
									<div className="font-medium text-slate-900">{r.name}</div>
									<div className="font-mono text-xs text-slate-500">
										{r.kind === "sandbox" ? r.sandbox?.pod : "flowmesh ssh task"}
										{r.gpu ? ` · ${r.gpu} GPU` : ""}
										{r.node ? ` · ${r.node}` : ""}
									</div>
								</td>
								<td className="px-3 py-2">
									<StatePill r={r} />
									{/* A queued sandbox says what it is waiting for. Leaving it as a
									    bare "Pending" with no reason is the thing this avoids. */}
									{(r.state === "Queued" || r.state === "Pending") && r.detail && (
										<div className="mt-0.5 max-w-xs text-xs text-amber-700">{r.detail}</div>
									)}
								</td>
								<td className="px-3 py-2 font-mono text-xs text-slate-700">
									{r.connect ?? "—"}
									{/* The assigned port is the ONLY way to reach a published
									    service, and it is chosen by the server from a shared
									    pool — so it has to be readable here, not just at create
									    time in a response the user has already dismissed. */}
									{r.ports?.map((p) => (
										<span key={p.node_port} className="mt-0.5 block text-slate-500"
											title={`container port ${p.container_port} published publicly`}>
											{p.connect ?? `:${p.node_port}`}
											<span className="text-slate-400"> → {p.container_port}</span>
										</span>
									))}
								</td>
								<td className="px-3 py-2 text-xs text-slate-600">{r.owner ?? "you"}</td>
								<td className="px-3 py-2 text-xs text-slate-600">{expiresIn(r.expiresAt)}</td>
								<td className="px-3 py-2 text-right">
									{r.kind === "sandbox" ? (
										/* Deleting twice is the natural thing to do when the row is still
										   there after the first click, and the second one 404s. The row
										   stays visible (so the shutdown is legible) but is not clickable. */
										<button onClick={() => onDelete(r)}
											disabled={r.state === "Terminating"}
											title={r.state === "Terminating" ? "shutting down — this takes about 30s" : undefined}
											className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 enabled:hover:bg-rose-50 enabled:hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
											{r.state === "Terminating" ? "Deleting…" : "Delete"}
										</button>
									) : (
										/* A vast shell is a FlowMesh TASK. Cancelling it is a job action
										   and lives on Jobs; offering a Delete here that did something
										   subtly different would be worse than offering none. */
										<a className="text-xs text-indigo-600 hover:underline" href="/studio/compute/jobs">
											manage in Jobs
										</a>
									)}
								</td>
							</tr>
						))}
						{!rows.length && !boxes.loading && (
							<tr>
								<td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
									No sandboxes yet — create one above.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</TabShell>
	);
}
