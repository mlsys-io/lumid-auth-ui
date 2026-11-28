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

export interface UsernameCheck {
	name: string;
	ok: boolean;
	/** Why Save would refuse it, in words (taken, reserved, shape). */
	problem?: string;
}

/** Would Save accept this name for me? Null when this identity version has no check endpoint yet. */
export async function checkMyUsername(name: string): Promise<UsernameCheck | null> {
	try {
		const r = await apiClient.get<DataResponse<UsernameCheck>>("/api/v1/user/username/check", { params: { name } });
		return r.data.data;
	} catch {
		return null;
	}
}
