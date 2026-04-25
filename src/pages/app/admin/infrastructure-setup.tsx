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

// InfrastructureSetup — single-page orientation for the compute layer.
// 4 sections, one operator flow per section. The previous version
// split registry vs FM-execution across 6 sections; this one collapses
// "add node" into one block that walks through every piece an operator
// has to touch.
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
			{/* Banner */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm border-l-4 border-l-indigo-500">
				<CardContent className="pt-4 text-sm text-muted-foreground space-y-2">
					<p>
						<b>One pass per node.</b> A node onboarding (step 2) installs
						both the cluster-registry agent (this UI's source of truth)
						and the FlowMesh guardian + workers (the runtime that takes
						jobs). Once running, the rest auto-flows: Runmesh vendor row
						appears, cluster status flips <code>active</code>, billing
						attribution lights up.
					</p>
					<p className="text-xs">
						Boxes that don't yet have an arm64 worker image (e.g. NVIDIA
						GB10) can complete step 2 partially — they enroll in the
						registry but can't accept jobs until the arm64 image is
						built.
					</p>
				</CardContent>
			</Card>

			{/* 1. Create a cluster + wire servers */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Plus className="w-4 h-4 text-indigo-600" />
						1. Create a cluster + wire servers
					</CardTitle>
					<CardDescription>
						Region + tags + the FlowMesh and Lumilake server URLs. The
						cluster status flips from <code>pending</code> to{" "}
						<code>active</code> once both server roles are wired.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<Link to="/dashboard/admin/clusters">
						<Button variant="outline" size="sm">
							<Layers className="w-4 h-4 mr-1" />
							Clusters → New cluster
						</Button>
					</Link>
					<p className="text-xs text-muted-foreground">
						Server URLs typically point at the host box's FlowMesh
						(<code>http://&lt;host&gt;:8000</code>) and Lumilake
						(<code>http://&lt;host&gt;:9000</code>) services. The host
						box is where the FM control plane runs (see step 2,
						"flowmeshctl host setup").
					</p>
				</CardContent>
			</Card>

			{/* 2. Onboard a node — combined registry + FM in one walkthrough */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Terminal className="w-4 h-4 text-indigo-600" />
						2. Onboard a node
					</CardTitle>
					<CardDescription>
						Each node gets both layers: the cluster-registry agent
						(inventory) and a FlowMesh guardian + workers (job runtime).
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4 text-sm">
					{/* 2a — registry-side: mint + install */}
					<div>
						<p className="text-sm font-medium mb-1">
							2a. Cluster-registry agent (one-line install)
						</p>
						<div className="flex items-end gap-2 flex-wrap mb-2">
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
										No clusters — finish step 1 first.
									</div>
								) : (
									<Select
										value={selectedClusterId}
										onValueChange={setSelectedClusterId}
									>
										<SelectTrigger id="cluster" className="w-[260px]">
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
								<Button onClick={onMint} disabled={minting || !selectedClusterId}>
									{minting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
									Mint install command
								</Button>
							</div>
						</div>
						{minted && (
							<>
								<p className="text-xs text-muted-foreground mb-1">
									Cluster <b>{selectedCluster?.name}</b> · expires{" "}
									{new Date(minted.expires_at).toLocaleString()}
								</p>
								<CodeBlock code={minted.install_cmd} />
								<p className="text-xs text-muted-foreground mt-1">
									Idempotent on re-run. Saves a long-lived node bearer
									to <code>/etc/lumid/agent.token</code> and starts a
									systemd unit. Auto-detects amd64 / arm64.
								</p>
							</>
						)}
					</div>

					{/* 2b — prereqs */}
					<div className="border-t pt-3">
						<p className="text-sm font-medium mb-1">
							2b. Docker + GPU prerequisites (skip if already done)
						</p>
						<CodeBlock
							code={`# Install docker + nvidia-container-toolkit + register the runtime,
# then add flowmesh user to docker group. Idempotent.
curl -fsSL https://get.docker.com | sudo sh
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \\
  | sudo gpg --dearmor --batch --yes -o /etc/apt/keyrings/nvidia-container-toolkit.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \\
  | sed 's#deb https://#deb [signed-by=/etc/apt/keyrings/nvidia-container-toolkit.gpg] https://#g' \\
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update -y && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
sudo usermod -aG docker flowmesh

# Tip: boxes with a 100 GB Ubuntu LV need to grow it before the
# 45 GB FlowMesh GPU image will fit.
sudo lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv && sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv`}
						/>
					</div>

					{/* 2c — FM guardian via flowmeshctl */}
					<div className="border-t pt-3">
						<p className="text-sm font-medium mb-1">
							2c. FlowMesh guardian + workers (driven from the host box)
						</p>
						<p className="text-xs text-muted-foreground mb-2">
							From <code>~/flowmeshctl/</code> on the host box: append
							a guardian entry to <code>flowmesh_config.yaml</code>,
							generate the per-host env file, mint an operator API key,
							then run <code>guardian deploy</code>. Pre-distribute the
							45 GB GPU image via LAN to avoid per-node internet pulls.
						</p>
						<CodeBlock
							code={`# 1. Mint an operator key (returns api_key in 'flm-…' shape)
curl -X POST http://<host>:8010/api/v1/auth/keys \\
  -H "Authorization: Bearer <admin-api-key>" \\
  -d '{"key_type":"operator","alias":"<box>-guardian","principal_id":"<admin-principal-id>"}'

# 2. Append to ~/flowmeshctl/configs/flowmesh_config.yaml under guardians:
#   - node: "192.168.6.<X>"
#     guardian_api_key: "flm-<above>"
#     env_guardian_file: "envs/.env.guardian.<box>"
#     worker_config: "configs/cpu_worker_config.yaml"   # or gpu_only_… for mini boxes
#     workers:
#       images: ["cpu", "gpu"]                          # or ["gpu"]
#       auto: "per_gpu"

# 3. Generate per-host env (template envs/.env.guardian.1):
#    Replace GUARDIAN_CLUSTER, GUARDIAN_ALIAS, GUARDIAN_TOKEN (32-byte b64),
#    FLOWMESH_API_KEY (the minted key).

# 4. Pre-distribute the 45 GB GPU image via LAN (one-shot, host → target):
ssh flowmesh@<source> "docker save \\
  kaiitunnz/flowmesh_worker:latest-gpu \\
  kaiitunnz/flowmesh_worker:latest-cpu \\
  kaiitunnz/flowmesh_guardian:latest -o /tmp/fm_imgs.tar"
ssh flowmesh@<source> "cat /tmp/fm_imgs.tar" | ssh flowmesh@<target> "docker load"

# 5. Deploy
cd ~/flowmeshctl && .venv/bin/python flowmeshctl.py guardian deploy <idx>`}
						/>
					</div>

					<div className="border-t pt-2 text-xs text-muted-foreground space-y-1">
						<p>
							<b>Worker lifecycle (registry):</b>{" "}
							<code>starting</code> → <code>idle</code> → <code>busy</code>{" "}
							→ <code>stopped</code> / <code>lost</code>. Background
							sweeper retires never-heartbeated rows after 1h and
							idle/busy rows whose heartbeat is stale &gt; 5min.
						</p>
						<p>
							<b>Drift to know:</b> FM workers heartbeat to FM Host (their
							job source), not to lumid_cluster. The cluster-agent's
							own heartbeat thread updates <code>last_heartbeat</code>{" "}
							but doesn't currently send a <code>status</code> field, so
							workers can stall in <code>starting</code> if the agent
							restarted after enrollment. Patch in flight.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* 3. Suppliers + billing — informational, both auto */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Briefcase className="w-4 h-4 text-indigo-600" />
						3. Suppliers (auto-mirrored)
					</CardTitle>
					<CardDescription>
						Each cluster auto-creates one Runmesh vendor row on first
						node registration; cluster ↔ vendor stays linked one-to-one
						and retires when the cluster's last node leaves. Edit
						commercial fields (contact, support tier) on the cluster's{" "}
						<b>Commercial</b> tab.
					</CardDescription>
				</CardHeader>
				<CardContent className="text-sm space-y-2">
					<ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
						<li>
							Vendor key:{" "}
							<code>
								short_name = "lumid-cluster:&lt;cluster_id&gt;"
							</code>
							.
						</li>
						<li>
							Node key:{" "}
							<code>
								node_code = "&lt;cluster_id&gt;/&lt;node_id&gt;"
							</code>{" "}
							— globally unique.
						</li>
						<li>
							Re-sync drift via the <b>Overview → Runmesh mirror →
							Re-sync</b> button on the cluster detail page.
						</li>
					</ul>
				</CardContent>
			</Card>

			{/* 4. Billing — auto, super_admin gated */}
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<DollarSign className="w-4 h-4 text-indigo-600" />
						4. Billing (auto, super_admin only)
					</CardTitle>
					<CardDescription>
						Pre-auth on workflow submit, idempotent ledger entry on task
						terminal. Both bridges share the{" "}
						<code>X-Bridge-Secret</code> auth model.
					</CardDescription>
				</CardHeader>
				<CardContent className="text-sm">
					<ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
						<li>
							<code>POST /runmesh/billing/check-balance</code> —
							pre-auth, no side effects, 402 on insufficient balance.
						</li>
						<li>
							<code>POST /runmesh/billing/flowmesh-entry</code> — on
							terminal, idempotent on task id, decrements{" "}
							<code>sys_user.amount</code> + records a transaction.
						</li>
						<li>
							All money-moving paths (
							<code>/runmesh/finance/**</code>,
							<code>/runmesh/pay/refund/**</code>,
							<code>/runmesh/billing/transaction/**</code>) are gated on{" "}
							<b>super_admin</b>.
						</li>
					</ul>
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
