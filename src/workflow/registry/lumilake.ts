// registry/lumilake.ts — parameter schemas for the nine Lumilake ops.
//
// Transcribed once, by hand, from the `lumilake_node_specs` catalog. Not
// generated from it: that catalog is an MCP tool, unreachable from a browser,
// and "required fields plus a snippet" is a conformance artifact rather than a
// UI schema — it has no labels, no ordering, no hints and no conditionals, and
// those are the parts that make a form worth using.
//
// The drift risk is real and handled two ways: any parameter not named here
// still renders as raw YAML in the inspector's Advanced group, and
// scripts/check-catalog.mjs asserts in CI that every field the tool marks
// required appears below.
//
// The hints are not filler. Three of them encode failures that have actually
// cost time: `messages` rather than `prompt`, a HuggingFace id rather than a
// lumid-llm mesh alias, and the fact that omitting `outputs:` fails the whole
// job server-side with "Missing output for workflow".

import type { NodeSpec, NodeRegistry, Params } from "./types";

const MODEL_HINT =
	"A HuggingFace id that vLLM can load, e.g. Qwen/Qwen2.5-7B-Instruct. NOT a lumid-llm mesh alias like 'qwen3.6-27b' — Lumilake runs this as a FlowMesh vLLM task and loads the model from HF, so an alias fails with 'not a valid model identifier on huggingface.co'.";

/** The config block shared by every model-backed op. */
const modelFields = (defaultModel: string) => [
	{
		path: ["config", "model"] as (string | number)[],
		label: "Model",
		type: "resource" as const,
		loader: "models" as const,
		required: true,
		placeholder: defaultModel,
		hint: MODEL_HINT,
		validate: (v: unknown) =>
			typeof v === "string" && v.includes("/") === false && v.length > 0
				? "Looks like an alias. Use the full HuggingFace id, e.g. Qwen/Qwen2.5-7B-Instruct."
				: undefined,
	},
	{
		path: ["config", "max_tokens"] as (string | number)[],
		label: "Max tokens",
		type: "number" as const,
		min: 1,
		default: 256,
		hint: "Upper bound on the completion length.",
	},
	{
		path: ["config", "temperature"] as (string | number)[],
		label: "Temperature",
		type: "number" as const,
		min: 0,
		max: 2,
		step: 0.1,
		default: 0.2,
		hint: "0 is deterministic; above ~1 gets loose.",
	},
];

const str = (p: Params, path: (string | number)[]): string | undefined => {
	let cur: unknown = p;
	for (const k of path) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string | number, unknown>)[k];
	}
	return typeof cur === "string" ? cur : undefined;
};

const LLMChatOp: NodeSpec = {
	key: "LLMChatOp",
	family: "lumilake-op",
	label: "LLM chat",
	summary: "A chat completion, run row-wise over its list inputs.",
	subtitleFrom: (p) => str(p, ["config", "model"]) ?? "LLMChatOp",
	sections: [
		{
			title: "Prompt",
			fields: [
				{
					path: ["messages"],
					label: "Messages",
					type: "code",
					language: "yaml",
					required: true,
					hint: "A list of {role, content}. This op takes `messages` — a top-level `prompt` is silently ignored and the task fails downstream.",
					placeholder: "- {role: system, content: Reply in one sentence.}\n- {role: user, content: Greeting}",
				},
			],
		},
		{ title: "Model", fields: modelFields("Qwen/Qwen2.5-7B-Instruct") },
	],
};

const LLMVisionOp: NodeSpec = {
	key: "LLMVisionOp",
	family: "lumilake-op",
	label: "LLM vision",
	summary: "A vision + text completion. Inputs carry image references.",
	subtitleFrom: (p) => str(p, ["config", "model"]) ?? "LLMVisionOp",
	sections: [
		{
			title: "Prompt",
			fields: [
				{
					path: ["messages"],
					label: "Messages",
					type: "code",
					language: "yaml",
					required: true,
					hint: "As LLM chat, with image references in the user content.",
				},
			],
		},
		{ title: "Model", fields: modelFields("Qwen/Qwen2.5-VL-7B-Instruct") },
	],
};

const FormatOp: NodeSpec = {
	key: "FormatOp",
	family: "lumilake-op",
	label: "Format",
	summary: "String-format a template from this op's inputs.",
	subtitleFrom: (p) => {
		const t = str(p, ["template"]);
		return t ? `"${t.slice(0, 30)}${t.length > 30 ? "…" : ""}"` : "FormatOp";
	},
	sections: [
		{
			title: "Template",
			fields: [
				{
					path: ["template"],
					label: "Template",
					type: "text",
					required: true,
					placeholder: "Hello, {name}!",
					hint: "Python str.format syntax. Each {placeholder} is bound below.",
				},
				{
					path: ["format_kwargs"],
					label: "Bindings",
					type: "keyValue",
					hint: "Maps each {placeholder} to an upstream op id or a declared input name.",
				},
			],
		},
	],
};

const LambdaOp: NodeSpec = {
	key: "LambdaOp",
	family: "lumilake-op",
	label: "Lambda",
	summary: "Run a small pure Python function over the inputs, on CPU.",
	subtitleFrom: (p) => {
		const fn = str(p, ["fn_name"]);
		return fn ? `fn ${fn}` : "LambdaOp";
	},
	sections: [
		{
			title: "Function",
			fields: [
				{
					path: ["fn_name"],
					label: "Function name",
					type: "text",
					required: true,
					placeholder: "shout",
					hint: "Must match the def in the code below.",
				},
				{
					path: ["code"],
					label: "Code",
					type: "code",
					language: "python",
					required: true,
					placeholder: "def shout(inputs: tuple[str, ...]) -> str:\n    (x,) = inputs\n    return x.upper()",
					hint: "Receives `inputs` as a tuple, in the order this op's inputs are listed — reordering them changes what the function sees.",
					validate: (v, p) => {
						const fn = str(p, ["fn_name"]);
						if (typeof v === "string" && fn && !v.includes(`def ${fn}`)) {
							return `The code defines no \`def ${fn}\`.`;
						}
						return undefined;
					},
				},
			],
		},
	],
};

const DataRetrievalOp: NodeSpec = {
	key: "DataRetrievalOp",
	family: "lumilake-op",
	label: "Data retrieval",
	summary: "Read from the lumid-data warehouse, by SQL or from S3.",
	subtitleFrom: (p) => {
		const m = str(p, ["data_spec", "mode"]) ?? str(p, ["data_spec", "type"]);
		return m ? `data · ${m}` : "data";
	},
	sections: [
		{
			title: "Source",
			fields: [
				{
					path: ["data_spec", "mode"],
					label: "Mode",
					type: "enum",
					required: true,
					default: "sql",
					options: [
						{ value: "sql", label: "SQL", hint: "A SELECT against a lumid-data app." },
						{ value: "s3", label: "S3", hint: "Objects under a prefix." },
					],
				},
				{
					path: ["data_spec", "template"],
					label: "Query",
					type: "code",
					language: "sql",
					required: true,
					when: (p) => (str(p, ["data_spec", "mode"]) ?? "sql") === "sql",
					hint: "Parameters are written {like_this} and bound below. Use data_catalog() for real schema and table names.",
				},
				{
					path: ["data_spec", "template"],
					label: "Prefix",
					type: "text",
					required: true,
					when: (p) => str(p, ["data_spec", "mode"]) === "s3",
					hint: "An S3 prefix, relative to the app's data root.",
				},
				{
					path: ["data_spec", "params"],
					label: "Parameters",
					type: "code",
					language: "yaml",
					when: (p) => (str(p, ["data_spec", "mode"]) ?? "sql") === "sql",
					hint: "A list of {label, node} — each binds a {placeholder} to an upstream op.",
				},
				{
					path: ["data_spec", "output_format"],
					label: "Output format",
					type: "enum",
					default: "jsonl",
					options: [{ value: "jsonl", label: "JSONL" }, { value: "json", label: "JSON" }],
				},
			],
		},
	],
};

const simpleModelOp = (key: string, label: string, summary: string, model: string): NodeSpec => ({
	key,
	family: "lumilake-op",
	label,
	summary,
	subtitleFrom: (p) => str(p, ["config", "model"]) ?? key,
	sections: [{ title: "Model", fields: modelFields(model) }],
});

const MessageOp: NodeSpec = {
	key: "MessageOp",
	family: "lumilake-op",
	label: "Message",
	summary: "Emit or annotate a value. A passthrough node.",
	subtitleFrom: () => "MessageOp",
	sections: [
		{
			title: "Value",
			fields: [
				{ path: ["content"], label: "Content", type: "text", hint: "Passed through unchanged." },
			],
		},
	],
};

const DataOp: NodeSpec = {
	key: "DataOp",
	family: "lumilake-op",
	label: "Inline data",
	summary: "A literal data source, written into the workflow itself.",
	subtitleFrom: () => "inline data",
	sections: [
		{
			title: "Data",
			fields: [
				{ path: ["data"], label: "Data", type: "code", language: "yaml", hint: "Inline literal values." },
			],
		},
	],
};

export const LUMILAKE_REGISTRY: NodeRegistry = {
	LLMChatOp,
	LLMVisionOp,
	FormatOp,
	LambdaOp,
	DataRetrievalOp,
	MessageOp,
	DataOp,
	EmbeddingOp: simpleModelOp(
		"EmbeddingOp", "Embedding",
		"Text embeddings over the list inputs.", "BAAI/bge-small-en-v1.5",
	),
	ImageGenerationOp: simpleModelOp(
		"ImageGenerationOp", "Image generation",
		"Text-to-image generation.", "stabilityai/sdxl-turbo",
	),
};

/** Seed params for a freshly added op, so a new node is never empty. */
export function seedParams(op: string): Params {
	switch (op) {
		case "LLMChatOp":
			return {
				messages: [{ role: "user", content: "" }],
				config: { model: "Qwen/Qwen2.5-7B-Instruct", max_tokens: 256, temperature: 0.2 },
			};
		case "LLMVisionOp":
			return {
				messages: [{ role: "user", content: "" }],
				config: { model: "Qwen/Qwen2.5-VL-7B-Instruct", max_tokens: 256 },
			};
		case "FormatOp":
			return { template: "Hello, {name}!", format_kwargs: {} };
		case "LambdaOp":
			return { fn_name: "fn", code: "def fn(inputs: tuple[str, ...]) -> str:\n    (x,) = inputs\n    return x\n" };
		case "DataRetrievalOp":
			return { data_spec: { type: "lumid", mode: "sql", template: "SELECT 1", output_format: "jsonl" } };
		case "EmbeddingOp":
			return { config: { model: "BAAI/bge-small-en-v1.5" } };
		case "ImageGenerationOp":
			return { config: { model: "stabilityai/sdxl-turbo" } };
		default:
			return {};
	}
}
