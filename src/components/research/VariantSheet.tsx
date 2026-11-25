// Placeholder until the Make a variant sheet lands (feat/variant-sheet).
import type { AppSpec, SpecWorkflow } from "@/lib/app-spec";
export default function VariantSheet(_props: { app: string; parent?: SpecWorkflow; spec: AppSpec; save: (edit: (t: string) => string, files?: Array<{ path: string; content: string }>) => Promise<unknown>; onClose: () => void; onCreated: (ids: string[]) => void }) {
	return null;
}
