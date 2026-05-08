// Super-admin dashboard API. Hits lumid_identity's /api/v1/admin/*
// surface introduced in P3.1. Same-origin from lum.id, so the
// lm_session cookie + the SuperAdminGuard at the route level is the
// only auth — no scoped bearer needed.

import apiClient from './client';
import type { DataResponse } from './types';

// ---- /admin/auth-stats ----

export interface AuthStatsBucket {
	total: number;
	failed: number;
}

export interface AuthStatsHourly {
	hour: string;
	total: number;
	failed: number;
}

export interface AuthStats {
	window: string;
	generated_at: string;
	login: AuthStatsBucket;
	oauth: AuthStatsBucket;
	hourly: AuthStatsHourly[];
}

export async function fetchAuthStats(): Promise<AuthStats> {
	const r = await apiClient.get<DataResponse<AuthStats>>('/api/v1/admin/auth-stats');
	return r.data.data;
}

// ---- /admin/qa-summary ----

export interface QASummary {
	strategies: { total: number; active: number };
	competitions: { total: number; ongoing: number; upcoming: number };
	trades_24h: { count: number };
	generated_at: string;
}

export async function fetchQASummary(): Promise<QASummary> {
	const r = await apiClient.get<DataResponse<QASummary>>('/api/v1/admin/qa-summary');
	return r.data.data;
}

// ---- /admin/cert-expiry ----

export interface CertRow {
	domain: string;
	expires_at: string;
	days_left: number;
}

export interface CertExpiry {
	certificates: CertRow[];
	checked_at: string;
}

export async function fetchCertExpiry(): Promise<CertExpiry> {
	const r = await apiClient.get<DataResponse<CertExpiry>>('/api/v1/admin/cert-expiry');
	return r.data.data;
}

// ---- /admin/backup-status ----

export interface BackupJob {
	job: string;
	last_run: string;
	age_hours: number;
	healthy: boolean;
}

export interface BackupStatus {
	jobs: BackupJob[];
	verify: { healthy: boolean; last_run?: string };
	checked_at: string;
}

export async function fetchBackupStatus(): Promise<BackupStatus> {
	const r = await apiClient.get<DataResponse<BackupStatus>>('/api/v1/admin/backup-status');
	return r.data.data;
}

// ---- /admin/build-status ----

export interface BuildService {
	service: string;
	current_image?: string;
	current_tag?: string;
	last_build_at?: string;
	pending_update?: boolean;
	latest_tag?: string;
	ci_run_url?: string;
}

export interface BuildStatus {
	services: BuildService[];
	generated_at: string;
	note?: string;
}

export async function fetchBuildStatus(): Promise<BuildStatus> {
	const r = await apiClient.get<DataResponse<BuildStatus>>('/api/v1/admin/build-status');
	return r.data.data;
}

// ---- /admin/oauth-clients (super_admin only) ----

export interface OAuthClient {
	client_id: string;
	name: string;
	is_public: boolean;
	grant_types: string[];
	allowed_scopes: string[];
	redirect_uris: string[];
	created_at: string;
}

export interface OAuthClientsResp {
	clients: OAuthClient[];
	total: number;
}

export async function fetchOAuthClients(): Promise<OAuthClientsResp> {
	const r = await apiClient.get<DataResponse<OAuthClientsResp>>(
		'/api/v1/admin/oauth-clients',
	);
	return r.data.data;
}
