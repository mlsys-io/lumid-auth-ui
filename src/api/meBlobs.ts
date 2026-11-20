// Tenant-private file uploads on lumid-data (`/data/me/blobs`).
//
// The bytes belong to the signed-in account: only it (or an admin) can read
// them back. A FlowMesh python node references one by its `uri` and fetches it
// with that account's token (the node's blobAuth).

const BASE = "/data";

// The ingress caps a request body at 50 MB for this host; a larger file would
// fail with a bare 413, so refuse it here with a message that says why.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface TenantBlob {
  blob_sha256: string;
  uri: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  suggested_name: string | null;
  created_at: string;
  already_existed?: boolean;
}

let _bearer: { token: string; expiresAt: number } | null = null;

async function getBearer(): Promise<string> {
  if (_bearer && _bearer.expiresAt - 60_000 > Date.now()) return _bearer.token;
  const r = await fetch("/api/v1/session-bearer");
  if (!r.ok) throw new Error(`session-bearer ${r.status}`);
  const j = await r.json();
  const tok: string = j.data?.token ?? j.token ?? "";
  if (!tok) throw new Error("session-bearer returned empty token");
  _bearer = { token: tok, expiresAt: Date.now() + 9 * 60_000 };
  return tok;
}

async function errorText(r: Response): Promise<string> {
  try {
    const j = await r.json();
    return j.detail || j.message || `${r.status} ${r.statusText}`;
  } catch {
    return `${r.status} ${r.statusText}`;
  }
}

export const meBlobs = {
  async upload(file: File): Promise<TenantBlob> {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; uploads are limited to 50 MB`);
    }
    const r = await fetch(`${BASE}/me/blobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getBearer()}`,
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": file.name,
      },
      body: file,
    });
    if (!r.ok) throw new Error(`upload failed: ${await errorText(r)}`);
    return r.json();
  },

  async list(): Promise<TenantBlob[]> {
    const r = await fetch(`${BASE}/me/blobs`, { headers: { Authorization: `Bearer ${await getBearer()}` } });
    if (!r.ok) throw new Error(`list failed: ${await errorText(r)}`);
    return (await r.json()).blobs ?? [];
  },
};
