import GpuRentalsList from "./gpu-rentals/list";

// Native surface entry for the `lumid-gpu-rentals` registry key. Forwards the
// `lumid:native` config (title / subtitle / hide_header) to the list.
export default function AppGpuRentals({ config }: { config?: Record<string, unknown> }) {
	return <GpuRentalsList config={config} />;
}
