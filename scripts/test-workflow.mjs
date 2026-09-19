// Runs src/workflow/workflow.test.ts.
//
// The repo has no test runner (no vitest, no tsx) and node here is v20, which
// predates --experimental-strip-types — so the tests are bundled with esbuild,
// which is already present as a vite dependency. No new package is added.
//
//   node scripts/test-workflow.mjs
//
// The `@/` alias is mapped the same way vite.config.mts maps it. Nothing is
// written to the repo: the bundle goes to a temp file and is removed after.

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The bundle must sit INSIDE the repo, not in /tmp: `packages: "external"`
// leaves `yaml` and `@dagrejs/dagre` as bare imports, and node resolves those
// by walking up from the importing file to a node_modules. From /tmp there is
// none, so the run dies with ERR_MODULE_NOT_FOUND on a package that is in fact
// installed. Kept out of src/ so it can never be picked up by tsc or vite.
const dir = await mkdtemp(join(root, ".wf-test-"));
const outfile = join(dir, "workflow.test.mjs");

try {
	await build({
		entryPoints: [join(root, "src/workflow/workflow.test.ts")],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		// Keep real dependencies external so we test against the same `yaml` and
		// `@dagrejs/dagre` the app ships, not a re-bundled copy.
		packages: "external",
		alias: { "@": join(root, "src") },
		logLevel: "warning",
		// The adapters pull in LoopOrbit for LOOP_STAGES, which imports lucide
		// icons and (transitively) React. Stub the pieces a node run cannot use.
		loader: { ".css": "empty" },
	});
	await import(pathToFileURL(outfile).href);
} finally {
	await rm(dir, { recursive: true, force: true });
}
