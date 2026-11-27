// Ask — the Data Warehouse's question box. A question in plain words goes to the
// chosen store's data agent; the rows it finds are the answer, its text explains
// how, and the SQL it ran is one click away. Words + parsing: lib/ask-data.ts.
//
// Replaces the bare FinData SQL console as the tab's main surface (operator,
// 2026-11-25: "this query tab is not useful … can use AI to query?"). The console
// stays below, folded, for people who want to write SQL themselves.

import { lazy, Suspense, useMemo, useState } from "react";
import { Loader2, Sparkles, Copy, Check } from "lucide-react";
import { LAKE_INSTANCES, askAgentRaw, fetchAnswerRows } from "@/api/dataLake";
import {
	ASK_STORE_IDS, answerNote, askError, cellText, exampleQuestion, noRowsLine, parseAgentStream, parseJsonlRows, rowsSummary,
	type AgentOutcome,
} from "@/lib/ask-data";

const SqlConsole = lazy(() => import("@/components/app-surface/SqlConsole"));

type Answer = { outcome: AgentOutcome; table: ReturnType<typeof parseJsonlRows> | null; seconds: number };

export default function AskData() {
	const stores = useMemo(() => LAKE_INSTANCES.filter((i) => (ASK_STORE_IDS as readonly string[]).includes(i.id)), []);
	const [storeId, setStoreId] = useState<string>(stores[0]?.id ?? "lumid-data");
	const [question, setQuestion] = useState("");
	const [busy, setBusy] = useState(false);
	const [answer, setAnswer] = useState<Answer | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const store = stores.find((s) => s.id === storeId) ?? stores[0];

	const ask = async () => {
		const q = question.trim() || exampleQuestion(storeId);
		if (!store) return;
		setBusy(true);
		setProblem(null);
		setAnswer(null);
		const t0 = Date.now();
		try {
			const outcome = parseAgentStream(await askAgentRaw(store.basePath, q));
			if (outcome.error && !outcome.uri) {
				setProblem(askError(outcome.error));
			} else {
				const table = outcome.uri ? parseJsonlRows(await fetchAnswerRows(store.basePath, outcome.uri)) : null;
				setAnswer({ outcome, table, seconds: Math.round((Date.now() - t0) / 1000) });
			}
		} catch (e) {
			setProblem(askError((e as Error)?.message || ""));
		} finally {
			setBusy(false);
		}
	};

	const sql = answer?.outcome.sql.join(";\n\n") ?? "";
	const note = answer ? answerNote(answer.outcome) : null;
	const empty = answer ? noRowsLine(answer.outcome) : null;
	return (
		<div className="flex h-full flex-col gap-3 overflow-auto pr-1">
			<div className="rounded-xl border border-ink-200 bg-card p-3">
				<div className="mb-2 flex flex-wrap items-center gap-2 text-micro text-ink-700">
					<span>Ask</span>
					<select
						value={storeId}
						onChange={(e) => setStoreId(e.target.value)}
						disabled={busy}
						className="text-micro bg-card border border-ink-200 rounded-md px-1 py-0.5 text-ink-700"
					>
						{stores.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
					</select>
					<span className="text-ink-600">a question in plain words. It writes the query, runs it as you, and shows the rows.</span>
				</div>
				<div className="flex gap-2">
					<textarea
						value={question}
						onChange={(e) => setQuestion(e.target.value)}
						onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask(); }}
						placeholder={exampleQuestion(storeId)}
						rows={2}
						disabled={busy}
						className="flex-1 resize-y rounded-lg border border-ink-200 bg-card px-2 py-1.5 text-body text-ink-900"
					/>
					<button
						type="button"
						onClick={() => void ask()}
						disabled={busy}
						className="inline-flex h-9 items-center gap-1.5 self-end rounded-lg bg-ink-900 px-3 text-meta font-medium text-white hover:bg-ink-700 disabled:opacity-40"
					>
						{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
						{busy ? "Working…" : "Ask"}
					</button>
				</div>
				{busy && <p className="mt-2 text-micro text-ink-600">Reading the catalog, writing a query, running it. Big stores can take a minute.</p>}
			</div>

			{problem && <p className="rounded-lg border border-brick-200 bg-brick-50 px-3 py-2 text-micro text-brick-700">{problem}</p>}

			{answer && (
				<div className="rounded-xl border border-ink-200 bg-card p-3">
					{note && (
						<p role="status" className="mb-2 rounded-lg border border-ember-200 bg-ember-50 px-3 py-2 text-micro text-ember-700">{note}</p>
					)}
					{answer.table && answer.table.columns.length > 0 ? (
						<>
							<div className="mb-1 text-micro text-ink-600">
								{note ? "Its last query: " : ""}{rowsSummary(answer.outcome.rowcount, answer.table.rows.length)} · {answer.seconds}s
							</div>
							<div className="max-h-96 overflow-auto rounded border border-ink-200">
								<table className="w-full text-micro">
									<thead className="sticky top-0 bg-ink-50">
										<tr>{answer.table.columns.map((c) => <th key={c} className="px-2 py-1 text-left font-medium text-ink-700">{c}</th>)}</tr>
									</thead>
									<tbody>
										{answer.table.rows.map((r, i) => (
											<tr key={i} className="border-t border-ink-100">
												{r.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1 text-ink-800">{cellText(v)}</td>)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					) : empty ? (
						<p className="text-micro text-ink-600">{empty}</p>
					) : null}
					{answer.outcome.answer && (
						<p className="mt-2 whitespace-pre-wrap text-micro text-ink-700">{answer.outcome.answer}</p>
					)}
					{sql && (
						<details className="mt-2">
							<summary className="cursor-pointer text-micro text-ink-600 hover:text-ink-900">The SQL it ran</summary>
							<div className="relative mt-1">
								<pre className="max-h-48 overflow-auto rounded bg-ink-50 p-2 text-micro text-ink-800">{sql}</pre>
								<button
									type="button"
									onClick={() => { void navigator.clipboard?.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
									className="absolute right-1 top-1 inline-flex items-center gap-1 rounded border border-ink-200 bg-card px-1.5 py-0.5 text-nano text-ink-700"
								>
									{copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy"}
								</button>
							</div>
						</details>
					)}
				</div>
			)}

			<details className="rounded-xl border border-ink-200 bg-card p-3">
				<summary className="cursor-pointer text-micro text-ink-700">Write SQL yourself (FinData)</summary>
				<div className="mt-2 h-[28rem]">
					<Suspense fallback={<div className="lumen-skeleton h-32 rounded-xl" role="status" aria-label="Loading" />}>
						<SqlConsole />
					</Suspense>
				</div>
			</details>
		</div>
	);
}
