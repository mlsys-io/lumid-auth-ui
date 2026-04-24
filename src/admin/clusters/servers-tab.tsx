import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import {
	deleteServer,
	upsertServer,
	type ClusterServer,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

// Per-role server card. Each role (flowmesh | lumilake) gets one card
// where the operator edits host_url + a blob of storage JSON (MinIO,
// Redis, MySQL/Postgres DSNs). We intentionally render storage as raw
// JSON instead of a structured form: the shape varies per role and
// evolves with the underlying services — a Text area that saves the
// parsed object keeps this screen from needing a coupled schema.

interface Props {
	clusterId: string;
	servers: ClusterServer[];
	onChange: () => void;
}

export default function ServersTab({ clusterId, servers, onChange }: Props) {
	const fm = useMemo(() => servers.find((s) => s.role === "flowmesh"), [servers]);
	const ll = useMemo(() => servers.find((s) => s.role === "lumilake"), [servers]);

	return (
		<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<ServerCard
				clusterId={clusterId}
				role="flowmesh"
				server={fm}
				onChange={onChange}
			/>
			<ServerCard
				clusterId={clusterId}
				role="lumilake"
				server={ll}
				onChange={onChange}
			/>
		</div>
	);
}

function defaultStorage(role: "flowmesh" | "lumilake"): Record<string, unknown> {
	if (role === "flowmesh") {
		return {
			minio: { endpoint: "http://host:19000", bucket: "flowmesh-results" },
			redis_control_url: "redis://host:6379/0",
			redis_telemetry_url: "redis://host:6379/1",
			mysql_dsn_ref: "secret:cluster-xxx-fm-mysql",
		};
	}
	return {
		minio: { endpoint: "http://host:19000", bucket: "lumilake-results" },
		redis_control_url: "redis://host:6379/0",
		postgres_dsn_ref: "secret:cluster-xxx-ll-pg",
	};
}

function ServerCard({
	clusterId,
	role,
	server,
	onChange,
}: {
	clusterId: string;
	role: "flowmesh" | "lumilake";
	server?: ClusterServer;
	onChange: () => void;
}) {
	const [hostUrl, setHostUrl] = useState(server?.host_url || "");
	const [storageText, setStorageText] = useState(() =>
		JSON.stringify(server?.storage_json || defaultStorage(role), null, 2),
	);
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);

	async function onSave(e: React.FormEvent) {
		e.preventDefault();
		let storage: Record<string, unknown> | undefined;
		const txt = storageText.trim();
		if (txt) {
			try {
				const parsed = JSON.parse(txt);
				if (parsed && typeof parsed === "object") {
					storage = parsed as Record<string, unknown>;
				} else {
					throw new Error("storage must be a JSON object");
				}
			} catch (err) {
				toast.error(`Invalid storage JSON: ${(err as Error).message}`);
				return;
			}
		}
		setSaving(true);
		try {
			await upsertServer(clusterId, role, {
				host_url: hostUrl.trim(),
				storage,
			});
			toast.success(`${role} server saved`);
			onChange();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Save failed");
		} finally {
			setSaving(false);
		}
	}

	async function onDelete() {
		if (!server) return;
		setDeleting(true);
		try {
			await deleteServer(clusterId, role);
			toast.success(`${role} server unlinked`);
			setHostUrl("");
			setStorageText(JSON.stringify(defaultStorage(role), null, 2));
			onChange();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Delete failed");
		} finally {
			setDeleting(false);
		}
	}

	return (
		<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
			<CardHeader>
				<CardTitle className="text-base capitalize">{role} server</CardTitle>
				<CardDescription>
					{role === "flowmesh"
						? "Orchestrator for FlowMesh workers. Storage holds MinIO + Redis + MySQL refs."
						: "Lumilake server paired with this cluster. Storage holds MinIO + PostgreSQL refs."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={onSave} className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor={`${role}-host`}>Host URL</Label>
						<Input
							id={`${role}-host`}
							placeholder={role === "flowmesh" ? "http://nimi0:18000" : "http://nimi0:9000"}
							value={hostUrl}
							onChange={(e) => setHostUrl(e.target.value)}
							required
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor={`${role}-storage`}>Storage (JSON)</Label>
						<Textarea
							id={`${role}-storage`}
							className="font-mono text-xs min-h-[200px]"
							value={storageText}
							onChange={(e) => setStorageText(e.target.value)}
							spellCheck={false}
						/>
						<p className="text-xs text-muted-foreground">
							Secrets should be ref-strings (e.g. <code>secret:cluster-xxx-fm-mysql</code>) resolved by the service, not raw values.
						</p>
					</div>
					<div className="flex items-center gap-2 justify-between">
						<Button
							type="submit"
							disabled={saving || !hostUrl.trim()}
							size="sm"
						>
							{saving ? (
								<Loader2 className="w-4 h-4 mr-1 animate-spin" />
							) : (
								<Save className="w-4 h-4 mr-1" />
							)}
							{server ? "Save changes" : "Create server"}
						</Button>
						{server && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="text-red-600 hover:bg-red-50"
								onClick={onDelete}
								disabled={deleting}
							>
								{deleting ? (
									<Loader2 className="w-4 h-4 mr-1 animate-spin" />
								) : (
									<Trash2 className="w-4 h-4 mr-1" />
								)}
								Unlink
							</Button>
						)}
					</div>
					{server && (
						<p className="text-xs text-muted-foreground">
							Status: <code>{server.status}</code>
							{server.last_seen ? (
								<>
									{" "}
									· last seen{" "}
									<code>
										{new Date(server.last_seen).toLocaleString()}
									</code>
								</>
							) : null}
						</p>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
