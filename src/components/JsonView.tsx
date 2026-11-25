// JsonView — JSON as something you read, not a code dump: an object's fields
// as labelled rows (snake_case → words), nested groups indented under their
// name, a list of records as a table, numbers grouped and trimmed, yes/no for
// booleans. "Raw" shows the original text. Built for run files (an MLSys run's
// results.json / design.json) and JSON artifacts — "the results are only in
// JSON, not very viewable" (user, 2026-11-25).

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtMetricValue, humanMetric } from "@/lib/run-answer";

type J = null | boolean | number | string | J[] | { [k: string]: J };

/** "ttft_p50_ms" → "TTFT p50 ms"; "designId" → "Design id". */
export function humanKey(k: string): string {
	if (/^(arm|arm_id|variant|variant_id)$/i.test(k)) return "Version"; // the glossary: never "arm"
	const words = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().split(/\s+/);
	const ACR = /^(id|gpu|cpu|ttft|tpot|e2e|llm|sla|vram|kv|api|url|p\d+)$/i;
	return words.map((w, i) => (ACR.test(w) && !/^p\d+$/i.test(w) && w.toLowerCase() !== "id" ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

function fmtNum(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	const abs = Math.abs(n);
	const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
	return n.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(n) ? 0 : digits });
}

function Scalar({ v }: { v: J }) {
	if (v === null || v === undefined) return <span className="text-ink-500">—</span>;
	if (typeof v === "boolean") return <span>{v ? "yes" : "no"}</span>;
	if (typeof v === "number") return <span className="font-mono tabular-nums">{fmtNum(v)}</span>;
	return <span className="break-words">{String(v)}</span>;
}

const isObj = (v: J): v is { [k: string]: J } => !!v && typeof v === "object" && !Array.isArray(v);

/** A JSON document stored as a string field ("design_text": "{…}") — read it as one. */
function embedded(v: J): J | undefined {
	if (typeof v !== "string" || v.length < 2 || !/^\s*[[{]/.test(v)) return undefined;
	try { const x = JSON.parse(v) as J; return typeof x === "object" && x !== null ? x : undefined; } catch { return undefined; }
}
const TS_KEY = /(^|_)(ts|time|timestamp|at|started|ended|created|updated)$/i;
/** The label a field gets: metric naming (unit split off) for metric-looking keys. */
function fieldLabel(k: string): { label: string; unit: string } {
	if (/^(arm|arm_id|variant|variant_id)$/i.test(k)) return { label: "Version", unit: "" };
	const m = humanMetric(k);
	return { label: m.label, unit: m.unit };
}
function FieldValue({ k, v, depth }: { k: string; v: J; depth: number }) {
	const inner = embedded(v);
	if (inner !== undefined) return <Value v={inner} depth={depth} />;
	if (typeof v === "number") {
		// Epoch seconds / ms under a time-like key read as a date.
		if (TS_KEY.test(k) && v > 1e9) return <span>{new Date(v > 1e12 ? v : v * 1000).toLocaleString()}</span>;
		if (/(^|_)(id|hash|seed)$/i.test(k)) return <span className="font-mono">{String(v)}</span>;
		const u = fieldLabel(k).unit;
		return <span className="font-mono tabular-nums">{fmtMetricValue(v, u, k)}</span>;
	}
	return <Value v={v} depth={depth} />;
}
const isScalar = (v: J) => v === null || typeof v !== "object";

/** A list of records that share keys reads best as a table. */
function tableOf(arr: J[]): { cols: string[]; rows: Array<{ [k: string]: J }> } | null {
	if (arr.length < 2 || !arr.every(isObj)) return null;
	const rows = arr as Array<{ [k: string]: J }>;
	const count = new Map<string, number>();
	for (const r of rows) for (const [k, v] of Object.entries(r)) if (isScalar(v)) count.set(k, (count.get(k) ?? 0) + 1);
	const cols = [...count.entries()].filter(([, c]) => c >= rows.length / 2).map(([k]) => k).slice(0, 8);
	return cols.length >= 2 ? { cols, rows } : null;
}

function Value({ v, depth }: { v: J; depth: number }) {
	if (isScalar(v)) return <Scalar v={v} />;
	if (Array.isArray(v)) {
		if (v.length === 0) return <span className="text-ink-500">none</span>;
		if (v.every(isScalar)) return <span className="break-words">{v.map((x, i) => <span key={i}>{i ? ", " : ""}<Scalar v={x} /></span>)}</span>;
		const t = tableOf(v);
		if (t) {
			return (
				<div className="overflow-x-auto rounded-md border border-ink-100">
					<table className="w-full text-micro">
						<thead className="bg-muted/50 text-ink-600"><tr>{t.cols.map((c) => <th key={c} className="px-2 py-1 text-left font-medium whitespace-nowrap">{humanKey(c)}</th>)}</tr></thead>
						<tbody className="divide-y divide-ink-100">
							{t.rows.slice(0, 50).map((r, i) => <tr key={i}>{t.cols.map((c) => <td key={c} className="px-2 py-1 align-top text-ink-800"><Scalar v={r[c] ?? null} /></td>)}</tr>)}
						</tbody>
					</table>
					{t.rows.length > 50 && <div className="px-2 py-1 text-nano text-ink-600">…and {t.rows.length - 50} more</div>}
				</div>
			);
		}
		return <div className="space-y-1.5">{v.slice(0, 20).map((x, i) => <div key={i} className="border-l-2 border-ink-100 pl-2"><Value v={x} depth={depth + 1} /></div>)}</div>;
	}
	return <Fields obj={v} depth={depth} />;
}

function Fields({ obj, depth }: { obj: { [k: string]: J }; depth: number }) {
	const entries = Object.entries(obj);
	// Plain fields first, then groups (nested objects / lists of records) under their own name.
	// A JSON string field counts as a group (it is a document of its own).
	const plain = (v: J) => (isScalar(v) && embedded(v) === undefined) || (Array.isArray(v) && v.every(isScalar));
	const flat = entries.filter(([, v]) => plain(v));
	const groups = entries.filter(([, v]) => !plain(v)).map(([k, v]) => [k, embedded(v) ?? v] as [string, J]);
	return (
		<div className="space-y-2">
			{flat.length > 0 && (
				<dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
					{flat.map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-ink-600">{fieldLabel(k).label}</dt>
							<dd className="text-ink-900 min-w-0"><FieldValue k={k} v={v} depth={depth + 1} /></dd>
						</div>
					))}
				</dl>
			)}
			{groups.map(([k, v]) => depth >= 2 ? (
				<details key={k} className="group">
					<summary className="cursor-pointer list-none text-ink-700 font-medium"><span className="inline-block transition-transform group-open:rotate-90">›</span> {humanKey(k)}</summary>
					<div className="mt-1 border-l-2 border-ink-100 pl-2.5"><Value v={v} depth={depth + 1} /></div>
				</details>
			) : (
				<section key={k}>
					<div className="mb-1 text-micro font-semibold uppercase tracking-wide text-ink-600">{humanKey(k)}</div>
					<div className={cn(depth > 0 && "border-l-2 border-ink-100 pl-2.5")}><Value v={v} depth={depth + 1} /></div>
				</section>
			))}
		</div>
	);
}

/** Readable view of a JSON text; falls back to the raw text if it doesn't parse. */
export default function JsonView({ text, className }: { text: string; className?: string }) {
	const parsed = useMemo(() => { try { return { ok: true as const, v: JSON.parse(text) as J }; } catch { return { ok: false as const }; } }, [text]);
	const [raw, setRaw] = useState(false);
	if (!parsed.ok) return <pre className={cn("whitespace-pre-wrap break-words font-mono text-nano text-ink-800", className)}>{text}</pre>;
	return (
		<div className={cn("text-caption", className)}>
			<div className="mb-1.5 flex justify-end">
				<button type="button" onClick={() => setRaw((x) => !x)} className="text-nano text-ink-600 hover:text-ink-900 underline decoration-dotted">{raw ? "Readable" : "Raw"}</button>
			</div>
			{raw
				? <pre className="whitespace-pre-wrap break-words font-mono text-nano text-ink-800">{JSON.stringify(parsed.v, null, 2)}</pre>
				: <Value v={parsed.v} depth={0} />}
		</div>
	);
}
