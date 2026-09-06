// CaseBrowser — the `case-browser` native surface: pick a MODE, read a CASE,
// then start.
//
// It exists because the onboarding journey had two dead ends. The roster table
// could list cases but never show one (the server's roster carries only scalar
// fields, truncated at 160 chars), and the app hardcoded a single implicit mode
// — the Overview's row action said "Give me the opening" and the prose told you
// to play interviewer, with no way to choose anything else.
//
// Both are the same screen's job: you cannot sensibly pick a mode without
// seeing what a case is, and you cannot start a case without saying which way
// round the interview runs. So one surface does both and then hands off to the
// chat rail, which is where the interview actually happens (per the app's
// procedure.md: the agent runs the interview in conversation; commands/*.py are
// batch, not per-turn RPC).
//
// Config: { app?: string } — app identity otherwise comes from the /studio/a/:app route.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { me, type MeCasebookCase, type MeCasebookCaseDetail } from "@/api/me";
import type { NativeSurfaceProps } from "./native-registry";

type ModeId = "practice" | "benchmark" | "interview";

type Mode = {
  id: ModeId;
  label: string;
  blurb: string;
  /**
   * What the USER types once the chat opens. The single most useful thing to
   * know before choosing, and it is genuinely different per mode: in Benchmark
   * you are the interviewer and never answer; in Interview you are the
   * candidate and answer everything. Getting that backwards wastes the first
   * two turns of every session.
   */
  youType: string;
  /** What the scorecard is worth in this mode — the honesty line. */
  scoring: string;
  needsCase: boolean;
  /** Built at click time so the case id can be interpolated. */
  prompt: (caseId: string) => string;
};

// Launch prompts are SHOWN TO THE USER as their own first message, so they have
// to read like something a person would type.
//
// They previously carried the machinery — `case(case_id="…", role="interviewer")`,
// a reference to procedure.md, and a meta-instruction about how to format the
// reply. All of it rendered verbatim in the transcript, so a first-time user's
// opening message was function calls and file names. It looked broken and it
// leaked internals for no benefit: the mechanics belong in procedure.md, which
// the agent already reads, and the "tell them what to type next" rule is a
// standing instruction there rather than something to repeat in every prompt.
//
// Keep these short, human, and explicit about the ROLE — that is the one thing
// the agent must not get wrong, since the app's default posture is the opposite.

// The three modes. `scoring` is not decoration: an open-question score has no
// ground truth behind it and must never read as a benchmark number, which is
// the same contract the `judge` tool enforces with its `caveat` field.
const MODES: Mode[] = [
  {
    id: "benchmark",
    label: "AI answers a case",
    blurb: "The analyst works a real casebook case. You play the interviewer.",
    youType: "“next question”, or what the answer got wrong",
    scoring: "Scored against that case's ground truth",
    needsCase: true,
    prompt: (id) =>
      `Let's work case ${id}. I'm the interviewer — give me the opening, then ` +
      `answer the case questions in order.`,
  },
  {
    id: "interview",
    label: "AI interviews you",
    blurb: "Roles reversed — the AI poses the case and scores your answers.",
    youType: "your answer — and ask for any facts you need",
    scoring: "Scored against that case's ground truth",
    needsCase: true,
    // States the role explicitly. The app's default posture is the opposite,
    // and procedure.md's Interviewer-mode section keys off exactly this.
    prompt: (id) =>
      `Interview me on case ${id}. You're the interviewer and I'm the ` +
      `candidate — give me the opening, then wait for my answer before moving on.`,
  },
  {
    id: "practice",
    label: "Ask anything",
    blurb: "Your own question, no case file. Same analyst voice, same rubric.",
    youType: "your consulting question",
    scoring: "Indicative only — no ground truth",
    needsCase: false,
    // Does NOT pretend a question was already asked — it invites one. The old
    // wording ("I'd like to ask an open question") left the agent with nothing
    // to answer and it had to ask what the question was, burning a turn.
    prompt: () =>
      `I'd like to ask my own consulting question — no casebook case. ` +
      `Ask me what it is.`,
  },
];

function startChat(prompt: string, app: string, mode: ModeId, caseId: string) {
  // Same bridge the Overview's row_actions and PageHints use — the chat rail
  // owns the conversation; this surface only grounds and launches it.
  //
  // The MODE travels as context, not as prose. These are fixed workflows chosen
  // by a click, but they used to reach the model as an ordinary sentence, so the
  // first turn was spent inferring intent across ~100 tools — measured at 32s
  // and 53s of thinking. The server turns this into an explicit directive naming
  // the role and the first call, which the user never has to read.
  window.dispatchEvent(
    new CustomEvent("studio:ask", {
      detail: {
        prompt,
        autosend: true,
        context: { app, mode, ...(caseId ? { case_id: caseId } : {}) },
      },
    }),
  );
}

function fieldStr(c: MeCasebookCase, key: string): string {
  const v = c.fields?.[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

export default function CaseBrowser({ config }: NativeSurfaceProps) {
  const params = useParams();
  const app = String(config?.app ?? params.app ?? "");

  const [mode, setMode] = useState<ModeId>("benchmark");
  const [cases, setCases] = useState<MeCasebookCase[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [detail, setDetail] = useState<MeCasebookCaseDetail | null>(null);
  const [detailErr, setDetailErr] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!app) return;
    let live = true;
    me.casebook(app)
      .then((r) => { if (live) setCases(r.cases || []); })
      .catch(() => { if (live) setCases([]); });
    return () => { live = false; };
  }, [app]);

  useEffect(() => {
    if (!app || !selected) { setDetail(null); return; }
    let live = true;
    setDetail(null);
    setDetailErr(false);
    me.casebookCase(app, selected)
      .then((r) => { if (live) setDetail(r); })
      .catch(() => { if (live) setDetailErr(true); });
    return () => { live = false; };
  }, [app, selected]);

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  const shown = useMemo(() => {
    const rows = cases ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) =>
      [c.label, c.id, fieldStr(c, "industry"), fieldStr(c, "difficulty"), fieldStr(c, "topic")]
        .join(" ").toLowerCase().includes(needle),
    );
  }, [cases, q]);

  const canStart = activeMode.needsCase ? Boolean(selected) : true;

  return (
    <div className="space-y-5">
      {/* 1. Mode — the first decision, because it changes what the case is FOR. */}
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Choose a mode
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => {
            const on = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={on}
                className={[
                  "text-left rounded-xl border p-3 transition-colors",
                  on
                    ? "border-foreground/30 bg-foreground/[0.05]"
                    : "border-border hover:bg-foreground/[0.02]",
                ].join(" ")}
              >
                <div className="text-sm font-medium text-foreground">{m.label}</div>
                <div className="mt-1 text-[12px] text-muted-foreground leading-snug">{m.blurb}</div>
                {/* The decisive line: what YOU type. Whether you answer or ask
                    flips between modes, and getting it wrong wastes the first
                    turns of a session. */}
                <div className="mt-2 text-[12px] text-foreground/70 leading-snug">
                  <span className="text-muted-foreground">You type: </span>{m.youType}
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground/80">{m.scoring}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Case — hidden entirely for the mode that doesn't use one, rather
             than shown disabled: an unusable list is just noise. */}
      {activeMode.needsCase && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="min-w-0">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
              aria-label="Filter cases"
              placeholder={
                cases ? `Filter ${cases.length} cases…` : "Loading cases…"
              }
              className="w-full mb-2 px-3 py-2 text-[13px] rounded-lg border border-border bg-transparent"
            />
            <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {cases === null && (
                <div className="p-3 text-[12px] text-muted-foreground italic">Loading…</div>
              )}
              {cases !== null && shown.length === 0 && (
                <div className="p-3 text-[12px] text-muted-foreground italic">
                  {cases.length === 0
                    ? "No cases available for this app yet."
                    : "No case matches that filter."}
                </div>
              )}
              {shown.map((c) => {
                const on = c.id === selected;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className={[
                      "w-full text-left px-3 py-2 transition-colors",
                      on ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]",
                    ].join(" ")}
                  >
                    <div className="text-[13px] text-foreground truncate">{c.label || c.id}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {[fieldStr(c, "industry"), fieldStr(c, "difficulty")].filter(Boolean).join(" · ")}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. The case itself — the thing you could never read before. */}
          <div className="min-w-0">
            {!selected && (
              <div className="text-[13px] text-muted-foreground italic">
                Pick a case to read it before you start.
              </div>
            )}
            {selected && detailErr && (
              <div className="text-[13px] text-muted-foreground italic">
                Couldn't load that case.
              </div>
            )}
            {selected && !detail && !detailErr && (
              <div className="text-[13px] text-muted-foreground italic">Loading case…</div>
            )}
            {detail && detail.unavailable && (
              <div className="text-[13px] text-muted-foreground italic">
                This case isn't readable from here yet.
              </div>
            )}
            {detail && !detail.unavailable && (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {detail.source?.title || detail.id}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {[detail.industry, detail.topic, detail.difficulty,
                      detail.expected_duration_minutes ? `${detail.expected_duration_minutes} min` : "",
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>

                {detail.opening_prompt && (
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                      Opening
                    </div>
                    <p className="text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {detail.opening_prompt}
                    </p>
                  </div>
                )}

                {detail.client_context && Object.keys(detail.client_context).length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                      Client
                    </div>
                    <dl className="text-[13px] space-y-0.5">
                      {Object.entries(detail.client_context).map(([k, v]) =>
                        typeof v === "string" || typeof v === "number" ? (
                          <div key={k} className="flex gap-2">
                            <dt className="text-muted-foreground shrink-0">{k.replace(/_/g, " ")}</dt>
                            <dd className="text-foreground/90 min-w-0">{String(v)}</dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  </div>
                )}

                {/* WHO IS ASKING decides whether the questions are shown.
                    As the interviewer you need to see what you will ask. As the
                    CANDIDATE, reading Q1-Q4 before the interview starts is
                    reading ahead — it removes the thinking-on-your-feet the
                    exercise exists to measure. So show the shape, not the
                    content. (Withholding them here is the same instinct as the
                    interviewer withholding structure_2 during the case.) */}
                {detail.questions && detail.questions.length > 0 && (
                  mode === "interview" ? (
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                        Questions
                      </div>
                      <p className="text-[13px] text-muted-foreground">
                        {detail.questions.length} questions
                        {" — "}
                        {detail.questions.map((qq) => qq.type).filter(Boolean).join(", ")}.
                        {" "}You'll get them one at a time, hidden until asked.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                        Questions ({detail.questions.length})
                      </div>
                      <ol className="space-y-1.5">
                        {detail.questions.map((qq) => (
                          <li key={qq.q_id} className="text-[13px]">
                            <span className="text-muted-foreground">{qq.q_id}</span>
                            {qq.type && (
                              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/70">
                                {qq.type}
                              </span>
                            )}
                            <div className="text-foreground/90">{qq.question_text}</div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Start — one button, whose label says what is about to happen. */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={!canStart}
          onClick={() => startChat(activeMode.prompt(selected), app, activeMode.id, selected)}
          className={[
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            canStart
              ? "bg-foreground text-background hover:opacity-90"
              : "bg-foreground/10 text-muted-foreground cursor-not-allowed",
          ].join(" ")}
        >
          {activeMode.id === "interview"
            ? "Interview me"
            : activeMode.id === "practice"
              ? "Ask a question"
              : "Start case"}
        </button>
        {/* Restate the input at the moment of committing — the mode card may
            have scrolled out of view behind a 50-case list. */}
        <span className="text-[12px] text-muted-foreground">
          {activeMode.needsCase && !selected
            ? "Pick a case first."
            : <>Opens the chat · then you type <span className="text-foreground/70">{activeMode.youType}</span></>}
        </span>
      </div>
    </div>
  );
}
