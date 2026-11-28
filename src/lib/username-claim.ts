// Claiming an existing machine login as your username (Sandboxes page → "Your username"). Pure and tested
// (username-claim.test.ts). The person asks for a claim, runs one command as that login on any of our machines,
// and a checker on each machine (every 2 minutes) sees the file and binds the name. The server is the judge.
import type { UsernameClaim } from "../api/username";
import { usernameProblem } from "./username";

/** How often the page asks whether a machine has seen the file, and for how long it keeps asking. */
export const CLAIM_POLL_MS = 10_000;
export const CLAIM_POLL_MAX_MS = 30 * 60_000;

export const CLAIM_OFFER = "Have a login on our machines already? Claim it";
export const CLAIM_EXPLAIN =
	"Type the login you use on the office, home or NUS machines. You get one command to run there; running it as that login proves the login is yours.";

export type ClaimViewKind = "waiting" | "verified" | "expired" | "rejected" | "gave-up";
export interface ClaimView {
	kind: ClaimViewKind;
	text: string;
}

/** Shape check while typing; the server also checks the login exists on our machines and is free. */
export function claimLoginProblem(login: string): string | null {
	return usernameProblem(login);
}

/** The line above the command. */
export function claimInstruction(login: string): string {
	return `Run this on any machine where you log in as ${login}:`;
}

/** "23 more hours" / "15 more minutes" / "less than a minute". */
export function timeLeftWords(expiresAt: string, now: Date): string {
	const ms = new Date(expiresAt).getTime() - now.getTime();
	if (!Number.isFinite(ms) || ms <= 60_000) return "less than a minute";
	const min = Math.floor(ms / 60_000);
	if (min < 120) return `${min} more minute${min === 1 ? "" : "s"}`;
	return `${Math.floor(min / 60)} more hours`;
}

/** Shown when the page reopens on a waiting claim: the command itself was shown once and is not kept. */
export function claimResumeNote(login: string): string {
	return `You asked to claim ${login}. If you no longer have the command, start again for a new one.`;
}

/** The success line. */
export function claimVerifiedText(login: string): string {
	return `${login} is now your username`;
}

/**
 * What the card says about a claim. `pollingFor` = how long this page has been asking (ms); past CLAIM_POLL_MAX_MS
 * a still-waiting claim reads "gave-up" so the person checks what they ran instead of watching a spinner.
 */
export function claimView(claim: UsernameClaim | null, now: Date, pollingFor = 0): ClaimView | null {
	if (!claim) return null;
	const { login } = claim;
	const lapsed = new Date(claim.expires_at).getTime() <= now.getTime();
	switch (claim.status) {
		case "verified":
			return { kind: "verified", text: claim.host ? `${claimVerifiedText(login)} (seen on ${claim.host})` : claimVerifiedText(login) };
		case "rejected":
			return { kind: "rejected", text: `Someone else proved ${login} first. If it is your login, ask an admin.` };
		case "expired":
			return { kind: "expired", text: "That command expired before a machine saw it. Start again for a new one." };
		case "pending":
			if (lapsed) return { kind: "expired", text: "That command expired before a machine saw it. Start again for a new one." };
			if (pollingFor >= CLAIM_POLL_MAX_MS)
				return { kind: "gave-up", text: `Still waiting after 30 minutes. Check you ran the command while logged in as ${login}, then press Check again.` };
			return {
				kind: "waiting",
				text: `Waiting for a machine to see the file. Each machine checks every 2 minutes; the command works for ${timeLeftWords(claim.expires_at, now)}.`,
			};
	}
	return null;
}

/** Keep asking only while the claim is waiting and this page has asked for less than 30 minutes. */
export function keepPolling(claim: UsernameClaim | null, now: Date, pollingFor: number): boolean {
	return claimView(claim, now, pollingFor)?.kind === "waiting";
}

/** Why starting a claim failed, in words. 400/409 carry the server's own sentence. */
export function claimStartError(status: number | undefined, message: string | undefined): string {
	if ((status === 400 || status === 409) && message) return message.charAt(0).toUpperCase() + message.slice(1);
	if (status === 401) return "You are signed out. Sign in again, then claim the login.";
	if (status) return `Could not start the claim (server error, HTTP ${status}). Try again in a minute.`;
	return "Could not reach lum.id. Check your connection and try again.";
}
