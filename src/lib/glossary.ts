// glossary — the user-facing vocabulary, the UI copy of LumidOS
// sdk/vocabulary.py and docs/architecture/GLOSSARY.md. Change all three together.
//
// A 2026-09 audit found three competing vocabularies (U1, labels.ts, and the
// docs + chat tools) and ten words that meant two things on screen: an
// "experiment" was both a multi-arm study and one of its arms, "agent" was the
// actor and a knowledge bank, the Runs page was titled "Jobs". The rule since:
// a string that reaches the screen uses a CANONICAL word. Retired words may
// live on in payload fields and identifiers (variant_id, cycle_ts, loop) until
// their deprecation window closes — never in text a user reads.
//
// scripts/check-glossary.mjs enforces RETIRED_TERMS over JSX text and the
// title / label / placeholder / aria-label attributes, as a ratchet: the hits
// that predate it are frozen in scripts/glossary-baseline.json and may only go
// down.

/** Canonical nouns, grouped the way GLOSSARY.md groups them. */
export const NOUNS = {
	// compose — what an agent is made of
	agent: "the installable actor you run, schedule and address",
	workflow: "an agent's scheduled behavior",
	step: "one unit of a workflow or a compute graph",
	skill: "a capability asset",
	memory: "a knowledge asset (a bank) and its entries",
	dataset: "the data an experiment runs over",
	item: "one record of a dataset",
	// run (round 3, 2026-11-24 — "Novix's look, Lumid's clarity")
	experiment: "a question an app is answering by comparing versions on one metric",
	version: "one setup an experiment tries (the engine calls it an arm)",
	run: "one execution of a workflow",
	// The research graph (2026-11-25): a workflow made from another workflow
	// by changing its steps, code, data or compute is a VARIANT (a child node
	// on the graph); a setup an experiment tries is still a VERSION.
	variant: "a workflow made from another workflow (its child on the graph)",
	feedback: "a step that measures a run in the world: backtest, forward test, simulator, sandbox, judge panel",
	node: "a named group on the graph that workflows can be moved into",
	// compute
	"compute graph": "a FlowMesh or Lumilake DAG built on the canvas; may contain Python steps",
	job: "a compute graph run on Research Fleet",
	site: "home, office, cloud or vast",
} as const;

/** Retired user-facing word → the word to show instead. */
export const RETIRED_TERMS: Record<string, string> = {
	cycle: "run",
	cycles: "runs",
	loop: "workflow",
	loops: "workflows",
	pipeline: "workflow",
	pipelines: "workflows",
	// An arm is one VERSION an experiment tries; the experiment is the
	// question (it used to be called a "study", which nobody could explain).
	// "variant" left this list on 2026-11-25: it now names a workflow made
	// from a workflow (the graph's child node), not an experiment's version.
	attempt: "version",
	attempts: "versions",
	arm: "version",
	arms: "versions",
	study: "experiment",
	studies: "experiments",
	// Plain words for verdicts and history (round 3).
	champion: "winning version",
	champions: "winning versions",
	"not separable": "can't tell apart yet",
	lineage: "changes tried",
	"knowledge agent": "memory",
	"knowledge agents": "memories",
	mesh: "site",
	intent: "agent",
	intents: "agents",
};

/** Canonical action verbs for buttons and menus (docs/architecture/VERBS.md). */
export const VERBS = ["Run", "Cancel", "Define", "Delete", "Publish", "Install", "Feedback"] as const;

/** Button verbs that must not be used — each is a synonym of a canonical verb. */
export const RETIRED_VERBS: Record<string, (typeof VERBS)[number]> = {
	Submit: "Run",
	Dispatch: "Run",
	Enqueue: "Run",
	Queue: "Run",
	Trigger: "Run",
	Kick: "Run",
	Launch: "Run",
	Execute: "Run",
	Stop: "Cancel",
};

/** The canonical word for a retired one (identity for anything else). */
export function canonical(word: string): string {
	return RETIRED_TERMS[word.toLowerCase()] ?? word;
}
