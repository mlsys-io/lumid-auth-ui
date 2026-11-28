// Edit the public ports of a RUNNING sandbox: container port + label, add/remove, save. Kept ports keep their
// public number (sandbox-control PUT /api/sandboxes/{name}/ports).
import { useState } from "react";
import { toast } from "sonner";
import { setSandboxPorts, type SandboxPort } from "../../api/sandboxes";
import { Button } from "../../components/ui/button";

export default function PortsEditor({ site, name, ports, max, onDone }: {
	site: string; name: string; ports: SandboxPort[]; max: number; onDone: () => void;
}) {
	const [rows, setRows] = useState(ports.map((p) => ({ port: String(p.container_port), label: p.label ?? "" })));
	const [saving, setSaving] = useState(false);
	const set = (i: number, k: "port" | "label", v: string) =>
		setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: k === "port" ? v.replace(/[^0-9]/g, "") : v } : x)));
	async function save() {
		setSaving(true);
		try {
			const want = rows.filter((r) => r.port).map((r) => ({ port: Number(r.port), label: r.label.trim() }));
			await setSandboxPorts(site, name, want);
			toast.success(want.length ? "Ports saved" : "Ports removed");
			onDone();
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? "could not save the ports");
		} finally { setSaving(false); }
	}
	return (
		<div className="mt-2 space-y-1.5 rounded-md border border-ink-200 bg-ink-50/60 p-2 font-sans" data-testid="ports-editor">
			{rows.map((r, i) => (
				<div key={i} className="flex items-center gap-1.5">
					<input value={r.port} onChange={(e) => set(i, "port", e.target.value)} inputMode="numeric" placeholder="8888"
						aria-label="container port" className="w-20 rounded border border-ink-300 px-1.5 py-0.5 font-mono text-xs" />
					<input value={r.label} onChange={(e) => set(i, "label", e.target.value)} maxLength={40} placeholder="label, e.g. jupyter"
						aria-label="label" className="w-36 rounded border border-ink-300 px-1.5 py-0.5 text-xs" />
					<button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
						className="text-xs text-ink-600 hover:text-brick-700">remove</button>
				</div>
			))}
			<div className="flex items-center gap-2">
				{rows.length < max && (
					<button type="button" onClick={() => setRows((x) => [...x, { port: "", label: "" }])}
						className="text-xs text-plum-700 hover:underline">+ add a port</button>
				)}
				<Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
				<Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
			</div>
			<p className="text-micro text-ink-600">Up to {max}. A port you keep keeps its public address.</p>
		</div>
	);
}
