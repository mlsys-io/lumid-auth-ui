// studio-scope.mjs — WHICH source files render on the Studio surface.
//
//   node scripts/studio-scope.mjs            # print the list
//   import { studioScope } from "./studio-scope.mjs"
//
// Derived, not hand-listed: esbuild walks the import graph from the route
// modules that mount under /studio, /code and /claude-sessions (App.tsx), and
// we keep the files it reaches. A hand-written list kept missing things —
// e.g. /studio/inbox is pages/account/inbox.tsx, not pages/studio/inbox.tsx.
//
// Excluded on purpose:
//   - the ported trees (runmesh, lumilake, quantarena, qa, lqt, admin/clusters):
//     lumid_ui/CLAUDE.md — ported trees keep their own conventions;
//   - src/components/ui (the primitives own their tokens) and src/dev;
//   - the admin-only console pages (pages/app/admin-*, super-admin), which are
//     Runmesh/QuantArena-era ports in all but path.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const ENTRIES = [
	"components/StudioShell.tsx",
	"components/PublicShell.tsx",
	"admin/fm/compute-section.tsx",
	"admin/fm/routes.tsx",
	...[
		"StudioWorkspace", "admin", "apps", "chat", "claude-quota", "claude-sessions", "data", "docs", "experiments",
		"inbox", "intent-detail", "knowledge", "knowledge-encoded", "library", "library-tabs", "repo", "run-detail",
		"runs", "settings", "skills", "strategies",
	].map((p) => `pages/studio/${p}.tsx`),
	...["claude-pool", "connect-google", "connect-microsoft", "connect-power-automate", "findata-sql", "inbox", "profile", "tokens", "memory/new", "skills/new"].map(
		(p) => `pages/account/${p}.tsx`,
	),
	...["billing", "runmesh-submit", "workflow-yaml", "workflows", "workflow-detail", "schedules"].map((p) => `pages/app/${p}.tsx`),
	"pages/dashboard/overview.tsx",
	"pages/dashboard/app-insights.tsx",
	"components/app-surface/AppSurface.tsx",
	"components/app-surface/AppSurfaceEditor.tsx",
	"components/app-surface/AppManagePanel.tsx",
	"components/app-surface/AppConfigEditor.tsx",
	"components/app-surface/AppPromptsEditor.tsx",
];

const EXCLUDE = /^src\/(runmesh|lumilake|quantarena|qa|lqt|admin\/clusters|components\/ui|dev)\//;

export async function studioScope() {
	const { existsSync } = await import("node:fs");
	const entryPoints = ENTRIES.map((e) => join(root, "src", e)).filter((p) => existsSync(p));
	const r = await build({
		entryPoints,
		bundle: true,
		write: false,
		metafile: true,
		outdir: "/tmp/studio-scope-out",
		format: "esm",
		splitting: true,
		packages: "external",
		logLevel: "silent",
		jsx: "automatic",
		alias: { "@": join(root, "src") },
		loader: { ".png": "empty", ".svg": "empty", ".css": "empty", ".md": "empty", ".woff2": "empty" },
	});
	return Object.keys(r.metafile.inputs)
		.map((p) => relative(root, join(root, p)))
		.filter((p) => p.startsWith("src/") && /\.(tsx?|jsx?)$/.test(p) && !EXCLUDE.test(p))
		.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const files = await studioScope();
	console.log(files.join("\n"));
	console.error(`${files.length} files in Studio scope`);
}
