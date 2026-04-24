import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Layers, Loader2 } from "lucide-react";

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
import { createCluster, upsertServer } from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

// Minimal create wizard: name + region + optional billing vendor id +
// optional per-role server host_url. Per-server storage JSON edits land
// in the detail page's Servers tab — the wizard keeps the new-cluster
// path one screen.

export default function ClusterWizard() {
	const navigate = useNavigate();

	const [name, setName] = useState("");
	const [region, setRegion] = useState("");
	const [fmHost, setFmHost] = useState("");
	const [llHost, setLlHost] = useState("");
	const [tags, setTags] = useState(""); // comma-separated; parsed to array

	const [saving, setSaving] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimName = name.trim();
		if (!trimName) {
			toast.error("Name required");
			return;
		}
		setSaving(true);
		try {
			const parsedTags = tags
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const cluster = await createCluster({
				name: trimName,
				region: region.trim() || undefined,
				tags: parsedTags.length ? parsedTags : undefined,
			});

			// Wire up any servers the operator provided. Each call is
			// best-effort — the cluster exists either way.
			const pending: Array<Promise<unknown>> = [];
			if (fmHost.trim()) {
				pending.push(
					upsertServer(cluster.id, "flowmesh", { host_url: fmHost.trim() }),
				);
			}
			if (llHost.trim()) {
				pending.push(
					upsertServer(cluster.id, "lumilake", { host_url: llHost.trim() }),
				);
			}
			if (pending.length > 0) {
				await Promise.all(pending);
			}

			toast.success(`Cluster ${cluster.name} created`);
			navigate(`/app/admin/clusters/${encodeURIComponent(cluster.id)}`);
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Create failed");
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<header className="flex items-center gap-3 mb-6">
				<Link to="/app/admin/clusters">
					<Button variant="ghost" size="sm">
						<ArrowLeft className="w-4 h-4 mr-1" />
						Clusters
					</Button>
				</Link>
				<Layers className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">New cluster</h1>
			</header>

			<form onSubmit={onSubmit}>
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base">Identity</CardTitle>
							<CardDescription>
								Name must be unique across every cluster in this lum.id account.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label htmlFor="name">Name</Label>
								<Input
									id="name"
									required
									placeholder="nimi0-prod"
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="region">Region</Label>
								<Input
									id="region"
									placeholder="sg | us-east | …"
									value={region}
									onChange={(e) => setRegion(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="tags">Tags</Label>
								<Input
									id="tags"
									placeholder="comma-separated (e.g. prod, research)"
									value={tags}
									onChange={(e) => setTags(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label className="text-muted-foreground">
									Billing vendor (Runmesh)
								</Label>
								<p className="text-xs text-muted-foreground">
									Auto-linked on first node registration — the cluster's
									supplier row is created in Runmesh behind the scenes.
									Override later by editing the cluster if needed.
								</p>
							</div>
						</CardContent>
					</Card>

					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base">FlowMesh server</CardTitle>
							<CardDescription>
								Optional — the cluster stays in{" "}
								<code className="text-xs">pending</code> until both roles are wired.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label htmlFor="fm-host">Host URL</Label>
								<Input
									id="fm-host"
									placeholder="http://nimi0:18000"
									value={fmHost}
									onChange={(e) => setFmHost(e.target.value)}
								/>
							</div>
							<p className="text-xs text-muted-foreground">
								Storage config (MinIO endpoint, Redis, MySQL DSN) is edited later on the cluster detail page.
							</p>
						</CardContent>
					</Card>

					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base">Lumilake server</CardTitle>
							<CardDescription>
								Pairs with the FlowMesh server above. Same cluster, different surface.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label htmlFor="ll-host">Host URL</Label>
								<Input
									id="ll-host"
									placeholder="http://nimi0:9000"
									value={llHost}
									onChange={(e) => setLlHost(e.target.value)}
								/>
							</div>
							<p className="text-xs text-muted-foreground">
								MinIO + PostgreSQL DSN editable on the detail page.
							</p>
						</CardContent>
					</Card>
				</div>

				<div className="mt-6 flex items-center gap-2 justify-end">
					<Link to="/app/admin/clusters">
						<Button type="button" variant="outline" disabled={saving}>
							Cancel
						</Button>
					</Link>
					<Button type="submit" disabled={saving || !name.trim()}>
						{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
						Create cluster
					</Button>
				</div>
			</form>
		</>
	);
}
