// registry/xpio.ts — parameter schemas for a loop's parts.
//
// Four kinds only, because a loop has four kinds of thing in it: a trigger, a
// step, a command engine, and a knowledge sink. Compare FlowMesh's fifteen —
// this dialect is small because the runner, not the document, holds the
// complexity.
//
// The hints here carry contract facts that are easy to get wrong and expensive
// to discover at runtime: a step's `id` is what the runner reports back as
// `step_id` (so renaming one breaks the history that refers to it), `stage` is
// what paints the band, and `required: false` is the difference between a step
// that can fail and a cycle that dies.

import type { NodeSpec, NodeRegistry } from "./types";
import { LOOP_STAGES } from "@/components/workflow/LoopOrbit";

const STAGE_OPTIONS = LOOP_STAGES.map((s) => ({
	value: s.key,
	label: s.label,
}));

const STEP: NodeSpec = {
	key: "xpio.step",
	family: "xpio-step",
	label: "Step",
	summary: "One skill call. Steps run in the order they are written.",
	subtitleFrom: (p) => (typeof p.skill === "string" ? p.skill : "step"),
	sections: [
		{
			title: "Step",
			fields: [
				{
					path: ["id"],
					label: "Id",
					type: "text",
					required: true,
					hint: "The runner reports results under this id, so past cycles refer to it — renaming a step orphans its history.",
				},
				{
					path: ["skill"],
					label: "Skill",
					type: "resource",
					loader: "skills",
					required: true,
					placeholder: "arxiv/fetch",
					hint: "A skill this app imports or defines.",
				},
				{
					path: ["stage"],
					label: "Stage",
					type: "enum",
					options: STAGE_OPTIONS,
					hint: "Which band this step paints into. Left unset, it is inferred from the step's name, then from its position.",
				},
				{
					path: ["required"],
					label: "Required",
					type: "boolean",
					default: true,
					hint: "When false, a failure here is recorded and the cycle carries on.",
				},
			],
		},
		{
			title: "Inputs",
			collapsed: true,
			fields: [
				{ path: ["args"], label: "Arguments", type: "keyValue", hint: "Passed to the skill as named arguments." },
				{
					path: ["knowledge_agent"],
					label: "Knowledge agent",
					type: "resource",
					loader: "knowledgeAgents",
					hint: "The memory bank this step reads from and writes to.",
				},
				{ path: ["experiment"], label: "Experiment", type: "text", hint: "Attributes this step's results to an experiment arm." },
			],
		},
	],
};

const ENGINE: NodeSpec = {
	key: "xpio.engine",
	family: "xpio-engine",
	label: "Command engine",
	summary: "The real execution unit of a command-driven loop. Its declared skills are unordered.",
	subtitleFrom: (p) => {
		const e = p as { module?: string; type?: string };
		return e.module ?? e.type ?? "engine";
	},
	sections: [
		{
			title: "Engine",
			fields: [
				{ path: ["type"], label: "Type", type: "enum", default: "command", options: [{ value: "command", label: "Command" }] },
				{ path: ["module"], label: "Module", type: "text", required: true, placeholder: "cycle", hint: "The module the runner invokes." },
				{ path: ["args"], label: "Arguments", type: "list", hint: "One per line. `{{ args.x }}` is substituted by the runner." },
				{ path: ["experiment"], label: "Experiment", type: "text" },
			],
		},
	],
};

const TRIGGER: NodeSpec = {
	key: "io.trigger",
	family: "io",
	label: "Trigger",
	summary: "When this loop runs.",
	sections: [
		{
			title: "Schedule",
			fields: [
				{
					path: [],
					label: "Schedule",
					type: "text",
					placeholder: "@trigger",
					hint: "A 5-field cron expression, or `@trigger` for manual only. The xpio scheduler runs in America/Los_Angeles, not the container's Asia/Singapore.",
				},
			],
		},
	],
};

const SINK: NodeSpec = {
	key: "io.sink",
	family: "io",
	label: "Knowledge bank",
	summary: "Where this loop banks what it learned.",
	sections: [
		{
			title: "Bank",
			fields: [
				{ path: [], label: "Knowledge agent", type: "resource", loader: "knowledgeAgents", hint: "The agent whose memory this loop grows." },
			],
		},
	],
};

export const XPIO_REGISTRY: NodeRegistry = {
	"xpio.step": STEP,
	"xpio.engine": ENGINE,
	"io.trigger": TRIGGER,
	"io.sink": SINK,
};
