// /studio/skills — skills as a first-class surface (Workstream E).
//
// Master–detail mirroring My Apps:
//   left  — Installed (the union of every skill the user's apps import:
//           health dot from skill-ci's lineage, update badge, used-by
//           count) + Discover (the marketspace catalog, skill-roster's
//           published output).
//   right — detail: readme (LumidMarkdown), health, used-by chips that
//           deep-link into the owning app's observability panel.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Puzzle, RefreshCw, ArrowUpCircle, Compass, ExternalLink } from "lucide-react";
import { me, type MeSkillRow, type MeSkillCard } from "@/api/me";
import { LumidMarkdown } from "@/components/app-surface/LumidMarkdown";
import { StatusDot } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSection } from "@/components/ui/page-section";
import PageHints from "@/components/PageHints";
import { setStudioSelection } from "@/components/StudioContext";
import { loopLabel } from "@/lib/workflow-names";
import { cn } from "@/lib/utils";

function healthTone(h?: MeSkillRow["health"]): "ok" | "failing" | "attention" | "idle" {
	if (!h) return "idle";
	if (h.adapter_status === "broken" || h.ci_status === "failing" || h.ci_status === "broken") return "failing";
	if (h.adapter_status === "flaky" || h.ci_status === "flaky") return "attention";
	if (h.adapter_status === "ok" || h.ci_status === "ok" || h.ci_status === "passing") return "ok";
	return "idle";
}

export default function StudioSkills() {
	const [rows, setRows] = useState<MeSkillRow[] | null>(null);
	const [cards, setCards] = useState<MeSkillCard[] | null>(null);
	const [params, setParams] = useSearchParams();
	const selected = params.get("selected");

	useEffect(() => {
		me.skills().then((r) => setRows(r.skills || [])).catch(() => setRows([]));
		me.skillsDiscover().then((r) => setCards((r.cards || []).slice(0, 30))).catch(() => setCards([]));
	}, []);

	const sel = useMemo(() => rows?.find((r) => r.repo === selected) || null, [rows, selected]);

	// Declare the open skill for the chat rail.
	useEffect(() => {
		if (!sel) return;
		setStudioSelection({ kind: "skill", id: sel.repo, label: sel.name });
		return () => setStudioSelection(null);
	}, [sel?.repo]);

	const select = (repo: string) => {
		const sp = new URLSearchParams(params);
		sp.set("selected", repo);
		setParams(sp, { replace: true });
	};

	return (
		<div className="space-y-5">
			<PageHints prompts={[
				"Which of my skills are failing CI?",
				"What skills does my personal agent use?",
				"Find a skill for summarizing arXiv papers",
			]} />

			<div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
				{/* ── master column ── */}
				<div className="space-y-5">
					<PageSection title={`Installed (${rows?.length ?? "…"})`}>
						{rows === null ? (
							<div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
						) : rows.length === 0 ? (
							<EmptyState
								icon={Puzzle}
								title="No skills yet"
								body="Skills arrive with apps — each app's skill_imports pull shared capabilities (market data, LLM clients, prompt cards) your workflows call."
								actionLabel="Browse the marketplace"
								to="/studio/marketplace"
							/>
						) : (
							<ul className="space-y-1">
								{rows.map((r) => (
									<li key={r.repo}>
										<button
											type="button"
											onClick={() => select(r.repo)}
											className={cn(
												"w-full text-left rounded-lg border px-2.5 py-2 transition-colors",
												selected === r.repo
													? "border-emerald-300 bg-emerald-50/50"
													: "border-slate-200 bg-white hover:bg-slate-50",
											)}
										>
											<div className="flex items-center gap-2 min-w-0">
												<StatusDot tone={healthTone(r.health)} />
												<span className="text-[12.5px] font-medium text-slate-800 truncate flex-1">{r.name}</span>
												{r.update_available && (
													<span title={`update available: ${r.version_installed} → ${r.version_latest}`}>
														<ArrowUpCircle className="w-3.5 h-3.5 text-sky-500 flex-shrink-0" />
													</span>
												)}
											</div>
											<div className="text-[10.5px] text-slate-400 mt-0.5 pl-4 truncate">
												{r.version_installed ? `v${r.version_installed} · ` : ""}
												used by {r.used_by.length} app{r.used_by.length === 1 ? "" : "s"}
											</div>
										</button>
									</li>
								))}
							</ul>
						)}
					</PageSection>

					<PageSection title="Discover">
						{cards === null ? (
							<div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
						) : cards.length === 0 ? (
							<div className="text-[11.5px] text-slate-400 italic">Catalog unreachable right now.</div>
						) : (
							<ul className="space-y-1">
								{cards.slice(0, 8).map((c) => (
									<li key={c.name} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
										<div className="flex items-center gap-2">
											<Compass className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
											<span className="text-[12.5px] font-medium text-slate-800 truncate flex-1">{c.display_name || c.name}</span>
											{c.category && <span className="text-[9.5px] text-slate-400 uppercase tracking-wide flex-shrink-0">{c.category}</span>}
										</div>
										{c.summary && <p className="text-[10.5px] text-slate-500 mt-0.5 pl-5.5 line-clamp-2">{c.summary}</p>}
										<div className="pl-5 mt-1">
											<button
												onClick={() => window.dispatchEvent(new CustomEvent("studio:ask", {
													detail: { prompt: `Add the "${c.display_name || c.name}" skill to one of my apps — help me pick which app and wire it in.`, autosend: true },
												}))}
												className="text-[10.5px] text-emerald-700 hover:text-emerald-900 font-medium transition-colors"
											>
												Add to an app…
											</button>
										</div>
									</li>
								))}
							</ul>
						)}
					</PageSection>
				</div>

				{/* ── detail column ── */}
				<div>
					{sel ? (
						<SkillDetail row={sel} />
					) : (
						<EmptyState
							icon={Puzzle}
							title="Pick a skill"
							body="Select an installed skill to see its readme, CI health, and which of your apps and workflows depend on it."
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function SkillDetail({ row }: { row: MeSkillRow }) {
	const [readme, setReadme] = useState<string | null>(null);
	const [owner, name] = row.repo.includes("/")
		? [row.repo.slice(0, row.repo.indexOf("/")), row.repo.slice(row.repo.indexOf("/") + 1)]
		: ["", row.repo];

	useEffect(() => {
		setReadme(null);
		if (!owner) return;
		me.skillDetail(owner, name)
			.then((r) => setReadme(r.readme || ""))
			.catch(() => setReadme(""));
	}, [row.repo]);

	const h = row.health;
	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
			<div className="flex items-start gap-3">
				<div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
					<Puzzle className="w-4 h-4" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h2 className="text-[15px] font-semibold text-slate-900 truncate">{row.name}</h2>
						<StatusDot tone={healthTone(h)} />
						{row.version_installed && <span className="text-[11px] text-slate-400 font-mono">v{row.version_installed}</span>}
						{row.update_available && (
							<span className="inline-flex items-center gap-1 text-[10.5px] text-sky-700 bg-sky-50 border border-sky-200/60 rounded-full px-2 py-0.5">
								<ArrowUpCircle className="w-3 h-3" /> v{row.version_latest} available
							</span>
						)}
					</div>
					<div className="text-[11px] text-slate-400 font-mono truncate">{row.repo}</div>
					{row.summary && <p className="text-[12px] text-slate-600 mt-1">{row.summary}</p>}
				</div>
				<a
					href={`https://xp.io/${row.repo}`}
					target="_blank" rel="noreferrer"
					className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0"
				>
					xp.io <ExternalLink className="w-3 h-3" />
				</a>
			</div>

			{h && (
				<div className="flex flex-wrap items-center gap-3 text-[11.5px] text-slate-600 border-t border-slate-100 pt-3">
					{h.adapter_status && <span>adapter: <b className={h.adapter_status === "broken" ? "text-rose-600" : "text-slate-800"}>{h.adapter_status}</b></span>}
					{h.ci_status && <span>CI: <b className={/fail|broken/.test(h.ci_status) ? "text-rose-600" : "text-slate-800"}>{h.ci_status}</b></span>}
					{h.ci_last_run && <span className="inline-flex items-center gap-1 text-slate-400"><RefreshCw className="w-3 h-3" />checked {h.ci_last_run}</span>}
				</div>
			)}

			<PageSection title={`Used by (${row.used_by.length})`}>
				{row.used_by.length === 0 ? (
					<div className="text-[11.5px] text-slate-400 italic">No installed app imports this skill.</div>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{row.used_by.flatMap((u) =>
							(u.loops?.length ? u.loops : [""]).map((loop) => (
								<Link
									key={`${u.app}:${loop}`}
									to={loop ? `/studio/apps/${encodeURIComponent(u.app)}?selected=${encodeURIComponent(loop)}` : `/studio/apps/${encodeURIComponent(u.app)}`}
									className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 transition-colors"
								>
									{u.app}{loop ? ` · ${loopLabel(undefined, loop)}` : ""}
								</Link>
							)),
						)}
					</div>
				)}
			</PageSection>

			<PageSection title="Readme">
				{readme === null ? (
					<div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
				) : readme === "" ? (
					<div className="text-[11.5px] text-slate-400 italic">No readme available.</div>
				) : (
					<div className="prose-sm max-w-none">
						<LumidMarkdown source={readme} />
					</div>
				)}
			</PageSection>
		</div>
	);
}
