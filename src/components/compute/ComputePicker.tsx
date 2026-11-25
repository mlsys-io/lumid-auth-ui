// ComputePicker — where a workflow's runs go: a site (lib/run-site RUN_SITES)
// and, optionally, how much GPU memory a run needs. Writes the spec's
// `compute: {site, gpu}` shape (lib/app-spec). An empty site means "the app's
// default"; an empty gpu means "no GPU needed".

import { Segmented } from "@/components/ui/segmented";
import { RUN_SITES, isRunSite, runSiteNote } from "@/lib/run-site";

export interface ComputeChoice { site?: string; gpu?: string }

const GPU_SIZES = ["16Gi", "24Gi", "48Gi", "80Gi"];

export function ComputePicker({ value, onChange, inheritedLabel = "App default" }: {
	value: ComputeChoice;
	onChange: (next: ComputeChoice) => void;
	/** What "no site chosen" means here, in words. */
	inheritedLabel?: string;
}) {
	const site = value.site ?? "";
	const gpu = value.gpu ?? "";
	// A site the spec names that this UI doesn't know stays selectable, as written.
	const siteOptions = [
		{ value: "", label: inheritedLabel },
		...RUN_SITES.map((s) => ({ value: s.id as string, label: s.label })),
		...(site && !isRunSite(site) ? [{ value: site, label: site }] : []),
	];
	const gpuOptions = [
		{ value: "", label: "No GPU" },
		...GPU_SIZES.map((g) => ({ value: g, label: g.replace(/Gi$/, " GB") })),
		...(gpu && !GPU_SIZES.includes(gpu) ? [{ value: gpu, label: gpu }] : []),
	];
	const set = (patch: ComputeChoice) => {
		const next = { ...value, ...patch };
		onChange(Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as ComputeChoice);
	};
	return (
		<div className="space-y-3">
			<div>
				<div className="eyebrow text-ink-600 mb-1.5">Site</div>
				<Segmented size="sm" aria-label="Site" options={siteOptions} value={site} onChange={(v) => set({ site: v || undefined })} />
				<p className="text-caption text-ink-600 mt-1.5">
					{isRunSite(site) ? runSiteNote(site) : site ? "A site this page doesn't know; it is kept as written." : "Runs go wherever the app sends them."}
				</p>
			</div>
			<div>
				<div className="eyebrow text-ink-600 mb-1.5">GPU memory per run</div>
				<Segmented size="sm" aria-label="GPU memory" options={gpuOptions} value={gpu} onChange={(v) => set({ gpu: v || undefined })} />
				<p className="text-caption text-ink-600 mt-1.5">
					{gpu ? `Each run asks for a GPU with at least ${gpu.replace(/Gi$/, " GB")} of memory.` : "No GPU asked for."}
				</p>
			</div>
		</div>
	);
}

export default ComputePicker;
