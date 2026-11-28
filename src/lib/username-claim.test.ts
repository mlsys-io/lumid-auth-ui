// Claim-a-login words and polling rules. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { UsernameClaim } from "../api/username";
import {
	CLAIM_POLL_MAX_MS, claimInstruction, claimResumeNote, claimLoginProblem, claimStartError, claimVerifiedText, claimView, keepPolling, timeLeftWords,
} from "./username-claim";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

const now = new Date("2026-11-28T10:00:00Z");
const claim = (over: Partial<UsernameClaim> = {}): UsernameClaim =>
	({ id: 1, login: "junyi", status: "pending", expires_at: "2026-11-29T09:00:00Z", ...over });

check("no claim → nothing to show", () => eq(claimView(null, now), null));
check("waiting says how machines check and how long the command works", () => {
	const v = claimView(claim(), now)!;
	eq(v.kind, "waiting");
	eq(v.text, "Waiting for a machine to see the file. Each machine checks every 2 minutes; the command works for 23 more hours.");
});
check("verified names the login (and the machine when known)", () => {
	eq(claimView(claim({ status: "verified" }), now)!.text, "junyi is now your username");
	eq(claimView(claim({ status: "verified", host: "luyao0" }), now)!.text, "junyi is now your username (seen on luyao0)");
	eq(claimVerifiedText("junyi"), "junyi is now your username");
});
check("expired, by status or by clock", () => {
	eq(claimView(claim({ status: "expired" }), now)!.kind, "expired");
	eq(claimView(claim({ expires_at: "2026-11-28T09:59:59Z" }), now)!.kind, "expired");
	eq(claimView(claim({ status: "expired" }), now)!.text.includes("Start again"), true);
});
check("rejected says someone else proved it and what to do", () => {
	eq(claimView(claim({ status: "rejected" }), now)!.text, "Someone else proved junyi first. If it is your login, ask an admin.");
});
check("after 30 minutes of asking, a waiting claim tells the person what to check", () => {
	const v = claimView(claim(), now, CLAIM_POLL_MAX_MS)!;
	eq(v.kind, "gave-up");
	eq(v.text.includes("logged in as junyi"), true);
});
check("poll only while waiting and under 30 minutes", () => {
	eq(keepPolling(claim(), now, 0), true);
	eq(keepPolling(claim(), now, CLAIM_POLL_MAX_MS - 1), true);
	eq(keepPolling(claim(), now, CLAIM_POLL_MAX_MS), false);
	eq(keepPolling(claim({ status: "verified" }), now, 0), false);
	eq(keepPolling(claim({ status: "expired" }), now, 0), false);
	eq(keepPolling(null, now, 0), false);
});
check("time left in words", () => {
	eq(timeLeftWords("2026-11-28T10:15:00Z", now), "15 more minutes");
	eq(timeLeftWords("2026-11-28T10:01:30Z", now), "1 more minute");
	eq(timeLeftWords("2026-11-28T10:00:30Z", now), "less than a minute");
	eq(timeLeftWords("2026-11-28T13:00:00Z", now), "3 more hours");
	eq(timeLeftWords("not a date", now), "less than a minute");
});
check("instruction names the login", () => eq(claimInstruction("junyi"), "Run this on any machine where you log in as junyi:"));
check("resume note says the command is not kept", () =>
	eq(claimResumeNote("junyi"), "You asked to claim junyi. If you no longer have the command, start again for a new one."));
check("login shape uses the username rules", () => { eq(claimLoginProblem("junyi"), null); eq(claimLoginProblem("Junyi"), "Use lowercase letters"); });
check("start errors in words, never a bare code", () => {
	eq(claimStartError(400, "that is not one of the existing logins on our machines; pick a new username instead"),
		"That is not one of the existing logins on our machines; pick a new username instead");
	eq(claimStartError(409, "that login is already someone's username"), "That login is already someone's username");
	eq(claimStartError(401, "auth required"), "You are signed out. Sign in again, then claim the login.");
	eq(claimStartError(500, "boom"), "Could not start the claim (server error, HTTP 500). Try again in a minute.");
	eq(claimStartError(undefined, undefined), "Could not reach lum.id. Check your connection and try again.");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;
