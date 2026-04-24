import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Plus, Terminal } from "lucide-react";

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
import { mintBootstrapToken, type MintBootstrapResponse } from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

interface Props {
	clusterId: string;
	clusterName: string;
}

// Setup guide for the Infrastructure panel. Three sections, keyed to the
// three registry entities. The Node section has a live "Mint" button that
// calls POST /cluster/nodes/bootstrap-token scoped to this cluster, so an
// operator can copy a ready-to-paste one-liner without leaving the page.
export default function SetupTab({ clusterId, clusterName }: Props) {
	const [minting, setMinting] = useState(false);
	const [ttlMinutes, setTtlMinutes] = useState<string>("60");
	const [minted, setMinted] = useState<MintBootstrapResponse | null>(null);

	async function onMint() {
		const ttl = Number(ttlMinutes);
		if (!Number.isFinite(ttl) || ttl <= 0) {
			toast.error("TTL must be a positive number of minutes");
			return;
		}
		setMinting(true);
		try {
			const row = await mintBootstrapToken({
				cluster_id: clusterId,
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
				<CardContent className="pt-4 text-sm text-muted-foreground">
					Nodes register → cluster tracks them → <b>Runmesh supplier
					listings auto-mirror</b>. No separate Runmesh step; the
					"Billing vendor" field on the Overview tab populates on the
					first node registration.
				</CardContent>
			</Card>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Plus className="w-4 h-4 text-indigo-600" />
						1. Register a cluster
					</CardTitle>
					<CardDescription>
						A cluster is the outer container — a region + billing vendor +
						FlowMesh/Lumilake server endpoints. Nodes and workers always roll
						up to a cluster.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<p>
						Go to{" "}
						<a
							href="/app/admin/clusters"
							className="text-indigo-700 underline"
						>
							Clusters
						</a>{" "}
						→ <b>New cluster</b>. The wizard collects name, region, optional
						tags, and the Runmesh billing vendor ID (omit for self-owned).
					</p>
					<p>
						After creation, open the <b>Servers</b> tab on the cluster detail
						page and paste the FlowMesh Host + Lumilake Server URLs
						(e.g. <code>https://kv.run:8000/flowmesh</code>,{" "}
						<code>https://kv.run:8000/lumilake</code>). Status flips from{" "}
						<code>pending</code> → <code>active</code> once both roles are
						wired.
					</p>
					<p className="text-xs text-muted-foreground">
						Shell equivalent:
					</p>
					<CodeBlock
						code={`curl -sk -X POST https://lum.id/api/v1/cluster/clusters \\
  -H "Cookie: lm_session=$LM_SESSION" \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"${clusterName}","region":"sg"}'`}
					/>
				</CardContent>
			</Card>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Terminal className="w-4 h-4 text-indigo-600" />
						2. Add a node
					</CardTitle>
					<CardDescription>
						A node is a single host (VM, bare metal, or desktop) that will run
						one or more worker processes. Registration is one-shot via a
						bootstrap token — the installer consumes it, saves a long-lived
						node bearer under <code>/etc/lumid/agent.token</code>, and starts
						a systemd unit.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<div className="flex items-end gap-2">
						<div className="space-y-1">
							<Label htmlFor="ttl" className="text-xs">
								TTL (minutes)
							</Label>
							<Input
								id="ttl"
								type="number"
								min={1}
								max={10080}
								value={ttlMinutes}
								onChange={(e) => setTtlMinutes(e.target.value)}
								className="w-28"
							/>
						</div>
						<Button onClick={onMint} disabled={minting}>
							{minting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
							Mint install command
						</Button>
					</div>

					{minted && (
						<div className="space-y-2">
							<p className="text-xs text-muted-foreground">
								Token ID <code>{minted.token_id}</code>, expires{" "}
								{new Date(minted.expires_at).toLocaleString()}. Paste this
								on the target host — the script is idempotent (re-running
								only re-downloads the binary + restarts the service).
							</p>
							<CodeBlock code={minted.install_cmd} />
						</div>
					)}

					<div className="pt-2 text-xs text-muted-foreground space-y-1">
						<p>
							<b>Prereqs on the target host:</b> Linux with systemd + curl,
							sudo access, outbound HTTPS to <code>lum.id</code>.
						</p>
						<p>
							<b>What it installs:</b> <code>/usr/local/bin/lumid-cluster-agent</code>{" "}
							+ systemd unit <code>lumid-cluster-agent.service</code> +
							group <code>lumid-agent</code> owning the control socket at{" "}
							<code>/run/lumid-cluster-agent.sock</code>.
						</p>
						<p>
							<b>Verify:</b>{" "}
							<code>systemctl status lumid-cluster-agent</code> — should be{" "}
							<code>active (running)</code>. Node row appears on the{" "}
							<b>Nodes</b> tab immediately.
						</p>
					</div>
				</CardContent>
			</Card>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Terminal className="w-4 h-4 text-indigo-600" />
						3. Enroll a worker
					</CardTitle>
					<CardDescription>
						Worker processes enroll via the local agent socket. The agent
						brokers registration with the cluster service using its node
						bearer, so the caller doesn't need any cluster credentials —
						just membership in the <code>lumid-agent</code> group for
						socket access. The shape of <code>role</code> /{" "}
						<code>type</code> will evolve alongside the FlowMesh /
						Lumilake runtime revamp; treat the example as reference, not
						a fixed contract.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<p className="text-xs text-muted-foreground">
						One-time setup per user:
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
							<b>Response</b> contains <code>worker_id</code> +{" "}
							<code>worker_token</code> (the bearer the worker process uses for
							heartbeat + status). <b>Save it immediately — shown only once.</b>
						</p>
						<p>
							<b>Status lifecycle:</b> <code>starting</code> (enrolled, no
							heartbeat yet) → <code>idle</code> (heartbeating, no task) →{" "}
							<code>busy</code> (executing) → <code>stopped</code> /{" "}
							<code>lost</code>. The worker process is responsible for
							heartbeating; the agent only enrolls.
						</p>
						<p>
							<b>Enrollment field reference:</b>{" "}
							<code>role</code> = <code>flowmesh</code> | <code>lumilake</code>,{" "}
							<code>type</code> = <code>cpu</code> | <code>gpu</code>,
							optional <code>gpu_index</code>, <code>memory_limit_gb</code>,{" "}
							<code>cost_per_hour</code>, <code>version</code>,{" "}
							<code>cached_models</code>.
						</p>
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
