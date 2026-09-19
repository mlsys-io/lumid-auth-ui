// registry/flowmesh.ts — parameter schemas for the fifteen FlowMesh kinds.
//
// Fifteen kinds, but nowhere near fifteen schemas: they share a base of
// resources / model / data / output and differ in one or two blocks. Writing
// them out separately would be fifteen files to keep in sync for no gain, so
// the shape here is `base.concat(specific)` — about five distinct field groups
// in total.
//
// Two hints below encode failures that have actually cost time: a GPU `type` is
// a case-insensitive SUBSTRING matcher rather than a flag (so "RTX 5080" pins a
// model and excludes everything else, and `any` is the wildcard), and an output
// destination of `inline` or `http` is rejected by the deployed server even
// though the field accepts the string.

import type { Field, NodeSpec, NodeRegistry, Params, Section } from "./types";
import { FLOWMESH_KINDS, TASK_TYPE_OF } from "../adapters/flowmesh";

const str = (p: Params, path: (string | number)[]): string | undefined => {
	let cur: unknown = p;
	for (const k of path) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string | number, unknown>)[k];
	}
	return typeof cur === "string" ? cur : undefined;
};

const RESOURCES: Section = {
	title: "Resources",
	fields: [
		{ path: ["resources", "hardware", "cpu"], label: "CPU", type: "number", min: 1, default: 4, hint: "Cores requested." },
		{ path: ["resources", "hardware", "memory"], label: "Memory", type: "text", placeholder: "16GiB", hint: "e.g. 16GiB or 32Gi." },
		{
			path: ["resources", "hardware", "gpu", "type"],
			label: "GPU type",
			type: "text",
			placeholder: "any",
			hint: "A case-insensitive SUBSTRING match, not a flag: \"RTX 5080\" pins that model and excludes every other GPU. Leave as `any` (or blank) for the wildcard.",
		},
		{ path: ["resources", "hardware", "gpu", "count"], label: "GPU count", type: "number", min: 0, default: 0, hint: "0 schedules this on CPU." },
	],
};

const MODEL: Section = {
	title: "Model",
	fields: [
		{
			path: ["model", "source", "type"],
			label: "Source",
			type: "enum",
			default: "huggingface",
			options: [{ value: "huggingface", label: "HuggingFace" }, { value: "http", label: "HTTP" }, { value: "local", label: "Local" }],
		},
		{
			path: ["model", "source", "identifier"],
			label: "Identifier",
			type: "resource",
			loader: "models",
			required: true,
			placeholder: "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
			hint: "The HuggingFace repo id the worker will pull.",
		},
	],
};

const OUTPUT: Section = {
	title: "Output",
	collapsed: true,
	fields: [
		{
			path: ["output", "destination", "type"],
			label: "Destination",
			type: "enum",
			default: "local",
			options: [{ value: "local", label: "Local" }, { value: "http", label: "HTTP callback" }, { value: "s3", label: "S3" }],
			hint: "Lumilake jobs additionally reject anything but s3 or db — inline and http are refused by the deployed server.",
		},
		{ path: ["output", "artifacts"], label: "Artifacts", type: "list", hint: "Files and directories to keep, one per line." },
	],
};

const DATASET_DATA: Section = {
	title: "Data",
	fields: [
		{ path: ["data", "dataset_name"], label: "Dataset", type: "resource", loader: "datasets", placeholder: "openai/gsm8k", hint: "A HuggingFace dataset id." },
		{ path: ["data", "config_name"], label: "Config", type: "text", placeholder: "main" },
		{ path: ["data", "split"], label: "Split", type: "text", placeholder: "train[:5%]", hint: "Slice syntax is supported." },
		{ path: ["data", "prompt_column"], label: "Prompt column", type: "text", placeholder: "question" },
		{ path: ["data", "response_column"], label: "Response column", type: "text", placeholder: "answer" },
		{ path: ["data", "max_samples"], label: "Max samples", type: "number", min: 1 },
	],
};

const INFERENCE_DATA: Section = {
	title: "Data",
	fields: [
		{
			path: ["data", "type"],
			label: "Source type",
			type: "enum",
			default: "list",
			options: [
				{ value: "list", label: "Inline list" },
				{ value: "dataset", label: "HuggingFace dataset" },
				{ value: "graph_template", label: "From upstream nodes", hint: "Combines the outputs of this node's dependsOn." },
				{ value: "sql", label: "SQL" },
			],
		},
		{ path: ["data", "items"], label: "Items", type: "list", when: (p) => (str(p, ["data", "type"]) ?? "list") === "list", hint: "One prompt per line." },
		{ path: ["data", "url"], label: "Dataset", type: "text", when: (p) => str(p, ["data", "type"]) === "dataset", placeholder: "org/dataset" },
		{ path: ["data", "split"], label: "Split", type: "text", when: (p) => str(p, ["data", "type"]) === "dataset" },
		{ path: ["data", "column"], label: "Column", type: "text", when: (p) => str(p, ["data", "type"]) === "dataset" },
	],
};

const TRAINING: Section = {
	title: "Training",
	collapsed: true,
	fields: [
		{ path: ["training", "num_train_epochs"], label: "Epochs", type: "number", min: 1, default: 1 },
		{ path: ["training", "batch_size"], label: "Batch size", type: "number", min: 1, default: 4 },
		{ path: ["training", "learning_rate"], label: "Learning rate", type: "number", step: 0.00001, placeholder: "5e-5" },
		{ path: ["training", "max_seq_length"], label: "Max sequence length", type: "number", min: 1, default: 512 },
		{ path: ["training", "gradient_accumulation_steps"], label: "Grad accumulation", type: "number", min: 1 },
		{ path: ["training", "bf16"], label: "bf16", type: "boolean", hint: "Prefer bf16 over fp16 on Ampere and newer." },
		{ path: ["training", "gradient_checkpointing"], label: "Gradient checkpointing", type: "boolean", hint: "Trades compute for memory." },
		{ path: ["training", "save_model"], label: "Save model", type: "boolean", default: true },
	],
};

const LORA: Section = {
	title: "LoRA",
	fields: [
		{ path: ["lora", "r"], label: "Rank (r)", type: "number", min: 1, default: 16 },
		{ path: ["lora", "alpha"], label: "Alpha", type: "number", min: 1, default: 32 },
		{ path: ["lora", "dropout"], label: "Dropout", type: "number", min: 0, max: 1, step: 0.01, default: 0.05 },
		{ path: ["lora", "target_modules"], label: "Target modules", type: "list", hint: "q_proj, k_proj, v_proj, o_proj — one per line." },
	],
};

const API: Section = {
	title: "Request",
	fields: [
		{ path: ["url"], label: "URL", type: "text", required: true, placeholder: "https://api.example.com/v1/chat/completions" },
		{ path: ["method"], label: "Method", type: "enum", default: "POST", options: [{ value: "POST", label: "POST" }, { value: "GET", label: "GET" }] },
		{ path: ["headers"], label: "Headers", type: "keyValue" },
		{ path: ["body"], label: "Body", type: "code", language: "json" },
	],
};

const SSH: Section = {
	title: "Command",
	fields: [
		{ path: ["command"], label: "Command", type: "code", language: "shell", required: true },
		{ path: ["workdir"], label: "Working directory", type: "text" },
		{ path: ["env"], label: "Environment", type: "keyValue" },
	],
};

const AGENT: Section = {
	title: "Agent",
	fields: [
		{ path: ["configName"], label: "Config", type: "text", placeholder: "examples/search_agent", hint: "An agent config shipped with the worker image." },
		{ path: ["agent", "timeout"], label: "Timeout (s)", type: "number", min: 1, default: 300 },
	],
};

const SERVE: Section = {
	title: "Serving",
	fields: [
		{ path: ["serve", "port"], label: "Port", type: "number", min: 1, default: 8000 },
		{ path: ["serve", "replicas"], label: "Replicas", type: "number", min: 1, default: 1 },
	],
};

/** kind -> the blocks it needs beyond the shared base. */
const EXTRA: Record<string, Section[]> = {
	InferenceTask: [INFERENCE_DATA],
	OmniTask: [INFERENCE_DATA],
	EmbeddingTask: [INFERENCE_DATA],
	DiffusersTask: [INFERENCE_DATA],
	RetrievalTask: [INFERENCE_DATA],
	TrainingTask: [DATASET_DATA, TRAINING],
	SFTTask: [DATASET_DATA, TRAINING],
	LoRASFTTask: [DATASET_DATA, LORA, TRAINING],
	ImageClassificationTask: [DATASET_DATA, TRAINING],
	DataProfilingTask: [DATASET_DATA],
	AgentTask: [AGENT, INFERENCE_DATA],
	ServeTask: [SERVE],
	APITask: [API],
	SSHTask: [SSH],
	EchoTask: [INFERENCE_DATA],
};

/** Kinds that do not load a model, so the Model block would be noise. */
const NO_MODEL = new Set(["APITask", "SSHTask", "EchoTask", "DataProfilingTask"]);

const SUMMARY: Record<string, string> = {
	InferenceTask: "Run a model over a batch of prompts.",
	AgentTask: "Run an agent config against a dataset or a list of tasks.",
	TrainingTask: "Full fine-tune of a base model.",
	SFTTask: "Supervised fine-tune on prompt/response pairs.",
	LoRASFTTask: "LoRA fine-tune — trains an adapter rather than the whole model.",
	OmniTask: "Multi-modal text task.",
	EmbeddingTask: "Produce embeddings for a batch of inputs.",
	DiffusersTask: "Text-to-image generation.",
	ImageClassificationTask: "Train an image classifier.",
	RetrievalTask: "Retrieval-augmented generation over an index.",
	DataProfilingTask: "Profile a dataset without training anything.",
	ServeTask: "Hold a model resident and serve it.",
	APITask: "Call an external HTTP API as a workflow step.",
	SSHTask: "Run a shell command on the worker.",
	EchoTask: "Return the input unchanged — the cheapest way to prove a path works.",
};

function buildSpec(kind: string): NodeSpec {
	const sections: Section[] = [];
	if (!NO_MODEL.has(kind)) sections.push(MODEL);
	sections.push(...(EXTRA[kind] ?? []));
	sections.push(RESOURCES, OUTPUT);
	return {
		key: kind,
		family: "flowmesh-task",
		label: kind.replace(/Task$/, ""),
		summary: SUMMARY[kind] ?? kind,
		subtitleFrom: (p) => str(p, ["model", "source", "identifier"]) ?? str(p, ["data", "dataset_name"]) ?? TASK_TYPE_OF[kind] ?? kind,
		sections,
	};
}

/** The synthetic endpoints a single-task document projects. */
const IO_INPUT: NodeSpec = {
	key: "io.input",
	family: "io",
	label: "Input",
	summary: "Where this task's data comes from. Part of spec.data — it is not a node of its own.",
	sections: [INFERENCE_DATA],
};
const IO_OUTPUT: NodeSpec = {
	key: "io.output",
	family: "io",
	label: "Output",
	summary: "Where results are written. Part of spec.output — it is not a node of its own.",
	sections: [OUTPUT],
};

export const FLOWMESH_REGISTRY: NodeRegistry = {
	...Object.fromEntries(FLOWMESH_KINDS.map((k) => [k, buildSpec(k)])),
	"io.input": IO_INPUT,
	"io.output": IO_OUTPUT,
};

/** A minimal valid document for a new FlowMesh workflow. */
export function seedFlowMeshDoc(kind = "EchoTask", name = "new-task"): string {
	return `apiVersion: flowmesh/v1
kind: ${kind}
metadata:
  name: ${name}

spec:
  taskType: ${TASK_TYPE_OF[kind] ?? "echo"}

  resources:
    hardware:
      cpu: 2
      memory: 4GiB

  data:
    type: list
    items:
      - hello

  output:
    destination:
      type: local
`;
}

export { RESOURCES as FLOWMESH_RESOURCES_SECTION };
export type { Field };
