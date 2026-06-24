// labels — the single source of user-facing strings + tooltips for the
// per-workflow panel and its sub-views (WS-2). Plain-language PRIMARY label,
// with the original jargon term kept in the TOOLTIP so power users still have
// the precise word.
//
// Internal code names (loop / cycle / variant / champion / baseline /
// trajectory) stay untouched in the backend payloads and component logic —
// these helpers only translate what reaches the screen. Import from here
// instead of hardcoding so terminology stays consistent and "loop"/"cycle"
// leakage can't creep back in.
//
// U1 unified vocabulary (2026-06-24, see docs/architecture/*.md): the run axis
// is **experiment** (the config you run + compare — absorbs the old
// variant/attempt) over a **dataset**, scoring **items** (absorbs case/dims).
// These labels now SHOW "experiment"; tooltips keep the legacy term for power
// users. The backend field stays `variant_id` (mirrored by `experiment`).

export interface Label {
	/** The plain-language word shown to the user. */
	text: string;
	/** The precise/jargon term, surfaced in a title attribute. */
	tip: string;
}

export const L = {
	// The cross-run branching tree of experiments.
	runTree: { text: "Run tree", tip: "branching tree of experiments (trajectory)" } as Label,
	// One configured run you compare (U1: experiment; was variant/attempt).
	attempt: { text: "experiment", tip: "experiment — one configured run you compare (was variant/attempt)" } as Label,
	attempts: { text: "experiments", tip: "experiments (was variants/attempts)" } as Label,
	// The best-performing experiment so far.
	champion: { text: "best ★", tip: "champion — best so far" } as Label,
	// The starting configuration the tree branches from.
	baseline: { text: "starting point", tip: "baseline" } as Label,
	// Learnings written back into the knowledge graph.
	compound: { text: "saved learnings", tip: "compounded into the knowledge graph" } as Label,
	// One execution of a workflow.
	run: { text: "run", tip: "experiment run (cycle)" } as Label,
	runs: { text: "runs", tip: "experiment runs (cycles)" } as Label,
	// The within-run transcript (one term for what used to be Conversation /
	// Transcript / Trajectory log).
	runLog: { text: "Evaluation", tip: "the run's evaluation record — the within-run transcript (analyst↔judge turns + step/stage events)" } as Label,
	// The data the goal is scored on.
	casesAndData: { text: "Cases & data", tip: "the cases + datasets the goal is scored on" } as Label,
	// The metric scores view (resolves the old "Data" button → Metrics collision).
	metrics: { text: "Metrics", tip: "the metric scores this run is graded on" } as Label,
} as const;

// The three top-level concerns the panel disentangles into.
export const MODE_LABELS = {
	observe: { text: "Observe", tip: "watch a run: history, logs, stages, metrics, cases, health" } as Label,
	improve: { text: "Improve", tip: "experiment: the run tree, branch with intention, compare, promote/discard" } as Label,
	tune: { text: "Tune", tip: "edit what the agents are: the analyst & judge prompts, and config" } as Label,
} as const;

export type WorkflowMode = keyof typeof MODE_LABELS;

// The view names used in the breadcrumb stack — plain-language, one per
// sub-view the panel can push.
export const VIEW_LABELS: Record<string, string> = {
	history: "Run history",
	run: "Run",
	log: L.runLog.text,
	stages: "Stages",
	metrics: L.metrics.text,
	cases: L.casesAndData.text,
	case: "Case",
	tree: L.runTree.text,
	compare: "Compare",
	prompts: "Prompts",
	prompt: "Prompt",
	config: "Config",
};
