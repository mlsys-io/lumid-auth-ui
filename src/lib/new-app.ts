// New app and Publish (2026-11-28, operator: "we also need a way to create a
// new app, and then publish in marketplace"). Words and checks for the New app
// page (POST /me/apps/new) and Manage → Publish (POST /me/apps/:app/publish).

/** The scheduler's APP_NAME_RE (sdk/ops/apps.py): lowercase, 3–64, starts with a letter, hyphens inside. */
export const APP_NAME_RE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;

/** An app id from its title: "Trace Lab: batch sizes" → "trace-lab-batch-sizes". */
export function appNameFrom(title: string, taken: Iterable<string> = []): string {
	let base = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56).replace(/-+$/, "");
	if (!base) return "";
	if (!/^[a-z]/.test(base)) base = `app-${base}`;
	if (base.length < 3) base = `${base}-app`;
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let i = 2; i < 100; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
	return base;
}

export interface NewAppForm { title: string; name: string; summary: string }

/** Why Create is off, in words (empty = it can go). */
export function newAppProblems(f: NewAppForm, taken: Iterable<string> = []): string[] {
	const out: string[] = [];
	if (!f.title.trim()) out.push("Give it a title.");
	if (f.title.trim().length > 120) out.push("The title is at most 120 characters.");
	const n = f.name.trim();
	if (!n) out.push("It needs an id.");
	else if (!APP_NAME_RE.test(n)) out.push("The id is 3–64 lowercase letters, digits and hyphens, starting with a letter and not ending in a hyphen.");
	else if (new Set(taken).has(n)) out.push(`You already have an app with the id "${n}".`);
	if (f.summary.trim().length > 500) out.push("The summary is at most 500 characters.");
	return out;
}

export type Visibility = "public" | "private";

/** What the Publish button will do, before it does it. */
export function publishPlanWords(visibility: Visibility, firstTime: boolean | null): string {
	const where = visibility === "public"
		? "Anyone can find it in the Marketplace and install their own copy. Their runs, data and spend stay theirs."
		: "Only you can see it. It doesn't appear in the Marketplace.";
	const what = firstTime === true
		? "This publishes it for the first time."
		: firstTime === false ? "This publishes your current version as a new one; installed copies can Get updates." : "This publishes your current version.";
	return `${what} ${where}`;
}

interface PublishResult { ok?: boolean; error?: string; data?: Record<string, unknown>; slug?: string; version?: string; visibility?: string; action?: string }

/** The intent's result, in one sentence (null = it didn't publish; the error says why). */
export function publishedWords(raw: unknown, chosen: Visibility | ""): { ok: boolean; text: string; url?: string } {
	const r = (raw && typeof raw === "object" ? raw : {}) as PublishResult;
	const d = (r.data && typeof r.data === "object" ? r.data : r) as PublishResult;
	const err = r.error || d.error;
	if (err || r.ok === false || d.ok === false) {
		return { ok: false, text: `It didn't publish: ${String(err || "the scheduler gave no reason")}` };
	}
	const slug = typeof d.slug === "string" ? d.slug : "";
	const version = typeof d.version === "string" ? ` v${d.version.replace(/^v/, "")}` : "";
	const vis = (typeof d.visibility === "string" ? d.visibility : chosen) as Visibility | "";
	const where = vis === "public" ? "It's in the Marketplace." : vis === "private" ? "It's private to you." : "";
	return { ok: true, text: `Published${version}. ${where}`.trim(), url: slug ? `https://xp.io/${slug}` : undefined };
}
