// Which personal access tokens look forgotten, and the words for them
// (pages/account/tokens.tsx). Pure and tested (token-hygiene.test.ts).
//
// An account held ~20 test tokens marked "active", last used 74–124 days ago,
// some carrying claude:proxy or lumid:write (audit, 2026-11-28). Each one is a
// live credential nobody is watching. They are grouped at the top with one
// button to revoke them; nothing is revoked until the reader presses it and
// confirms the list.

import type { PATInfo } from "@/api/identity";

export const STALE_DAYS = 60;
const DAY = 86400;

/** Tokens the platform minted for an app ("<purpose> (…, auto)"). They live
 *  behind their own fold and are never offered for bulk revoke: an app may
 *  hold one it uses rarely. */
export function isAutoMinted(t: Pick<PATInfo, "name">): boolean {
	return /\bauto\)\s*$/.test(t.name);
}

type T = Pick<PATInfo, "status" | "last_used_at" | "create_time" | "expires_at" | "name">;

/** Seconds since the token was last used — or, never used, since it was made.
 *  null when neither is known. */
export function idleSec(t: T, nowSec: number): number | null {
	const since = t.last_used_at > 0 ? t.last_used_at : t.create_time > 0 ? t.create_time : 0;
	return since > 0 ? Math.max(0, nowSec - since) : null;
}

/** Active, hand-made, and not used in STALE_DAYS (or never used and older). */
export function isStaleToken(t: T, nowSec: number): boolean {
	if (t.status !== "active" || isAutoMinted(t)) return false;
	if (t.expires_at > 0 && t.expires_at <= nowSec) return false;
	const idle = idleSec(t, nowSec);
	return idle != null && idle >= STALE_DAYS * DAY;
}

/** Stale tokens (longest idle first) and the rest (in their given order). */
export function groupTokens<P extends T>(tokens: P[], nowSec: number): { stale: P[]; rest: P[] } {
	const stale: P[] = [];
	const rest: P[] = [];
	for (const t of tokens) (isStaleToken(t, nowSec) ? stale : rest).push(t);
	stale.sort((a, b) => (idleSec(b, nowSec) ?? 0) - (idleSec(a, nowSec) ?? 0));
	return { stale, rest };
}

/** "last used 74 days ago" / "never used — made 90 days ago" / "last used just now". */
export function lastUsedWords(t: Pick<PATInfo, "last_used_at" | "create_time">, nowSec: number): string {
	if (t.last_used_at > 0) return `last used ${ago(nowSec - t.last_used_at)}`;
	if (t.create_time > 0) return `never used — made ${ago(nowSec - t.create_time)}`;
	return "never used";
}

function ago(sec: number): string {
	const s = Math.max(0, sec);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < DAY) return `${Math.floor(s / 3600)} h ago`;
	const d = Math.floor(s / DAY);
	return `${d} day${d === 1 ? "" : "s"} ago`;
}

export const STALE_HEADING = `Not used in ${STALE_DAYS}+ days — revoke the ones you don't need`;

/** "Revoke these 12" / "Revoke this one". */
export function revokeTheseLabel(n: number): string {
	return n === 1 ? "Revoke this one" : `Revoke these ${n}`;
}

/** Scopes that let a token write, administer, or spend (claude:proxy). Named in
 *  the confirmation so the risky ones are seen before they're revoked. */
export function powerfulScopes(scopes: readonly string[]): string[] {
	return scopes.filter((s) => s === "*" || /:(write|admin|proxy)$/.test(s) || /^\*:|:\*$/.test(s));
}

/** The toast after a bulk revoke. */
export function bulkRevokeResult(revoked: number, failed: string[]): { ok: boolean; text: string } {
	const done = `Revoked ${revoked} token${revoked === 1 ? "" : "s"}`;
	if (!failed.length) return { ok: true, text: done };
	const names = failed.slice(0, 3).join(", ") + (failed.length > 3 ? ` and ${failed.length - 3} more` : "");
	return { ok: false, text: `${done}; ${failed.length} couldn't be revoked (${names}) — try those again` };
}
