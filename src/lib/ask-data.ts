// "Ask" — a question in plain words, answered by the data agent of one store.
// Pure and tested (ask-data.test.ts); components only place what these return.
//
// Each hub runs the agent at <hub>/agent/v1. It answers with a server-sent-event
// stream whose last event is `done`: the model's reply, plus the retrieval it
// ran (`result.access_chain[].query` = the SQL, `result.rowcount`,
// `result.materialized_uri` = the rows, readable only by whoever asked). By
// design the model never sees the rows, so the rows ARE the answer; its text is
// the explanation.

export interface AgentOutcome {
	answer: string;
	sql: string[];
	rowcount: number | null;
	uri: string | null;
	error: string | null;
	/** Tool calls the agent made — how much work it took. */
	steps: number;
}

/** Stores the Ask box offers (each runs an agent). LQT has none. */
export const ASK_STORE_IDS = ["lumid-data", "findata", "nus-data"] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Read the agent's SSE body into one outcome. Tolerates junk lines. */
export function parseAgentStream(text: string): AgentOutcome {
	const out: AgentOutcome = { answer: "", sql: [], rowcount: null, uri: null, error: null, steps: 0 };
	for (const line of text.split("\n")) {
		if (!line.startsWith("data:")) continue;
		let ev: Record<string, unknown> | null = null;
		try {
			ev = asRecord(JSON.parse(line.slice(5).trim()));
		} catch {
			continue;
		}
		if (!ev) continue;
		const type = ev.type;
		if (type === "tool_call") out.steps += 1;
		if ((type === "error" || type === "tool_error") && typeof ev.error === "string") out.error = ev.error;
		if (type === "done") {
			const msg = asRecord(ev.message);
			if (typeof msg?.content === "string") out.answer = msg.content.trim();
			const res = asRecord(ev.result);
			if (res) {
				if (typeof res.rowcount === "number") out.rowcount = res.rowcount;
				if (typeof res.materialized_uri === "string" && res.materialized_uri) out.uri = res.materialized_uri;
				if (Array.isArray(res.access_chain)) {
					for (const step of res.access_chain) {
						const q = asRecord(step)?.query;
						if (typeof q === "string" && q.trim()) out.sql.push(q.trim());
					}
				}
			}
			// A finished run with an answer clears an earlier, recovered tool error.
			if (out.answer || out.uri) out.error = null;
		}
	}
	return out;
}

/** Rows from a JSON-lines result, as a table. `more` = there were rows past the cap. */
export function parseJsonlRows(text: string, cap = 200): { columns: string[]; rows: unknown[][]; more: boolean } {
	const columns: string[] = [];
	const objs: Record<string, unknown>[] = [];
	let more = false;
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		if (objs.length >= cap) {
			more = true;
			break;
		}
		try {
			const o = asRecord(JSON.parse(t));
			if (!o) continue;
			for (const k of Object.keys(o)) if (!columns.includes(k)) columns.push(k);
			objs.push(o);
		} catch {
			/* skip a malformed line */
		}
	}
	return { columns, rows: objs.map((o) => columns.map((c) => o[c] ?? null)), more };
}

const nf = new Intl.NumberFormat("en-US");

/** "1 row" / "5 rows" / "Showing 200 of 1,234 rows". */
export function rowsSummary(total: number | null, shown: number): string {
	if (total !== null && total > shown) return `Showing ${nf.format(shown)} of ${nf.format(total)} rows`;
	const n = total ?? shown;
	return `${nf.format(n)} row${n === 1 ? "" : "s"}`;
}

/** A raw failure in words a person can act on. */
export function askError(raw: string): string {
	const r = raw.toLowerCase();
	if (r.includes("401") || r.includes("unauthorized")) return "Your sign-in expired. Reload the page and ask again.";
	if (r.includes("413") || r.includes("length limit")) return "That store is too big to describe in one go. Name a schema in your question (for example \"in macro\").";
	if (r.includes("timed out") || r.includes("timeout") || r.includes("504")) return "That took too long. Try a narrower question.";
	if (r.includes("llm call failed") || r.includes("llm returned")) return "The question answerer is unavailable right now. Try again in a minute.";
	if (r.includes("unknown table") || r.includes("does not exist")) return "It looked for a table that isn't there. Name the table, or check the Catalog.";
	return "Couldn't answer that. Try rephrasing, or name the table you mean.";
}

/** A first question that works on each store (shown as a placeholder). */
export function exampleQuestion(storeId: string): string {
	switch (storeId) {
		case "findata":
			return "What were AAPL's last 5 daily closing prices?";
		case "nus-data":
			return "Which 5 arXiv categories had the most new papers in 2026?";
		default:
			return "What was the most recent 10-year US treasury rate, and on what date?";
	}
}

/** One cell as text. */
export function cellText(v: unknown): string {
	if (v === null || v === undefined) return "";
	if (typeof v === "object") return JSON.stringify(v);
	return String(v);
}
