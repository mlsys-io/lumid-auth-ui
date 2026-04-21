export interface UserInfo {
  id: string;
  org_id: string;
  external_id: string;
  type: string;
  status: string;
  email:string;
  phone_number:string;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyResponse {
  id: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string;
  last_used_at: string;
  created_at: string;
  api_key: string;
}