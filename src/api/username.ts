// Unified username (lum.id identity, /api/v1/user/username): ONE login name + ONE numeric id per person on every
// cluster. Same-origin + lm_session cookie, like ssh-keys.ts.
import apiClient from "./client";
import type { DataResponse } from "./types";

export interface UsernameInfo {
	username: string | null;
	uid: number | null;
	previous: string[] | null;
	/** Present only while no username is set: derived from the email. */
	suggested?: string;
}

export async function getMyUsername(): Promise<UsernameInfo> {
	const r = await apiClient.get<DataResponse<UsernameInfo>>("/api/v1/user/username");
	return r.data.data;
}

export async function setMyUsername(username: string): Promise<UsernameInfo> {
	const r = await apiClient.put<DataResponse<UsernameInfo>>("/api/v1/user/username", { username });
	return r.data.data;
}

// Claim an existing machine login (identity username_claim.go): the person proves they log in as `login` by writing
// a one-time code into ~/.lumid-claim on any of our machines; a verifier on each machine reads it.
export type UsernameClaimStatus = "pending" | "verified" | "expired" | "rejected";

export interface UsernameClaim {
	id: number;
	login: string;
	status: UsernameClaimStatus;
	created_at?: string;
	expires_at: string;
	/** The machine that saw the file (once verified). */
	host?: string;
	verified_at?: string;
}

/** Returned ONLY when a claim starts: the code and the exact command. Never stored, never fetched again. */
export interface StartedUsernameClaim {
	id: number;
	login: string;
	code: string;
	command: string;
	expires_at: string;
}

export async function startUsernameClaim(login: string): Promise<StartedUsernameClaim> {
	const r = await apiClient.post<DataResponse<StartedUsernameClaim>>("/api/v1/user/username/claim", { login });
	return r.data.data;
}

/** The latest claim (status only); null when there is none. */
export async function getUsernameClaim(): Promise<UsernameClaim | null> {
	const r = await apiClient.get<DataResponse<UsernameClaim | null>>("/api/v1/user/username/claim");
	return r.data.data ?? null;
}
