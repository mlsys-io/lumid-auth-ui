// modelShortLabel — the words on the chat's model pill, from the model's own
// name (identity's display_name), never from its id. Ids are historical and
// persisted (`claude-code-qwen35` serves DeepSeek, `kvrun-gemma4` served three
// different models), so a label read from the id names the wrong model; the
// pill used to say "claude-cod…" for DeepSeek's code lane.
//
//   "Claude Sonnet (Code)"         → "Sonnet"
//   "DeepSeek-V4.1-Flash (Chat)"   → "DeepSeek"
//   "DeepSeek-V4.1-Flash (Code)"   → "DeepSeek · Code"
//   "Qwen3.8-27B (Chat)"           → "Qwen3.8-27B"
//
// Claude models only run in the code lane, so they need no "· Code"; any other
// family can appear in both lanes, so its code-lane pill says so.

export type ModelLabelInput = { id: string; display_name?: string | null };

const isCodeLane = (id: string) => id.startsWith("claude-code");

export function modelShortLabel(m: ModelLabelInput): string {
	const raw = (m.display_name ?? "").trim();
	if (!raw) return m.id.length > 12 ? m.id.slice(0, 12) + "…" : m.id;
	let name = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
	const claude = /^Claude\s+/i.test(name);
	if (claude) name = name.replace(/^Claude\s+/i, "");
	if (/^DeepSeek\b/i.test(name)) name = "DeepSeek";
	return isCodeLane(m.id) && !claude ? `${name} · Code` : name;
}
