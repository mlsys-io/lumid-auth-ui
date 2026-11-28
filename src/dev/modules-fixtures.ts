// Fixtures for the design gallery's "Compute modules" section: an app with no
// modules, an app with three (one clamped, one refused — a tag, not a digest),
// and a public list whose last refresh failed. Fixed data, no requests: the
// gallery's lum.id is `galleryMeasureClient`, which answers from memory.
import type { MeasureClient, MeasureReply, ModuleListing } from "@/lib/modules";

const D1 = "c0fe3c0f9b379553be127a40cb1b44bf7fdb1519fd7558f6905d7173481f0e14";
const D2 = "9a1d0b7e44c2f6a85d3e1f0c7b2a9e6d4c8f1a3b5e7d9c0a2b4f6e8d1c3a5b7e";

export const MODULES_EMPTY_SPEC = `name: kalshi-scan
title: Kalshi scan
workflows:
- id: scan
  title: Scan the markets
  run: manual
  steps: {python: scan}
`;

export const MODULES_SPEC = `name: mlsys-research
title: MLSys Research
modules:
# Small CPU compute lum.id runs centrally.
- id: trace_stats
  title: Trace statistics
  about: Request count, token-length percentiles and the short-prompt share of a request trace.
  image: ghcr.io/mlsys-io/hello-mlsys-agent@sha256:${D1}
  run: python -m mlab.trace_stats
  inputs:
    trace: rows of {input_tokens, output_tokens_target} (a trace's requests)
    short_max_tokens: prompts at or under this many tokens count as short (default 1024)
  limits: {cpu: 1, memory: 512Mi, timeout_s: 60}
  share: everyone
  public: true
- id: kv_fit
  title: KV-cache fit
  about: Whether a model and batch fit a GPU's memory, from its config.
  image: ghcr.io/mlsys-io/kv-fit@sha256:${D2}
  run: python -m kv_fit
  inputs: {model: "a Hugging Face model id", batch: "number of concurrent requests (default 8)"}
  limits: {cpu: 4, memory: 8Gi, timeout_s: 300}
- id: prompt_hist
  title: Prompt histogram
  image: ghcr.io/mlsys-io/prompt-hist:latest
  run: python -m prompt_hist
workflows:
- id: trace_check
  title: Check a trace
  run: manual
  steps: {module: trace_stats, inputs: {short_max_tokens: 512}}
`;

export const MODULES_LISTING: ModuleListing = {
	instruments: [
		{ name: "mlsys-simulator", kind: "instrument" },
		{
			name: "mlsys-research.trace_stats", kind: "module", title: "Trace statistics", share: "global", public: true,
			image: `ghcr.io/mlsys-io/hello-mlsys-agent@sha256:${D1}`, digest: `sha256:${D1}`,
			limits: { cpu: 1, memory: "512Mi", timeout_s: 60 }, estimate: { from_runs: 3, cpu_s: 5.8, cost_usd: 0.00003 },
		},
		{
			name: "mlsys-research.kv_fit", kind: "module", title: "KV-cache fit", share: "tenant", public: false,
			image: `ghcr.io/mlsys-io/kv-fit@sha256:${D2}`, limits: { cpu: 2, memory: "4096Mi", timeout_s: 300 },
			notes: ["asked for 4 CPUs; a module gets at most 2", "asked for 8Gi memory; a module gets at most 4Gi"],
		},
		{
			name: "mlsys-research.prompt_hist", kind: "module",
			refused: 'module prompt_hist: image "ghcr.io/mlsys-io/prompt-hist:latest" is not pinned by digest; write it as <repo>@sha256:<64 hex> (a tag can change under everyone who reuses its results)',
		},
		{
			name: "8c1f2e/quant-research.returns_summary", kind: "module", public: true, owner: "8c1f2e", app: "quant-research", app_title: "Quant Research",
			title: "Returns summary", about: "Mean, volatility and max drawdown of a returns series.", share: "global",
			limits: { cpu: 1, memory: "256Mi", timeout_s: 30 }, inputs: { returns: "a list of period returns" }, estimate: { from_runs: 12, cpu_s: 1.2 },
		},
	],
	public_modules: { count: 2, ttl_s: 600, built_at: "2026-11-28T06:10:00Z", age_s: 40 },
};

export const MODULES_EMPTY_LISTING: ModuleListing = { instruments: [], public_modules: { count: 0, ttl_s: 600, built_at: "2026-11-28T06:10:00Z", age_s: 40 } };

export const MODULES_STALE_LISTING: ModuleListing = {
	instruments: [
		...MODULES_LISTING.instruments.filter((i) => i.owner),
		{
			name: "3b7d90/mbb-consultant.deck_lint", kind: "module", public: true, owner: "3b7d90", app: "mbb-consultant", app_title: "MBB Consultant",
			title: "Deck lint", about: "Flags slides with more than one message or an unlabelled chart.", share: "tenant",
			limits: { cpu: 1, memory: "1024Mi", timeout_s: 120 }, inputs: { slides: "rows of {title, body}" },
		},
	],
	public_modules: { count: 2, ttl_s: 600, built_at: "2026-11-28T04:02:00Z", age_s: 7700, stale: true, refresh_error: "xp.io answered HTTP 502" },
};

/** A pretend lum.id: "running" once, then an answer — reused on a second try. */
export function galleryMeasureClient(): MeasureClient {
	let calls = 0;
	return {
		measure: async (body): Promise<MeasureReply> => {
			calls++;
			const key = "f".repeat(64);
			if (calls > 1) return { status: "succeeded", key, result: { value: answer(body.inputs), reused: true, usage: { cpu_s: 0, saved_cpu_s: 5.8, metered: "reused" } } };
			return { status: "running", key, retry_after: 1 };
		},
		get: async (key): Promise<MeasureReply> => ({ status: "succeeded", key, result: { value: answer({}), reused: false, usage: { cpu_s: 5.8, cost_usd: 0.00003, metered: "measured" } } }),
		sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 600))),
		now: () => Date.now(),
	};
}

function answer(inputs: Record<string, unknown>) {
	const rows = Array.isArray(inputs.trace) ? inputs.trace.length : 64;
	return { requests: rows, short_share: 0.719, input_tokens_p50: 412, input_tokens_p99: 3790, output_tokens_p50: 180, output_tokens_p99: 1024 };
}
