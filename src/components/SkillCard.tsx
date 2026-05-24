// Phase A2 — SkillCard
//
// Deliberately spartan: name + one-line summary + add/remove. No score,
// no verified chip, no kind glyph. The composer ranks cards by an opaque
// `relevance` float surfaced by /skills/catalog (Phase B6); the value
// never renders to the DOM.
//
// Compare RepoCard, which intentionally exposes the kind glyph + star/
// fork counts for browsing — RepoCard is the GitHub-shaped experience;
// this is the "set up your AI" experience and hides the machinery.

export type SkillCardData = {
  name: string;
  display_name?: string;
  summary: string;
  tags?: string[];
};

export function SkillCard({
  skill,
  selected,
  onToggle,
}: {
  skill: SkillCardData;
  selected: boolean;
  onToggle: () => void;
}) {
  const title = skill.display_name || skill.name;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={[
        "group w-full text-left p-4 rounded-xl border transition-colors",
        selected
          ? "border-soul-300 bg-soul-50/60 ring-1 ring-soul-300/40"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {title}
          </div>
          <div className="mt-1 text-xs text-gray-600 leading-relaxed line-clamp-2">
            {skill.summary}
          </div>
        </div>
        <span
          aria-hidden="true"
          className={[
            "shrink-0 mt-0.5 w-6 h-6 rounded-full inline-flex items-center justify-center text-sm",
            selected
              ? "bg-soul-300 text-white"
              : "border border-gray-300 text-gray-400 group-hover:text-gray-600 group-hover:border-gray-400",
          ].join(" ")}
        >
          {selected ? "✓" : "+"}
        </span>
      </div>
    </button>
  );
}
