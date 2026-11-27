// Ask box words and parsing. Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { answerNote, askError, cellText, exampleQuestion, noRowsLine, parseAgentStream, parseJsonlRows, rowsSummary, sqlError } from "./ask-data";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}

// Shape of a real home-hub answer (2026-11-25).
const STREAM = [
	'data: {"type":"iteration","iteration":1}',
	'data: {"type":"tool_call","call_id":"a","tool":"get_schema_cards"}',
	'data: {"type":"tool_result","call_id":"a","tool":"get_schema_cards"}',
	'data: {"type":"tool_call","call_id":"b","tool":"replay_retrieval_plan"}',
	"data: not json",
	'data: {"type":"done","message":{"role":"assistant","content":"  The latest 10-year rate is shown.  "},"result":{"rowcount":1,"materialized_uri":"/blobs/retrievals/x/result.jsonl","access_chain":[{"op":"sql","query":"SELECT date, y10 FROM macro.treasury_rates ORDER BY date DESC LIMIT 1"}]}}',
].join("\n");

check("an answered question", () => {
	const o = parseAgentStream(STREAM);
	eq(o.answer, "The latest 10-year rate is shown.");
	eq(o.sql, ["SELECT date, y10 FROM macro.treasury_rates ORDER BY date DESC LIMIT 1"]);
	eq([o.rowcount, o.uri, o.steps, o.error], [1, "/blobs/retrievals/x/result.jsonl", 2, null]);
});
check("a failed question keeps its error", () => {
	const o = parseAgentStream('data: {"type":"iteration"}\ndata: {"type":"error","error":"LLM returned HTTP 413: length limit exceeded"}');
	eq(o.error, "LLM returned HTTP 413: length limit exceeded");
	eq(askError(o.error!), 'That store is too big to describe in one go. Name a schema in your question (for example "in macro").');
});
// A run that hit its step budget (2026-11-27, a SPY question): `done` carries
// the last query that worked — a probe — and a half-finished thought.
const TRUNCATED = [
	'data: {"type":"iteration","iteration":1,"max_iterations":8}',
	'data: {"type":"tool_call","call_id":"a","tool":"replay_retrieval_plan"}',
	'data: {"type":"tool_error","call_id":"a","tool":"replay_retrieval_plan","error":"query exceeded the 30000ms statement timeout"}',
	'data: {"type":"tool_call","call_id":"b","tool":"replay_retrieval_plan"}',
	'data: {"type":"tool_result","call_id":"b","tool":"replay_retrieval_plan"}',
	'data: {"type":"done","truncated":true,"max_iterations_reached":8,"message":{"content":"Malformed plan payload on my side, retrying."},"result":{"rowcount":1,"materialized_uri":"/blobs/retrievals/y/result.jsonl","access_chain":[{"op":"sql","query":"SELECT COUNT(*) FROM market.ohlc_daily WHERE symbol = \'SPY\'"}]}}',
].join("\n");

check("an answered question is finished and needs no note", () => {
	const o = parseAgentStream(STREAM);
	eq([o.finished, o.failedSteps, answerNote(o), noRowsLine(o)], [true, 0, null, null]);
});
check("a run out of steps says its rows are only its last query", () => {
	const o = parseAgentStream(TRUNCATED);
	eq([o.finished, o.maxSteps, o.failedSteps, o.error], [false, 8, 1, null]);
	eq(answerNote(o), "It used all 8 of its steps before finishing, so this is not an answer yet. 1 of its queries failed along the way. "
		+ "The rows below are from the last query that worked, which may be a check rather than the answer. "
		+ "Ask a narrower question (name the table, a symbol or a date range), or write the SQL yourself below.");
});
check("no table: an answer in text needs no 'no rows' line; an empty query says so", () => {
	const base = parseAgentStream(STREAM);
	eq(noRowsLine({ ...base, uri: null, rowcount: null }), null);
	eq(noRowsLine({ ...base, rowcount: 0 }), "The query ran and returned no rows.");
	eq(noRowsLine({ ...base, answer: "", uri: null, rowcount: null }), "No rows came back.");
});
check("SQL console: a timeout in words, other errors verbatim", () => {
	const raw = 'Post "http://findata-primary:8088/retrieve": context deadline exceeded';
	eq(sqlError(raw).startsWith("The query ran past the warehouse's time limit (about 30 seconds)."), true);
	eq(sqlError(raw).endsWith(raw), true);
	eq(sqlError("sql rejected: only a single read-only select is allowed"), "sql rejected: only a single read-only select is allowed");
});
check("rows from JSON lines, capped, columns in first-seen order", () => {
	const t = '{"date":"2026-05-28","y10":4.4}\n{"date":"2026-05-27","y10":4.5,"note":"x"}\n\nbad\n{"date":"2026-05-26","y10":4.6}';
	eq(parseJsonlRows(t), { columns: ["date", "y10", "note"], rows: [["2026-05-28", 4.4, null], ["2026-05-27", 4.5, "x"], ["2026-05-26", 4.6, null]], more: false });
	eq(parseJsonlRows(t, 2).more, true);
});
check("words", () => {
	eq(rowsSummary(1, 1), "1 row");
	eq(rowsSummary(null, 5), "5 rows");
	eq(rowsSummary(1234, 200), "Showing 200 of 1,234 rows");
	eq(askError("x → 401 Unauthorized"), "Your sign-in expired. Reload the page and ask again.");
	eq(askError("something odd"), "Couldn't answer that. Try rephrasing, or name the table you mean.");
	eq(exampleQuestion("nus-data").includes("arXiv"), true);
	eq([cellText(null), cellText(3), cellText({ a: 1 })], ["", "3", '{"a":1}']);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;
