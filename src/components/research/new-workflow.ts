// new-workflow — how any place asks the research home to open "New workflow".
//
// The sheet (WorkflowSheet) is mounted by the app's research home. Everything
// else asks for it:
//   - inside the home (its header, the empty state): openNewWorkflow(app), a
//     window CustomEvent `studio:new-workflow` with {app};
//   - from elsewhere (the sidebar, the workflow switcher, the old
//     /studio/a/:app/manage?new=1): go to newWorkflowPath(app), i.e.
//     /studio/apps/<app>?new=1, which the home turns into the same request.
// The home listens with useNewWorkflowRequests (the event) and
// useNewWorkflowParam (?new=1). Asking never saves or runs anything.
//
// Kept apart from WorkflowSheet.tsx so the callers don't pull in the sheet.

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

export const NEW_WORKFLOW_EVENT = "studio:new-workflow";

export interface NewWorkflowRequest { app: string }

/** Ask the research home of `app` (if it is on screen) to open the New workflow sheet. */
export function openNewWorkflow(app: string): void {
	window.dispatchEvent(new CustomEvent<NewWorkflowRequest>(NEW_WORKFLOW_EVENT, { detail: { app } }));
}

/** Where to go to open the sheet from anywhere: the app's home, which opens it. */
export function newWorkflowPath(app: string): string {
	return `/studio/apps/${encodeURIComponent(app)}?new=1`;
}

/** Call `cb` whenever something asks to open New workflow for `app`. */
export function useNewWorkflowRequests(app: string, cb: () => void): void {
	const ref = useRef(cb);
	ref.current = cb;
	useEffect(() => {
		const on = (e: Event) => {
			const d = (e as CustomEvent<NewWorkflowRequest | undefined>).detail;
			if (d?.app === app) ref.current();
		};
		window.addEventListener(NEW_WORKFLOW_EVENT, on);
		return () => window.removeEventListener(NEW_WORKFLOW_EVENT, on);
	}, [app]);
}

/**
 * Call `cb` once when the page's URL carries ?new=1 (then drop it from the URL,
 * so a reload or Back doesn't reopen the sheet). Also fires when ?new=1 is
 * added while the page is already open.
 */
export function useNewWorkflowParam(app: string, cb: () => void): void {
	const [params, setParams] = useSearchParams();
	const ref = useRef(cb);
	ref.current = cb;
	const wanted = params.get("new") === "1";
	useEffect(() => {
		if (!wanted || !app) return;
		ref.current();
		setParams((prev) => { const sp = new URLSearchParams(prev); sp.delete("new"); return sp; }, { replace: true });
	}, [wanted, app, setParams]);
}
