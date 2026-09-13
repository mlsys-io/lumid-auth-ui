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

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	PUBLIC_SANDBOX_SITE,
	SANDBOX_SITES,
	USER_SANDBOX_SITES,
	createSandbox,
	deleteSandbox,
	dataSourcesForSite,
	datasetsForSite,
	gpuProfileForSite,
	imagesForSite,
	isSshTaskActive,
	listSandboxesForSite,
	sandboxToShell,
	sshCommandForSite,
	sshTaskToShell,
	syncKeys,
	type ComputeShell,
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
			});
			toast.success(`creating ${name} on ${target}`);
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
				<div className="flex flex-wrap items-end gap-3">
					{/* Only an admin picks a site; a non-admin has exactly one and a
					    disabled select would just be furniture. */}
					{isAdmin && (
						<label className="text-xs text-slate-600">
							Site
							<select value={target} onChange={(e) => setTarget(e.target.value)}
								className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm">
								{SANDBOX_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
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
								placeholder="repo/name:tag"
								className="mt-1 block w-64 rounded-md border border-slate-300 px-2 py-1 text-sm font-mono" />
						</label>
					)}
					{siteSources.length > 0 && (
						<fieldset className="text-xs text-slate-600">
							<legend className="mb-1">Data</legend>
							<div className="flex flex-wrap items-center gap-2">
								{siteSources.map((d) => (
									<label key={d.id} title={[d.note, d.hint].filter(Boolean).join(" — ")}
										className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1">
										<input type="checkbox" checked={sources.includes(d.id)}
											onChange={(e) => setSources((v) =>
												e.target.checked ? [...v, d.id] : v.filter((x) => x !== d.id))} />
										{d.label ?? d.id}
									</label>
								))}
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
					{/* One control where there were two. "Sync my SSH keys" was the only
					    key affordance here and it could not help the common case -- a
					    user with NO key -- because it re-reads an empty list. The count
					    is on the button so "0 keys" is visible before you try to
					    connect and fail. */}
					<button onClick={() => setKeysOpen((v) => !v)}
						title="Add or remove the SSH keys that let you into your sandboxes"
						className={`ml-auto rounded-md border px-3 py-1.5 text-sm ${
							keys && keys.length === 0
								? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
								: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
						}`}>
						{keys === null ? "SSH keys" : keys.length === 0 ? "No SSH keys — add one" : `SSH keys · ${keys.length}`}
					</button>
				</div>

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
					sandbox (per site).
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
								<td className="px-3 py-2 font-mono text-xs text-slate-700">{r.connect ?? "—"}</td>
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
