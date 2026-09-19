// check-catalog.mjs — does our hand-written registry still cover the runtime?
//
//   node scripts/check-catalog.mjs
//
// The registry in src/workflow/registry/lumilake.ts is written by hand, on
// purpose: the labels, hints, ordering and conditionals are the product, and a
// form generated from a bare field list is exactly the stock look we are
// avoiding. The cost of that choice is DRIFT — the Python grows a field and the
// panel silently stops offering it.
//
// Two things contain that cost. The inspector renders any unmodelled parameter
// in its Advanced group, so nothing is ever hidden or dropped. And this script
// fails the build when an op the runtime marks required has no field here.
//
// It compares against a committed snapshot rather than calling the MCP tool
// live: `lumilake_node_specs` is not reachable from CI, and a check that cannot
// reach its target is not a check. Refresh the snapshot deliberately, as a
// reviewable diff, when the runtime changes.

import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(root, "src/workflow/registry/__fixtures__/lumilake-node-specs.json");
const dir = await mkdtemp(join(root, ".wf-test-"));

try {
	const spec = JSON.parse(await readFile(fixturePath, "utf8"));

	const outfile = join(dir, "registry.mjs");
	await build({
		entryPoints: [join(root, "src/workflow/registry/lumilake.ts")],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		packages: "external",
		alias: { "@": join(root, "src") },
		logLevel: "warning",
	});
	const { LUMILAKE_REGISTRY } = await import(pathToFileURL(outfile).href);

	const problems = [];
	for (const { op, required } of spec.ops) {
		const entry = LUMILAKE_REGISTRY[op];
		if (!entry) {
			problems.push(`${op}: the runtime offers this op, the registry has no schema for it.`);
			continue;
		}
		// A field's FIRST path segment is the top-level parameter it writes.
		const covered = new Set();
		for (const section of entry.sections) {
			for (const field of section.fields) covered.add(String(field.path[0]));
		}
		for (const key of required) {
			if (!covered.has(key)) {
				problems.push(`${op}: required parameter \`${key}\` has no field in the registry.`);
			}
		}
	}

	// The reverse direction is a warning, not a failure: we may legitimately
	// describe a parameter the snapshot does not list as required.
	const known = new Set(spec.ops.map((o) => o.op));
	for (const op of Object.keys(LUMILAKE_REGISTRY)) {
		if (!known.has(op)) {
			console.warn(`  ! ${op}: in the registry but not in the snapshot — is the snapshot stale?`);
		}
	}

	if (problems.length) {
		console.error(`catalog drift (${problems.length}):`);
		for (const p of problems) console.error(`  ✗ ${p}`);
		console.error(`\nEither add the field in src/workflow/registry/lumilake.ts, or refresh`);
		console.error(`the snapshot at src/workflow/registry/__fixtures__/lumilake-node-specs.json.`);
		process.exitCode = 1;
	} else {
		console.log(`catalog: ${spec.ops.length} ops, every required parameter is covered`);
	}
} finally {
	await rm(dir, { recursive: true, force: true });
}
