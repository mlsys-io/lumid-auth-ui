// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { PATInfo } from "@/api/identity";
import {
	STALE_HEADING, isAutoMinted, isStaleToken, groupTokens, lastUsedWords, revokeTheseLabel, powerfulScopes, bulkRevokeResult,
} from "./token-hygiene";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NOW = 1795867200; // 2026-11-28
const DAY = 86400;
let id = 0;
const tok = (name: string, p: Partial<PATInfo> = {}): PATInfo => ({
	id: ++id, name, token_prefix: "lm_pat_live_x", scopes: ["claude:proxy"], status: "active",
	last_used_at: 0, expires_at: 0, revoked_at: 0, create_time: NOW - 200 * DAY, ...p,
});

check("stale = active, hand-made, unused 60+ days (or never used and 60+ days old)", () => {
	eq(isStaleToken(tok("a", { last_used_at: NOW - 74 * DAY }), NOW), true);
	eq(isStaleToken(tok("b", { last_used_at: NOW - 59 * DAY }), NOW), false);
	eq(isStaleToken(tok("c", { last_used_at: NOW - 60 * DAY }), NOW), true);
	eq(isStaleToken(tok("never, old"), NOW), true);
	eq(isStaleToken(tok("never, new", { create_time: NOW - 5 * DAY }), NOW), false);
	eq(isStaleToken(tok("revoked", { status: "revoked", last_used_at: NOW - 100 * DAY }), NOW), false);
	eq(isStaleToken(tok("expired", { last_used_at: NOW - 100 * DAY, expires_at: NOW - DAY }), NOW), false);
	eq(isStaleToken(tok("kalshi read (quant-research, auto)", { last_used_at: NOW - 100 * DAY }), NOW), false);
	eq(isStaleToken(tok("unknown dates", { create_time: 0 }), NOW), false);
});
check("auto-minted tokens are recognised by their name", () => {
	eq(isAutoMinted({ name: "data read (mbb-consultant, auto)" }), true);
	eq(isAutoMinted({ name: "automation" }), false);
});
check("grouping: stale ones longest-idle first, the rest in order", () => {
	const ts = [
		tok("fresh", { last_used_at: NOW - 60 }),
		tok("74d", { last_used_at: NOW - 74 * DAY }),
		tok("124d", { last_used_at: NOW - 124 * DAY }),
		tok("new", { create_time: NOW - DAY }),
	];
	const g = groupTokens(ts, NOW);
	eq(g.stale.map((t) => t.name), ["124d", "74d"]);
	eq(g.rest.map((t) => t.name), ["fresh", "new"]);
});
check("words: last used / never used, and the heading + button", () => {
	eq(lastUsedWords(tok("a", { last_used_at: NOW - 74 * DAY }), NOW), "last used 74 days ago");
	eq(lastUsedWords(tok("a", { last_used_at: NOW - 10 }), NOW), "last used just now");
	eq(lastUsedWords(tok("a", { last_used_at: NOW - DAY }), NOW), "last used 1 day ago");
	eq(lastUsedWords(tok("a", { create_time: NOW - 90 * DAY }), NOW), "never used — made 90 days ago");
	eq(STALE_HEADING, "Not used in 60+ days — revoke the ones you don't need");
	eq(revokeTheseLabel(12), "Revoke these 12");
	eq(revokeTheseLabel(1), "Revoke this one");
});
check("the confirmation names write/admin/proxy scopes", () => {
	eq(powerfulScopes(["claude:proxy", "lumid:write", "lumilake:jobs:read", "flowmesh:workers:read", "lumilake:admin", "*"]), ["claude:proxy", "lumid:write", "lumilake:admin", "*"]);
	eq(powerfulScopes(["lumilake:jobs:write"]), ["lumilake:jobs:write"]);
});
check("bulk result: all revoked, or which ones failed", () => {
	eq(bulkRevokeResult(12, []), { ok: true, text: "Revoked 12 tokens" });
	eq(bulkRevokeResult(1, []), { ok: true, text: "Revoked 1 token" });
	eq(bulkRevokeResult(10, ["a", "b"]), { ok: false, text: "Revoked 10 tokens; 2 couldn't be revoked (a, b) — try those again" });
	eq(bulkRevokeResult(0, ["a", "b", "c", "d", "e"]).text, "Revoked 0 tokens; 5 couldn't be revoked (a, b, c and 2 more) — try those again");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ token-hygiene: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
