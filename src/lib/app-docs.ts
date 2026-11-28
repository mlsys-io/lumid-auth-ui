// App guides live in their app (2026-11-28, operator: "app related docs move to
// app"). A guide that belongs to one app is a page of that app now — Quant
// Research's Guide tab, MBB Consultant's Guide — not a card in /studio/docs.
//
// The old links keep working: /studio/docs/<slug> opens the app's page for
// anyone who has the app, and for anyone who has not (a visitor reading the
// onboarding before installing) it renders the SAME file, read from the app's
// published bundle. There is one copy of each guide: the app's.

/** The operator's account, which publishes the first-party apps. */
const FIRST_PARTY = "a3f48236-ffe9-4fb9-9548-6e044d5cd9c7";

export interface AppDoc {
	app: string;        // the app's name (its install name)
	appTitle: string;   // how the app is called on screen
	owner: string;      // the publisher, for reading the published bundle
	surface: string;    // the app page id that shows this guide
	file: string;       // the file in the app's bundle
}

export const APP_DOCS: Record<string, AppDoc> = {
	"quant-quickstart": { app: "quant-research", appTitle: "Quant Research", owner: FIRST_PARTY, surface: "guide_quickstart", file: "ui/guide/quickstart.md" },
	"first-run": { app: "quant-research", appTitle: "Quant Research", owner: FIRST_PARTY, surface: "guide_onboarding", file: "ui/guide/onboarding.md" },
	"lqt-strategies": { app: "quant-research", appTitle: "Quant Research", owner: FIRST_PARTY, surface: "guide_strategies", file: "ui/guide/strategies.md" },
	"lqt-backtest-data": { app: "quant-research", appTitle: "Quant Research", owner: FIRST_PARTY, surface: "guide_backtest_data", file: "ui/guide/backtest-data.md" },
	"lqt-signals": { app: "quant-research", appTitle: "Quant Research", owner: FIRST_PARTY, surface: "guide_signals", file: "ui/guide/signals.md" },
	"mbb-consultant": { app: "mbb-consultant", appTitle: "MBB Consultant", owner: FIRST_PARTY, surface: "guide", file: "ui/guide.md" },
};

/** Where the guide opens inside its app. */
export function appDocHref(d: AppDoc): string {
	return `/studio/apps/${encodeURIComponent(d.app)}?surface=${encodeURIComponent(d.surface)}`;
}

/** The guide's markdown, read from the app's published bundle (anonymous: the
 *  same-origin /api/v1/repos proxy serves public repos to anyone). */
export async function fetchAppDoc(d: AppDoc, init?: RequestInit): Promise<string> {
	const url = `/api/v1/repos/${encodeURIComponent(d.owner)}/${encodeURIComponent(d.app)}/blob/main/${d.file
		.split("/").map(encodeURIComponent).join("/")}`;
	const r = await fetch(url, { cache: "no-store", ...init });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const body = (await r.json()) as { content?: unknown };
	if (typeof body.content !== "string") throw new Error("the app's guide came back empty");
	return body.content;
}
