import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Briefcase, ExternalLink, Loader2, Save } from "lucide-react";

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
	getClusterVendor,
	patchClusterVendor,
	type VendorView,
	type VendorPatchRequest,
} from "@/api/cluster";
import { isSessionExpired } from "@/api/client";

interface Props {
	clusterId: string;
}

// CommercialTab — surfaces the Runmesh supplier/vendor row linked to
// this cluster so operators can edit billing-side metadata (contact,
// support tier, contract notes) without leaving the cluster view. The
// two tables stay distinct (operational vs. billing) but the UI is
// unified — one cluster, one admin surface.
export default function CommercialTab({ clusterId }: Props) {
	const [vendor, setVendor] = useState<VendorView | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState<VendorPatchRequest>({});

	async function refresh() {
		setLoading(true);
		try {
			const v = await getClusterVendor(clusterId);
			setVendor(v);
			if (v.linked) {
				setForm({
					contact_person: v.contactPerson ?? "",
					contact_phone: v.contactPhone ?? "",
					contact_email: v.contactEmail ?? "",
					support_level: v.supportLevel ?? "",
					website: v.website ?? "",
					address: v.address ?? "",
					remark: v.remark ?? "",
				});
			}
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Failed to load vendor");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clusterId]);

	async function onSave() {
		setSaving(true);
		try {
			await patchClusterVendor(clusterId, form);
			toast.success("Vendor updated");
			await refresh();
		} catch (e: unknown) {
			if (isSessionExpired(e)) return;
			toast.error((e as Error)?.message || "Save failed");
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardContent className="py-12 text-center text-sm text-muted-foreground">
					<Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
					Loading vendor…
				</CardContent>
			</Card>
		);
	}

	if (!vendor || !vendor.linked) {
		return (
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardContent className="py-12 text-center text-sm text-muted-foreground space-y-2">
					<Briefcase className="w-8 h-8 mx-auto text-muted-foreground" />
					<p>
						No Runmesh vendor linked yet. The supplier row is auto-created
						on the first node registration.
					</p>
					<p className="text-xs">
						Register a node on this cluster (Setup guide → Add a node) to
						bring this page to life.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Briefcase className="w-4 h-4 text-indigo-600" />
						Vendor identity
					</CardTitle>
					<CardDescription>
						Bridge-managed — derived from the cluster. Edit the cluster's
						name/region to flow through.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid grid-cols-2 gap-4 text-sm">
					<Field
						label="Vendor ID"
						value={<code className="text-xs">{vendor.vendorId}</code>}
					/>
					<Field label="Vendor name" value={vendor.vendorName ?? "—"} />
					<Field
						label="Short name"
						value={<code className="text-xs">{vendor.shortName}</code>}
					/>
					<Field label="Brand" value={vendor.brand ?? "—"} />
					<Field label="Country" value={vendor.country ?? "—"} />
					<Field label="Status" value={vendor.status === "0" ? "active" : "stopped"} />
				</CardContent>
			</Card>

			<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<ExternalLink className="w-4 h-4 text-indigo-600" />
						Commercial details
					</CardTitle>
					<CardDescription>
						Contact, support tier, and contract metadata. Saved to Runmesh's
						vendor table; used by billing rollups.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					<FormInput
						label="Contact person"
						value={form.contact_person ?? ""}
						onChange={(v) => setForm({ ...form, contact_person: v })}
					/>
					<FormInput
						label="Contact email"
						type="email"
						value={form.contact_email ?? ""}
						onChange={(v) => setForm({ ...form, contact_email: v })}
					/>
					<FormInput
						label="Contact phone"
						value={form.contact_phone ?? ""}
						onChange={(v) => setForm({ ...form, contact_phone: v })}
					/>
					<FormInput
						label="Support level"
						value={form.support_level ?? ""}
						onChange={(v) => setForm({ ...form, support_level: v })}
						placeholder="e.g. gold | silver"
					/>
					<FormInput
						label="Website"
						type="url"
						value={form.website ?? ""}
						onChange={(v) => setForm({ ...form, website: v })}
						placeholder="https://…"
					/>
					<FormInput
						label="Address"
						value={form.address ?? ""}
						onChange={(v) => setForm({ ...form, address: v })}
					/>
					<div className="space-y-1 lg:col-span-2">
						<Label>Notes</Label>
						<Textarea
							rows={3}
							value={form.remark ?? ""}
							onChange={(e) => setForm({ ...form, remark: e.target.value })}
							placeholder="Contract terms, payment schedule, anything billing-relevant."
						/>
					</div>
					<div className="lg:col-span-2 flex justify-end">
						<Button onClick={onSave} disabled={saving}>
							{saving ? (
								<Loader2 className="w-4 h-4 mr-1 animate-spin" />
							) : (
								<Save className="w-4 h-4 mr-1" />
							)}
							Save
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div>
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-sm mt-0.5 break-all">{value}</div>
		</div>
	);
}

function FormInput({
	label,
	value,
	onChange,
	type = "text",
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	type?: string;
	placeholder?: string;
}) {
	return (
		<div className="space-y-1">
			<Label>{label}</Label>
			<Input
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
			/>
		</div>
	);
}
