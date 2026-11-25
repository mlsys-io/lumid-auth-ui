// deleteWorkflow — ONE way to delete a workflow, with ONE confirmation that
// says what really happens. Three places offered it (the workflow page's ⋯,
// Manage app, and now the sidebar) with two contradicting messages: "removes
// it and its run history, cannot be undone" vs "its run history stays on
// disk". The server (identity MeLoopDelete) strips the workflow from the app's
// spec and ARCHIVES its run history into .xp/.trash; it refuses the app's last
// workflow and apps shared by the operator.

import { toast } from "sonner";
import { me, MeApiError } from "@/api/me";

export async function deleteWorkflow(app: string, appName: string, loop: string, label: string): Promise<boolean> {
	if (!window.confirm(`Delete the workflow "${label}" from ${appName}?\n\nIt stops running and leaves the app. Its past runs are archived, not erased.`)) return false;
	try {
		await me.deleteLoop(app, loop);
		toast.success(`Deleted "${label}".`);
		// Every list of workflows (sidebar, picker, Manage app) re-reads now.
		window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["workflows", "loops", "apps"] } }));
		return true;
	} catch (e) {
		const msg = e instanceof MeApiError ? e.message : String((e as Error)?.message ?? e);
		toast.error(`Couldn't delete "${label}": ${msg}`);
		return false;
	}
}
