import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Key, Loader2, Plus, Server } from "lucide-react";

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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { buildSshTaskYaml, submitWorkflow, type RentalSpec } from "@/api/flowmesh";
import {
	listSshKeys,
	uploadSshKey,
	type SshKey,
} from "@/api/ssh-keys";
import { saveLocalRental } from "./storage";

const IMAGE_PRESETS: { id: string; label: string; value: string | undefined; desc: string }[] = [
	{
		id: "default-ssh",
		label: "FlowMesh SSH (default)",
		value: undefined,
		desc: "FlowMesh's bundled GPU-aware SSH image — sshd + CUDA + Python.",
	},
	{
		id: "pytorch",
		label: "PyTorch 2.3 + CUDA 12.1",
		value: "pytorch/pytorch:2.3.0-cuda12.1-cudnn8-runtime",
		desc: "Official PyTorch runtime. Needs sshd + your public key injected at boot (FM wrapper handles this).",
	},
	{
		id: "python",
		label: "Python 3.12 slim (CPU)",
		value: "python:3.12-slim",
		desc: "CPU-only Python image. Good for scripting / toolchain debugging.",
	},
	{
		id: "custom",
		label: "Custom image",
		value: "__custom__",
		desc: "Bring your own image reference.",
	},
];

export default function GpuRentalWizard() {
	const navigate = useNavigate();
	const { user } = useAuth();

	const [name, setName] = useState("");
	const [gpu, setGpu] = useState("1");
	const [gpuMemory, setGpuMemory] = useState("16");
	const [cpu, setCpu] = useState("2");
	const [memGb, setMemGb] = useState("8");
	const [imagePreset, setImagePreset] = useState<string>("default-ssh");
	const [customImage, setCustomImage] = useState("");
	const [envText, setEnvText] = useState("");
	const [mode, setMode] = useState<"proxy" | "direct" | "forward">("proxy");
	const [ttlMinutes, setTtlMinutes] = useState("60");
	const [idleMinutes, setIdleMinutes] = useState("15");

	const [keys, setKeys] = useState<SshKey[]>([]);
	const [keysLoading, setKeysLoading] = useState(true);
	const [selectedKeyId, setSelectedKeyId] = useState<string>("");
	const [addingKey, setAddingKey] = useState(false);
	const [newKeyTitle, setNewKeyTitle] = useState("");
	const [newKeyBody, setNewKeyBody] = useState("");
	const [submittingKey, setSubmittingKey] = useState(false);

	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		listSshKeys()
			.then((ks) => {
				setKeys(ks);
				if (ks.length > 0) setSelectedKeyId(String(ks[0].id));
				else setAddingKey(true);
			})
			.catch((e) => {
				toast.error(`Load SSH keys: ${(e as Error)?.message ?? e}`);
			})
			.finally(() => setKeysLoading(false));
	}, []);

	const selectedKey = useMemo(
		() => keys.find((k) => String(k.id) === selectedKeyId),
		[keys, selectedKeyId],
	);

	const resolvedImage = useMemo(() => {
		const p = IMAGE_PRESETS.find((i) => i.id === imagePreset);
		if (!p) return undefined;
		if (p.value === "__custom__") return customImage.trim() || undefined;
		return p.value;
	}, [imagePreset, customImage]);

	async function onAddKey() {
		if (!newKeyTitle.trim() || !newKeyBody.trim()) {
			toast.error("Title + public key body required");
			return;
		}
		setSubmittingKey(true);
		try {
			const created = await uploadSshKey({
				title: newKeyTitle.trim(),
				public_key: newKeyBody.trim(),
			});
			setKeys((old) => [created, ...old]);
			setSelectedKeyId(String(created.id));
			setAddingKey(false);
			setNewKeyTitle("");
			setNewKeyBody("");
			toast.success("Key added");
		} catch (e) {
			toast.error((e as Error)?.message ?? "Upload failed");
		} finally {
			setSubmittingKey(false);
		}
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) return toast.error("Name required");
		if (!selectedKey) return toast.error("Pick or add an SSH key");

		const envPairs: Record<string, string> = {};
		for (const raw of envText.split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			envPairs[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
		}

		const spec: RentalSpec = {
			name: name.trim(),
			publicKey: selectedKey.public_key,
			user: "flowmesh",
			mode,
			ttlSeconds: Number(ttlMinutes) * 60,
			idleTimeoutSeconds: Number(idleMinutes) * 60,
			gpu: Number(gpu) || 0,
			gpuMemoryGb: Number(gpuMemory) || undefined,
			cpu: Number(cpu) || undefined,
			memoryGb: Number(memGb) || undefined,
			image: resolvedImage,
			envPairs: Object.keys(envPairs).length ? envPairs : undefined,
		};

		setSubmitting(true);
		try {
			const yaml = buildSshTaskYaml(spec);
			const result = await submitWorkflow(yaml);
			const task = result.tasks?.[0];
			if (!task) throw new Error("FlowMesh returned no tasks");
			if (user?.id) {
				saveLocalRental(String(user.id), {
					name: spec.name,
					workflow_id: result.workflow_id,
					task_id: task.task_id,
					created_at: Math.floor(Date.now() / 1000),
					spec_summary: {
						gpu: spec.gpu ?? 0,
						gpuMemoryGb: spec.gpuMemoryGb,
						cpu: spec.cpu,
						memoryGb: spec.memoryGb,
						mode: spec.mode ?? "proxy",
						ttlSeconds: spec.ttlSeconds ?? 3600,
						ssh_key_id: selectedKey.id,
					},
				});
			}
			toast.success("Rental submitted");
			navigate(`/app/gpu-rentals/${encodeURIComponent(task.task_id)}`);
		} catch (e) {
			toast.error((e as Error)?.message ?? "Submit failed");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<>
			<header className="flex items-center gap-3 mb-6">
				<Link to="/app/gpu-rentals">
					<Button variant="ghost" size="sm">
						<ArrowLeft className="w-4 h-4 mr-1" />
						GPU rentals
					</Button>
				</Link>
				<Server className="w-5 h-5 text-indigo-600" />
				<h1 className="text-2xl font-semibold">New GPU rental</h1>
			</header>

			<form onSubmit={onSubmit}>
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					{/* Hardware */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
						<CardHeader>
							<CardTitle className="text-base">Hardware</CardTitle>
							<CardDescription>
								Scheduler matches these against worker capacity. Leave GPU=0 for a CPU-only rental.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label htmlFor="name">Rental name</Label>
								<Input
									id="name"
									required
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="debug-llama"
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1">
									<Label htmlFor="gpu">GPU count</Label>
									<Input
										id="gpu"
										type="number"
										min={0}
										max={8}
										value={gpu}
										onChange={(e) => setGpu(e.target.value)}
									/>
								</div>
								<div className="space-y-1">
									<Label htmlFor="gpu-mem">GPU memory (GB)</Label>
									<Input
										id="gpu-mem"
										type="number"
										min={0}
										value={gpuMemory}
										onChange={(e) => setGpuMemory(e.target.value)}
										disabled={Number(gpu) === 0}
									/>
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1">
									<Label htmlFor="cpu">CPU cores</Label>
									<Input
										id="cpu"
										type="number"
										min={0}
										value={cpu}
										onChange={(e) => setCpu(e.target.value)}
									/>
								</div>
								<div className="space-y-1">
									<Label htmlFor="mem">RAM (GiB)</Label>
									<Input
										id="mem"
										type="number"
										min={0}
										value={memGb}
										onChange={(e) => setMemGb(e.target.value)}
									/>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Software */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
						<CardHeader>
							<CardTitle className="text-base">Software</CardTitle>
							<CardDescription>
								Container image and environment variables.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label>Image</Label>
								<Select value={imagePreset} onValueChange={setImagePreset}>
									<SelectTrigger className="bg-white">
										<SelectValue />
									</SelectTrigger>
									<SelectContent className="z-[200] bg-white border border-slate-200 shadow-xl">
										{IMAGE_PRESETS.map((p) => (
											<SelectItem key={p.id} value={p.id} textValue={p.label}>
												<div className="flex flex-col">
													<span className="font-medium">{p.label}</span>
													<span className="text-xs text-muted-foreground">{p.desc}</span>
												</div>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{imagePreset === "custom" && (
									<Input
										className="mt-2"
										value={customImage}
										onChange={(e) => setCustomImage(e.target.value)}
										placeholder="registry.example.com/team/image:tag"
									/>
								)}
							</div>
							<div className="space-y-1">
								<Label htmlFor="env">Environment (KEY=VALUE per line)</Label>
								<Textarea
									id="env"
									className="font-mono text-xs min-h-[90px]"
									value={envText}
									onChange={(e) => setEnvText(e.target.value)}
									placeholder={`HF_HOME=/mnt/hf\nTRANSFORMERS_OFFLINE=1`}
								/>
							</div>
						</CardContent>
					</Card>

					{/* Access */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm lg:col-span-1">
						<CardHeader>
							<CardTitle className="text-base flex items-center gap-2">
								<Key className="w-4 h-4 text-indigo-600" />
								SSH access
							</CardTitle>
							<CardDescription>
								Your public key lands in the container's authorized_keys. You `ssh` from your laptop.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{keysLoading ? (
								<p className="text-sm text-muted-foreground">Loading keys…</p>
							) : keys.length > 0 ? (
								<div className="space-y-1">
									<Label>Key</Label>
									<Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
										<SelectTrigger className="bg-white">
											<SelectValue />
										</SelectTrigger>
										<SelectContent className="z-[200] bg-white border border-slate-200 shadow-xl">
											{keys.map((k) => (
												<SelectItem key={k.id} value={String(k.id)} textValue={k.title}>
													<div className="flex flex-col">
														<span className="font-medium">{k.title}</span>
														<span className="text-xs text-muted-foreground font-mono">
															{k.key_type} · SHA256:{k.fingerprint.slice(0, 16)}…
														</span>
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									No saved keys yet.
								</p>
							)}

							{!addingKey ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => setAddingKey(true)}
								>
									<Plus className="w-4 h-4 mr-1" />
									Add another key
								</Button>
							) : (
								<div className="space-y-2 rounded-md border p-3 bg-slate-50/60">
									<div className="space-y-1">
										<Label htmlFor="key-title">Title</Label>
										<Input
											id="key-title"
											value={newKeyTitle}
											onChange={(e) => setNewKeyTitle(e.target.value)}
											placeholder="my laptop"
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="key-body">Public key</Label>
										<Textarea
											id="key-body"
											className="font-mono text-xs min-h-[90px]"
											value={newKeyBody}
											onChange={(e) => setNewKeyBody(e.target.value)}
											placeholder="ssh-ed25519 AAAA… user@host"
										/>
									</div>
									<div className="flex justify-end gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => setAddingKey(false)}
											disabled={submittingKey}
										>
											Cancel
										</Button>
										<Button
											type="button"
											size="sm"
											onClick={onAddKey}
											disabled={submittingKey}
										>
											{submittingKey && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
											Save key
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>

					{/* Lifecycle + access mode */}
					<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
						<CardHeader>
							<CardTitle className="text-base">Lifecycle</CardTitle>
							<CardDescription>
								The worker tears the container down at TTL — rent for as long as you need.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Label>Access mode</Label>
								<div className="text-sm flex flex-col gap-2 mt-1">
									{[
										{
											v: "proxy" as const,
											label: "proxy (default)",
											hint: "Client connects through FlowMesh Host via WebSocket. Works behind NAT.",
										},
										{
											v: "direct" as const,
											label: "direct",
											hint: "Client hits the worker's exposed port directly. LAN/VPN only.",
										},
										{
											v: "forward" as const,
											label: "forward",
											hint: "Host allocates a public TCP port that tunnels to the worker.",
										},
									].map(({ v, label, hint }) => (
										<label
											key={v}
											className="flex items-start gap-2 cursor-pointer"
										>
											<input
												type="radio"
												name="mode"
												className="mt-1"
												checked={mode === v}
												onChange={() => setMode(v)}
											/>
											<span>
												<span className="font-medium">{label}</span>
												<span className="ml-2 text-xs text-muted-foreground">{hint}</span>
											</span>
										</label>
									))}
								</div>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1">
									<Label htmlFor="ttl">TTL (minutes)</Label>
									<Input
										id="ttl"
										type="number"
										min={10}
										max={480}
										value={ttlMinutes}
										onChange={(e) => setTtlMinutes(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										Hard cap: 8 h. Container is torn down at expiry regardless of activity.
									</p>
								</div>
								<div className="space-y-1">
									<Label htmlFor="idle">Idle timeout (minutes)</Label>
									<Input
										id="idle"
										type="number"
										min={5}
										max={120}
										value={idleMinutes}
										onChange={(e) => setIdleMinutes(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										Disconnects after this many minutes with no active SSH connection.
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>

				<div className="mt-6 flex items-center gap-2 justify-end">
					<Link to="/app/gpu-rentals">
						<Button type="button" variant="outline" disabled={submitting}>
							Cancel
						</Button>
					</Link>
					<Button
						type="submit"
						disabled={submitting || !name.trim() || !selectedKey}
					>
						{submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
						Create rental
					</Button>
				</div>
			</form>
		</>
	);
}
