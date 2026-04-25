import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
	Briefcase,
	Check,
	Copy,
	DollarSign,
	Layers,
	Loader2,
	Plus,
	Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	listClusters,
	mintBootstrapToken,
	type Cluster,
	type MintBootstrapResponse,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

// InfrastructureSetup — top-level orientation page under the
// Infrastructure admin section. Covers the entire operational surface
// (cluster → node → worker → supplier → billing) in one scroll,
// rather than hiding the reference inside each cluster's detail view.
// The mint-install-command action picks a cluster from a dropdown so
// the page can live outside any single cluster's scope.
export default function InfrastructureSetup() {
	const [clusters, setClusters] = useState<Cluster[]>([]);
	const [loadingClusters, setLoadingClusters] = useState(true);
	const [selectedClusterId, setSelectedClusterId] = useState<string>("");
	const [ttlMinutes, setTtlMinutes] = useState("60");
	const [minting, setMinting] = useState(false);
	const [minted, setMinted] = useState<MintBootstrapResponse | null>(null);

	useEffect(() => {
		(async () => {
			try {
				const r = await listClusters({ page_size: 200 });
				const rows = r?.clusters || [];
				setClusters(rows);
				if (rows.length === 1) setSelectedClusterId(rows[0].id);
			} catch (e: unknown) {
				if (isSessionExpired(e)) return;
				toast.error((e as Error)?.message || "Failed to load clusters");
			} finally {
				setLoadingClusters(false);
			}
		})();
	}, []);

	const selectedCluster = clusters.find((c) => c.id === selectedClusterId);

	async function onMint() {
		if (!selectedClusterId) {
			toast.error("Pick a cluster first");
			return;
		}
		const ttl = Number(ttlMinutes);
		if (!Number.isFinite(ttl) || ttl <= 0) {
			toast.error("TTL must be a positive number of minutes");
			return;
		}
		setMinting(true);
		try {
			const row = await mintBootstrapToken({
				cluster_id: selectedClusterId,
				ttl_minutes: ttl,
			});
			setMinted(row);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Mint failed");
		} finally {
			setMinting(false);
		}
	}

	return (
		<div className="space-y-6">
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm border-l-4 border-l-indigo-500">
				<CardContent className="pt-4 text-sm text-muted-foreground space-y-2">
					<p>
						<b>Two layers, one admin surface.</b>{" "}
						<i>(1)</i> the cluster <b>registry</b> (this UI, lumid_cluster
						service) tracks inventory: clusters, nodes, workers, vendor
						mirror to Runmesh.{" "}
						<i>(2)</i> the FlowMesh <b>execution</b> stack (host on .181 +
						guardians per box, deployed via <code>flowmeshctl</code>) is
						what actually accepts and runs jobs. Steps 1–3 set up (1);
						step 4 sets up (2). The two are loosely coupled today — see
						the heads-up in step 4.
					</p>
					<p>
						Suppliers auto-mirror from the cluster on first node
						registration (no manual onboarding); billing attribution
						flows from worker task termination to the cluster's vendor
						row. A background sweeper retires stale registry workers.
					</p>
					<p className="text-xs">
						Worker-enroll field shapes (<code>role</code> /{" "}
						<code>type</code>) will evolve alongside the FlowMesh /
						Lumilake runtime revamp — treat the example as reference,
						not a fixed contract.
					</p>
				</CardContent>
			</Card>

			{/* Section 1 — cluster */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Plus className="w-4 h-4 text-indigo-600" />
						1. Register a cluster
					</CardTitle>
					<CardDescription>
						The outer container — a region + FlowMesh/Lumilake server
						endpoints. Nodes and workers roll up to it. Status flips from{" "}
						<code>pending</code> to <code>active</code> once both servers
						are wired on the cluster's Servers tab.
					</CardDescription>
				</CardHeader>
				<CardContent className="text-sm">
					<Link to="/dashboard/admin/clusters">
						<Button variant="outline" size="sm">
							<Layers className="w-4 h-4 mr-1" />
							Go to Clusters → New cluster
						</Button>
					</Link>
				</CardContent>
			</Card>

			{/* Section 2 — node */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Terminal className="w-4 h-4 text-indigo-600" />
						2. Add a node
					</CardTitle>
					<CardDescription>
						One-shot install via a bootstrap token. Installer saves a
						long-lived node bearer at <code>/etc/lumid/agent.token</code>{" "}
						and enables a systemd unit; idempotent on re-run.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
						<div className="space-y-1">
							<Label htmlFor="cluster" className="text-xs">
								Cluster
							</Label>
							{loadingClusters ? (
								<div className="h-9 flex items-center text-xs text-muted-foreground">
									<Loader2 className="w-3 h-3 mr-1 animate-spin" />
									Loading…
								</div>
							) : clusters.length === 0 ? (
								<div className="h-9 flex items-center text-xs text-muted-foreground">
									No clusters yet — register one first.
								</div>
							) : (
								<Select
									value={selectedClusterId}
									onValueChange={setSelectedClusterId}
								>
									<SelectTrigger id="cluster">
										<SelectValue placeholder="Pick a cluster…" />
									</SelectTrigger>
									<SelectContent>
										{clusters.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.name}
												{c.region ? ` — ${c.region}` : ""}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>
						<div className="space-y-1">
							<Label htmlFor="ttl" className="text-xs">
								TTL (min)
							</Label>
							<Input
								id="ttl"
								type="number"
								min={1}
								max={10080}
								value={ttlMinutes}
								onChange={(e) => setTtlMinutes(e.target.value)}
								className="w-24"
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-xs invisible">_</Label>
							<Button
								onClick={onMint}
								disabled={minting || !selectedClusterId}
							>
								{minting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
								Mint install command
							</Button>
						</div>
					</div>

					{minted && (
						<div className="space-y-2">
							<p className="text-xs text-muted-foreground">
								For cluster <b>{selectedCluster?.name}</b> · Token ID{" "}
								<code>{minted.token_id}</code>, expires{" "}
								{new Date(minted.expires_at).toLocaleString()}.
							</p>
							<CodeBlock code={minted.install_cmd} />
							<p className="text-xs text-muted-foreground">
								Paste on the target host. The installer downloads the
								agent binary, registers the node, starts the systemd
								unit, and mirrors a supplier-node row into Runmesh —
								all in one shot.
							</p>
						</div>
					)}

					<div className="pt-2 text-xs text-muted-foreground space-y-1">
						<p>
							<b>Prereqs:</b> Linux + systemd + curl + sudo, outbound HTTPS
							to <code>lum.id</code>. For boxes that will host{" "}
							<b>FlowMesh GPU workers</b> (next section), you also need
							docker + nvidia-container-toolkit + the nvidia docker runtime
							registered (<code>nvidia-ctk runtime configure</code>) +
							flowmesh user in the docker group.
						</p>
						<p>
							<b>Installs:</b>{" "}
							<code>/usr/local/bin/lumid-cluster-agent</code>, systemd unit,{" "}
							<code>lumid-agent</code> group on the{" "}
							<code>/run/lumid-cluster-agent.sock</code> control socket.
						</p>
						<p>
							<b>Disk:</b> the FM GPU worker image is{" "}
							<code>~45&nbsp;GB</code> + ~6&nbsp;GB for the HF model
							pre-download. Boxes with the default Ubuntu 100&nbsp;GB LV
							need <code>lvextend -l +100%FREE</code> on
							<code>ubuntu-vg/ubuntu-lv</code> + <code>resize2fs</code>{" "}
							first.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Section 3 — worker */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Terminal className="w-4 h-4 text-indigo-600" />
						3. Enroll a worker
					</CardTitle>
					<CardDescription>
						Worker processes enroll via the local agent socket. Agent
						brokers registration using its node bearer — the caller only
						needs <code>lumid-agent</code> group membership for socket
						access.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<p className="text-xs text-muted-foreground">
						One-time per user on the node:
					</p>
					<CodeBlock
						code={`sudo usermod -aG lumid-agent $(whoami)
newgrp lumid-agent     # or log out/in for the group to apply`}
					/>

					<p className="text-xs text-muted-foreground pt-1">
						GPU worker (FlowMesh) on GPU 0:
					</p>
					<CodeBlock
						code={`curl --unix-socket /run/lumid-cluster-agent.sock \\
  http://x/enroll -H 'Content-Type: application/json' \\
  -d '{"role":"flowmesh","type":"gpu","gpu_index":0,"memory_limit_gb":24,"cost_per_hour":2.0}'`}
					/>

					<p className="text-xs text-muted-foreground pt-1">
						CPU worker (Lumilake):
					</p>
					<CodeBlock
						code={`curl --unix-socket /run/lumid-cluster-agent.sock \\
  http://x/enroll -H 'Content-Type: application/json' \\
  -d '{"role":"lumilake","type":"cpu"}'`}
					/>

					<div className="pt-2 text-xs text-muted-foreground space-y-1">
						<p>
							<b>Response</b> contains a <code>worker_token</code> —
							shown once; the worker process uses it for heartbeat +
							status.
						</p>
						<p>
							<b>Lifecycle:</b> <code>starting</code> (no heartbeat yet)
							→ <code>idle</code> (alive, no task) → <code>busy</code>{" "}
							(executing) → <code>stopped</code> / <code>lost</code>. A
							background sweeper auto-flips abandoned <code>starting</code>{" "}
							rows older than 1h and{" "}
							<code>idle/busy</code> rows whose last heartbeat is older
							than 5min to <code>lost</code> — no manual cleanup needed.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Section 4 — FM Host + guardians (the real job-execution layer) */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Terminal className="w-4 h-4 text-indigo-600" />
						4. FlowMesh Host + Guardians (job execution)
					</CardTitle>
					<CardDescription>
						Step 3 enrolled the box in the cluster <i>registry</i> (inventory).
						This step makes it actually take jobs. <b>One FM Host per
						cluster</b> + <b>one Guardian per box</b> + N workers (one CPU
						optional, one GPU per device). Driven by{" "}
						<code>flowmeshctl</code> on the host box.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<p className="text-xs text-muted-foreground">
						On the host box (e.g. luyaomini, .181), the deployment toolkit
						lives at <code>~/flowmeshctl/</code> with{" "}
						<code>flowmesh_config.yaml</code> declaring host + guardians.
					</p>
					<CodeBlock
						code={`# 1. Add a remote box as a guardian — append to flowmesh_config.yaml
guardians:
  - node: "192.168.6.<X>"
    guardian_api_key: "flm-<minted via /api/v1/auth/keys>"
    env_guardian_file: "envs/.env.guardian.<hostname>"
    worker_config: "configs/cpu_worker_config.yaml"  # or gpu_only_worker_config.yaml
    workers:
      images: ["cpu", "gpu"]   # ["gpu"] for GPU-only boxes (e.g. mini boxes)
      auto: "per_gpu"

# 2. Mint the operator API key on the host's auth API
curl -X POST http://<host>:8010/api/v1/auth/keys \\
  -H 'Authorization: Bearer <admin-api-key>' \\
  -d '{"key_type":"operator","alias":"<box>-guardian","principal_id":"<admin>"}'

# 3. Generate the env file (template: envs/.env.guardian.1)
#    Replace GUARDIAN_CLUSTER, GUARDIAN_ALIAS, GUARDIAN_TOKEN (32B random),
#    FLOWMESH_API_KEY (the minted key from step 2).

# 4. Pre-distribute the GPU image (45 GB) via LAN — avoids per-host pull
#    On a host that already has it (e.g. luyao2):
ssh flowmesh@<source> "docker save \\
  kaiitunnz/flowmesh_worker:latest-gpu \\
  kaiitunnz/flowmesh_worker:latest-cpu \\
  kaiitunnz/flowmesh_guardian:latest -o /tmp/fm_imgs.tar"
ssh flowmesh@<source> "cat /tmp/fm_imgs.tar" | \\
  ssh flowmesh@<target> "docker load"

# 5. Deploy
cd ~/flowmeshctl && .venv/bin/python flowmeshctl.py guardian deploy <idx>
# Or all of them: flowmeshctl.py guardian deploy   (no args = sequential)
# Parallel: launch flowmeshctl.py guardian deploy <i> & per index`}
					/>

					<div className="pt-2 text-xs text-muted-foreground space-y-1">
						<p>
							<b>FM Host endpoints (port 8010 on host box):</b>{" "}
							<code>/api/v1/guardians</code>,{" "}
							<code>/api/v1/workers</code>,{" "}
							<code>/api/v1/auth/keys</code>.
						</p>
						<p>
							<b>Heads up:</b> FM workers heartbeat to the FM Host (their
							job source), not to <code>lumid_cluster</code> — so the
							cluster registry's worker rows stay in <code>starting</code>{" "}
							even after a guardian is fully running. Drift fix is
							planned (cluster-agent → lumid_cluster heartbeat).
						</p>
						<p>
							<b>aarch64 boxes (e.g. NVIDIA GB10):</b>{" "}
							<code>kaiitunnz/flowmesh_*</code> images are amd64-only
							today. Those nodes register in the cluster but cannot run
							a guardian until arm64 worker images exist.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Section 5 — suppliers */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Briefcase className="w-4 h-4 text-indigo-600" />
						5. Suppliers (auto-mirrored)
					</CardTitle>
					<CardDescription>
						Every cluster gets a Runmesh vendor row on first node
						registration — no separate supplier-onboarding step.
						Runmesh remains the billing source of truth; lumid_cluster
						is the operational source of truth. Two tables, one UI.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<ul className="list-disc pl-5 space-y-1 text-muted-foreground">
						<li>
							Vendor key: <code>short_name = "lumid-cluster:&lt;cluster_id&gt;"</code>.
						</li>
						<li>
							Node key: <code>node_code = "&lt;cluster_id&gt;/&lt;node_id&gt;"</code>{" "}
							— globally unique.
						</li>
						<li>
							Edit commercial fields (contact, support tier, notes) on
							the cluster's <b>Commercial</b> tab.
						</li>
						<li>
							Re-push state manually from the cluster's <b>Overview</b>{" "}
							→ Runmesh mirror card (useful after a Runmesh outage or
							for pre-wire nodes).
						</li>
						<li>
							When the last node leaves a cluster, the linked vendor
							row retires automatically + <code>billing_vendor_id</code>{" "}
							clears. The next registration recreates it.
						</li>
					</ul>
					<div className="flex gap-2">
						<Link to="/dashboard/admin/suppliers">
							<Button variant="outline" size="sm">
								Cross-cluster supplier list
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>

			{/* Section 5 — billing */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<DollarSign className="w-4 h-4 text-indigo-600" />
						6. Billing (automatic)
					</CardTitle>
					<CardDescription>
						Worker tasks that terminate post a ledger entry into
						Runmesh's transaction table and debit the owning user's
						balance. No manual invoicing.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<ul className="list-disc pl-5 space-y-1 text-muted-foreground">
						<li>
							Pre-auth: FlowMesh checks{" "}
							<code>POST /runmesh/billing/check-balance</code> before
							accepting a user's workflow. Refuses with 402 if
							insufficient.
						</li>
						<li>
							On terminal: FlowMesh posts{" "}
							<code>POST /runmesh/billing/flowmesh-entry</code>{" "}
							(idempotent on task id). Records a{" "}
							<code>runmesh_user_transaction</code> row and decrements{" "}
							<code>sys_user.amount</code>.
						</li>
						<li>
							Both bridges authenticate via the shared{" "}
							<code>X-Bridge-Secret</code> header
							(<code>FLOWMESH_BRIDGE_SECRET</code> env var on both
							sides).
						</li>
						<li>
							The platform-wide Billing page below + every{" "}
							<code>/runmesh/finance/**</code>,{" "}
							<code>/runmesh/pay/refund/**</code>,{" "}
							<code>/runmesh/billing/transaction/**</code> route is
							gated to <b>super_admin</b>. Regular admins see all the
							operational tabs but not money.
						</li>
					</ul>
					<div className="flex gap-2">
						<Link to="/dashboard/admin/billing">
							<Button variant="outline" size="sm">
								Platform-wide billing
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function CodeBlock({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	async function onCopy() {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Copy failed");
		}
	}
	return (
		<div className="relative">
			<pre className="rounded-md bg-slate-900 text-slate-100 text-xs p-3 pr-10 overflow-x-auto whitespace-pre">
				{code}
			</pre>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="absolute top-1 right-1 h-7 w-7 p-0 text-slate-300 hover:text-white hover:bg-slate-800"
				onClick={onCopy}
				aria-label="Copy"
			>
				{copied ? (
					<Check className="w-3.5 h-3.5" />
				) : (
					<Copy className="w-3.5 h-3.5" />
				)}
			</Button>
		</div>
	);
}
