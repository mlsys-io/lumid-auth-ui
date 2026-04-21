import { http } from '@/runmesh/utils/axios';

export interface ApiTokenVo {
  id: number;
  tokenName: string;
  tokenPrefix: string;
  scopes: string;
  status: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  createTime: string;
  remark: string | null;
}

export interface ApiTokenCreateResult {
  tokenValue: string;
  token: ApiTokenVo;
}

export interface ApiTokenBo {
  tokenName: string;
  scopes?: string;
  expiresAt?: string;
  remark?: string;
}

/** Generate a new API token. Returns the plaintext token ONCE. */
export const generateApiToken = (data: ApiTokenBo) =>
  http.post<ApiTokenCreateResult>('/runmesh/api-tokens', data);

/** List all active tokens for the current user. */
export const listApiTokens = () => http.get<ApiTokenVo[]>('/runmesh/api-tokens/list');

/** Revoke (deactivate) a token. */
export const revokeApiToken = (tokenId: number) =>
  http.put<void>(`/runmesh/api-tokens/${tokenId}/revoke`);

/** Delete a token. */
export const deleteApiToken = (tokenId: number) =>
  http.delete<void>(`/runmesh/api-tokens/${tokenId}`);

/** Regenerate a token: revokes old, returns new with same name/scopes. */
export const regenerateApiToken = (tokenId: number) =>
  http.post<ApiTokenCreateResult>(`/runmesh/api-tokens/${tokenId}/regenerate`);
