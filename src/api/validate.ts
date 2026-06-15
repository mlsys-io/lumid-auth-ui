// Typed client for POST /api/v1/me/workflows/validate — server-truth
// pre-flight for the new-workflow wizard. The backend reads the composed
// `<slug>-draft` bundle off disk and runs the same checks app-ci enforces
// (manifest_lint + pipeline_shape), so the wizard's Validation card reflects
// what was actually written rather than a client guess.
//
// Independent of me.ts (same lum.id envelope + cookie auth idiom); callers
// treat any failure as "fall back to the client-derived checklist".

const ME_BASE =
	(import.meta.env.VITE_ME_API_BASE as string | undefined) || "https://lum.id";

export interface ValidateCheck {
	check: string;
	status: "pass" | "fail";
	detail: string;
	issues?: string[];
}

export interface ValidateResult {
	slug: string;
	ok: boolean;
	checks: ValidateCheck[];
}

// Validate a composed draft by slug (the value compose returns as draft_slug).
// Throws on transport/auth error so callers can `.catch(() => null)`.
export async function validateWorkflow(draftSlug: string): Promise<ValidateResult> {
	const r = await fetch(`${ME_BASE}/api/v1/me/workflows/validate`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ draft_slug: draftSlug }),
	});
	let json: { ret_code?: number; message?: string; data?: ValidateResult } = {};
	try {
		json = await r.json();
	} catch {
		/* empty / non-JSON body */
	}
	if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0) || !json.data) {
		throw new Error(json.message ?? r.statusText);
	}
	return json.data;
}
