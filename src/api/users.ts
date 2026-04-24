// Canonical user-admin client. Hits lumid_identity's
// /api/v1/admin/users + /admin/audit surface. Same-origin from lum.id,
// so the lm_session cookie + AdminGuard are the only auth — no scoped
// bearer needed.

import apiClient from "./client";
import type { BaseResponse, DataResponse } from "./types";

export interface AdminUserRow {
	id: string;
	email: string;
	email_verified: boolean;
	name?: string;
	avatar_url?: string;
	role: "user" | "admin";
	status: "active" | "suspended" | "pending";
	invitation_code_used?: string;
	created_at: string;
	updated_at: string;
	active_token_count: number;
	last_login_at?: string;
}

export interface ListUsersParams {
	status?: "active" | "suspended" | "pending" | "all";
	role?: "user" | "admin" | "all";
	q?: string;
	page?: number;
	page_size?: number;
}

export interface ListUsersResponse {
	users: AdminUserRow[];
	total: number;
	page: number;
	page_size: number;
}

export async function listUsers(
	params: ListUsersParams = {},
): Promise<ListUsersResponse> {
	const r = await apiClient.get<DataResponse<ListUsersResponse>>(
		"/api/v1/admin/users",
		{ params },
	);
	return r.data.data;
}

export async function getUser(id: string): Promise<AdminUserRow> {
	const r = await apiClient.get<DataResponse<{ user: AdminUserRow }>>(
		`/api/v1/admin/users/${encodeURIComponent(id)}`,
	);
	return r.data.data.user;
}

export interface PatchUserRequest {
	role?: "user" | "admin";
	status?: "active" | "suspended" | "pending";
}

export async function patchUser(
	id: string,
	data: PatchUserRequest,
): Promise<AdminUserRow> {
	const r = await apiClient.patch<DataResponse<{ user: AdminUserRow }>>(
		`/api/v1/admin/users/${encodeURIComponent(id)}`,
		data,
	);
	return r.data.data.user;
}

export async function revokeSessions(id: string): Promise<{ revoked: number }> {
	const r = await apiClient.post<DataResponse<{ revoked: number }>>(
		`/api/v1/admin/users/${encodeURIComponent(id)}/revoke-sessions`,
	);
	return r.data.data;
}

export type AccessService =
	| "lumid"
	| "qa"
	| "runmesh"
	| "lumilake"
	| "flowmesh"
	| "xpcloud";

export type AccessLevel = "none" | "read" | "write" | "admin";

export interface AccessRow {
	service: AccessService;
	level: AccessLevel;
	source: string; // "role" | "suspended" | "pat:<prefix>"
}

export async function getUserAccess(id: string): Promise<AccessRow[]> {
	const r = await apiClient.get<
		DataResponse<{ user_id: string; access: AccessRow[] }>
	>(`/api/v1/admin/users/${encodeURIComponent(id)}/access`);
	return r.data.data.access;
}

export interface AuditEntry {
	id: number;
	user_id?: string;
	token_id?: string;
	event: string;
	source?: string;
	method?: string;
	path?: string;
	status?: number;
	duration_ms?: number;
	ip?: string;
	user_agent?: string;
	created_at: string;
}

export interface ListAuditParams {
	user_id?: string;
	event?: string;
	page?: number;
	page_size?: number;
}

export interface ListAuditResponse {
	entries: AuditEntry[];
	total: number;
	page: number;
	page_size: number;
}

export async function listAudit(
	params: ListAuditParams = {},
): Promise<ListAuditResponse> {
	const r = await apiClient.get<DataResponse<ListAuditResponse>>(
		"/api/v1/admin/audit",
		{ params },
	);
	return r.data.data;
}

export function csvExportUrl(params: ListUsersParams = {}): string {
	const qs = new URLSearchParams();
	if (params.status) qs.set("status", params.status);
	if (params.role) qs.set("role", params.role);
	if (params.q) qs.set("q", params.q);
	const s = qs.toString();
	return `/api/v1/admin/users/export.csv${s ? "?" + s : ""}`;
}

// Services in the order the UI renders them. Exposed for the grid view
// so columns stay stable.
export const ACCESS_SERVICES: AccessService[] = [
	"lumid",
	"qa",
	"runmesh",
	"lumilake",
	"flowmesh",
	"xpcloud",
];

// Suppress unused-import warning for the BaseResponse re-export.
export type _BaseResponse = BaseResponse;
