// Per-turn telemetry footer for Claude Code turns.
//
// The CLI's `result` event carries cost, wall/API duration, time-to-first-token,
// turn count and the cache hit/creation split. Identity forwards it as
// `turn_stats` (named distinctly from the per-user budget `usage` event on the
// direct-Anthropic path). All of it used to be dropped at the bridge.

export type TurnStats = {
	costUsd?: number;
	durationMs?: number;
	durationApiMs?: number;
	ttftMs?: number;
	numTurns?: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
};

/** Pull the fields we render out of the raw SSE event. */
export function parseTurnStats(evt: Record<string, any>): TurnStats {
	const u = (evt.usage && typeof evt.usage === 'object' ? evt.usage : {}) as Record<string, any>;
	const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
	return {
		costUsd: num(evt.cost_usd),
		durationMs: num(evt.duration_ms),
		durationApiMs: num(evt.duration_api_ms),
		ttftMs: num(evt.ttft_ms),
		numTurns: num(evt.num_turns),
		inputTokens: num(u.input_tokens),
		outputTokens: num(u.output_tokens),
		cacheReadTokens: num(u.cache_read_input_tokens),
		cacheCreationTokens: num(u.cache_creation_input_tokens),
	};
}

function dur(ms?: number): string | undefined {
	if (ms === undefined) return undefined;
	return ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function tok(n?: number): string | undefined {
	if (!n) return undefined;
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function TurnStatsFooter({ s }: { s: TurnStats }) {
	const cost = s.costUsd !== undefined
		// Sub-cent turns are common; $0.00 would read as free.
		? (s.costUsd < 0.01 ? `<$0.01` : `$${s.costUsd.toFixed(s.costUsd < 1 ? 3 : 2)}`)
		: undefined;

	// Cache hit rate is the single most useful number here: a resumed session
	// should be reading almost everything from cache, and a collapse in this
	// number is what a broken --resume looks like.
	const cacheTotal = (s.cacheReadTokens || 0) + (s.cacheCreationTokens || 0) + (s.inputTokens || 0);
	const cachePct = cacheTotal > 0 && s.cacheReadTokens
		? Math.round((s.cacheReadTokens / cacheTotal) * 100)
		: undefined;

	const parts: Array<[string, string | undefined, string]> = [
		['cost', cost, 'pooled account cost for this turn'],
		['took', dur(s.durationMs), `wall clock${s.durationApiMs !== undefined ? ` · ${dur(s.durationApiMs)} in API` : ''}`],
		['first token', dur(s.ttftMs), 'time to first token'],
		['steps', s.numTurns !== undefined ? String(s.numTurns) : undefined, 'model turns (each tool round-trip is one)'],
		['out', tok(s.outputTokens), 'output tokens'],
		['cache', cachePct !== undefined ? `${cachePct}%` : undefined,
			`${tok(s.cacheReadTokens) || 0} read${s.cacheCreationTokens ? ` · ${tok(s.cacheCreationTokens)} written` : ''}`],
	];
	const shown = parts.filter(([, v]) => v !== undefined);
	if (!shown.length) return null;

	return (
		<div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums">
			{shown.map(([label, value, title]) => (
				<span key={label} title={title} className="inline-flex items-center gap-1">
					<span className="opacity-60">{label}</span>
					<span className="text-foreground/70">{value}</span>
				</span>
			))}
		</div>
	);
}
