// What the page says while each site adopts a new username, and whether it is finished. Pure and tested.
import type { RenameResult, UsernameInfo } from "../api/sandboxes";

export type SiteRenameState =
	| { kind: "working" }
	| { kind: "done"; text: string }
	| { kind: "retry"; text: string }
	| { kind: "later"; text: string }
	| { kind: "failed"; text: string };

/** One site's answer to POST /api/username/apply, in words. pending: -> try again. */
export function renameState(r: RenameResult): SiteRenameState {
	if (r.home.startsWith("pending")) return { kind: "retry", text: `still moving your home (${r.home.slice(8) || "waiting"}) — checking again` };
	const stopped = r.stopped?.length ? `; stopped ${r.stopped.length} sandbox${r.stopped.length === 1 ? "" : "es"} (create them again)` : "";
	if (r.home === "moved") return { kind: "done", text: `home moved from ${r.from} to ${r.to}${stopped}` };
	if (r.home === "unchanged") return { kind: "done", text: `already ${r.to} here` };
	if (r.home === "host") return { kind: "done", text: `you are ${r.to} here; your machine home is used${stopped}` };
	if (r.home.startsWith("skipped")) return { kind: "done", text: `you are ${r.to} here; ${r.home.slice(8)}${stopped}` };
	return { kind: "done", text: `you are ${r.to} here` };
}

/** The final check: does the site now report the new name? */
export function verifyState(info: UsernameInfo | null, want: string): SiteRenameState {
	if (!info) return { kind: "later", text: "this site switches to unified usernames later" };
	if (info.user === want) return { kind: "done", text: `checked: you are ${want} here` };
	if (info.username_conflict) return { kind: "failed", text: `not switched: ${info.username_conflict}` };
	if (info.rename_pending) return { kind: "retry", text: `still moving: ${info.rename_pending}` };
	return { kind: "failed", text: `this site still calls you ${info.user}` };
}
