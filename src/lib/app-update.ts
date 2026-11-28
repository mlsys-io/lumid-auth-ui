// app-update — what "Get updates" did, in words (round 10, 2026-11-28).
//
// The update merges the published version into the user's install on the
// scheduler, ~10-60 s after the press. The page used to keep the old graph
// with no word until a manual reload. The caller polls the install's config
// until its sha moves; these say what changed.

/** The `version:` of a spec's YAML text, or "". */
export function specVersion(yaml: string | null | undefined): string {
	const m = /^version:\s*['"]?([^'"\s#]+)/m.exec(yaml || "");
	return m ? m[1] : "";
}

/** The sentence after the poll ends. */
export function updateWords(before: { sha?: string; yaml?: string } | null, after: { sha?: string; yaml?: string } | null, timedOut: boolean): { text: string; changed: boolean } {
	const v0 = specVersion(before?.yaml), v1 = specVersion(after?.yaml);
	const changed = !!after?.sha && after.sha !== before?.sha;
	if (changed) return { text: v1 && v1 !== v0 ? `Updated to v${v1}${v0 ? ` (was v${v0})` : ""} — your edits were kept` : "Updated — your edits were kept", changed };
	if (timedOut) return { text: "Still merging the update — it will appear here when it lands", changed: false };
	return { text: v1 ? `You already have the latest version (v${v1})` : "You already have the latest version", changed: false };
}
