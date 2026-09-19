// FieldRow — one schema field, rendered.
//
// Hand-rolled rather than react-hook-form + zod, and the reason is structural
// rather than a preference: THERE IS NO LOCAL FORM STATE HERE. The document is
// the state. Every change debounces into a `setParam` edit against the YAML,
// and the value comes back down through a re-projection. A form library's
// whole value proposition is uncontrolled-input performance plus local
// validation state, and both would be a second store fighting the first — on
// forms of four to twelve fields, in a codebase with no form library today.
//
// Eight types. The one that earns its keep is `resource`: it turns "model"
// from a free-text field that fails at submit time into a picker of what is
// actually deployed. Until a loader is wired it degrades to a text input with
// suggestions, which is honest — it never pretends to have validated.

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parse as parseYaml } from "yaml";
import type { Field, Params } from "../registry/types";
import { getAt } from "../registry/types";

const DEBOUNCE_MS = 300;

interface Props {
	field: Field;
	params: Params;
	readOnly?: boolean;
	/** Options for a `resource` field, when the caller could resolve them. */
	resourceOptions?: string[];
	onChange: (path: (string | number)[], value: unknown) => void;
	error?: string;
}

export function FieldRow({ field, params, readOnly, resourceOptions, onChange, error }: Props) {
	const value = getAt(params, field.path);
	const id = `f-${field.path.join("-")}`;

	return (
		<div className="space-y-1">
			<div className="flex items-baseline gap-1.5">
				<label htmlFor={id} className="text-[11px] font-medium text-slate-700">
					{field.label}
				</label>
				{field.required && <span className="text-[10px] text-rose-500">required</span>}
			</div>
			<Control id={id} field={field} value={value} params={params} readOnly={readOnly} resourceOptions={resourceOptions} onChange={onChange} />
			{error ? (
				<p className="text-[10px] leading-snug text-rose-600">{error}</p>
			) : field.hint ? (
				<p className="text-[10px] leading-snug text-slate-400">{field.hint}</p>
			) : null}
		</div>
	);
}

function Control({
	id, field, value, params, readOnly, resourceOptions, onChange,
}: Props & { id: string; value: unknown }) {
	const set = (v: unknown) => onChange(field.path, v);

	switch (field.type) {
		case "boolean":
			return (
				<label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-600">
					<input
						id={id}
						type="checkbox"
						disabled={readOnly}
						checked={value === true}
						onChange={(e) => set(e.target.checked)}
						className="h-3.5 w-3.5 rounded border-slate-300 accent-[rgb(176_143_69)]"
					/>
					{value === true ? "on" : "off"}
				</label>
			);

		case "number":
			return (
				<DebouncedInput
					id={id}
					type="number"
					disabled={readOnly}
					value={value === undefined || value === null ? "" : String(value)}
					placeholder={field.placeholder ?? (field.default !== undefined ? String(field.default) : "")}
					min={field.min}
					max={field.max}
					step={field.step}
					onCommit={(raw) => set(raw === "" ? undefined : Number(raw))}
				/>
			);

		case "enum":
			return (
				<select
					id={id}
					disabled={readOnly}
					value={typeof value === "string" ? value : String(field.default ?? "")}
					onChange={(e) => set(e.target.value)}
					className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-[rgb(176_143_69)]"
				>
					{field.options?.map((o) => (
						<option key={o.value} value={o.value}>{o.label}</option>
					))}
				</select>
			);

		case "resource":
			return (
				<>
					<DebouncedInput
						id={id}
						disabled={readOnly}
						list={resourceOptions?.length ? `${id}-opts` : undefined}
						value={typeof value === "string" ? value : ""}
						placeholder={field.placeholder}
						onCommit={(raw) => set(raw === "" ? undefined : raw)}
					/>
					{resourceOptions?.length ? (
						<datalist id={`${id}-opts`}>
							{resourceOptions.map((o) => <option key={o} value={o} />)}
						</datalist>
					) : null}
				</>
			);

		case "code":
			return <CodeField id={id} field={field} value={value} readOnly={readOnly} onCommit={set} />;

		case "list":
			return (
				<DebouncedTextarea
					id={id}
					disabled={readOnly}
					rows={Math.min(6, Math.max(2, asList(value).length + 1))}
					value={asList(value).join("\n")}
					placeholder={field.placeholder ?? "one per line"}
					onCommit={(raw) => set(raw.split("\n").map((s) => s.trim()).filter(Boolean))}
				/>
			);

		case "keyValue":
			return (
				<DebouncedTextarea
					id={id}
					disabled={readOnly}
					rows={Math.min(8, Math.max(2, Object.keys(asRecord(value)).length + 1))}
					value={Object.entries(asRecord(value)).map(([k, v]) => `${k}: ${v}`).join("\n")}
					placeholder={field.placeholder ?? "key: value"}
					onCommit={(raw) => {
						const out: Record<string, string> = {};
						for (const line of raw.split("\n")) {
							const i = line.indexOf(":");
							if (i <= 0) continue;
							out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
						}
						set(out);
					}}
				/>
			);

		default:
			return (
				<DebouncedInput
					id={id}
					disabled={readOnly}
					value={typeof value === "string" ? value : value == null ? "" : String(value)}
					placeholder={field.placeholder}
					onCommit={(raw) => set(raw === "" ? undefined : raw)}
				/>
			);
	}
	void params;
}

/**
 * A `code` field: a mono textarea that commits on blur.
 *
 * This WAS Monaco, lazily imported. It never worked in production and the
 * failure was invisible from here: @monaco-editor/react does not bundle
 * Monaco, it fetches it at runtime from cdn.jsdelivr.net, and our CSP is
 * `script-src 'self'`. The chunk loaded (so Suspense resolved and the old
 * "fallback" never showed), then Monaco's own loader was blocked and the box
 * sat on its internal "Loading..." forever. tsc and the build were clean
 * throughout, because nothing is wrong until the browser makes that request.
 *
 * A textarea is what the rest of this app edits YAML in, it is what the page's
 * own YAML view uses, and it costs nothing at runtime. Highlighting in a 140px
 * box is not worth a 5MB dependency or a hole in the CSP. If Monaco comes
 * back, it must be SELF-HOSTED -- `loader.config()` pointed at our own origin
 * -- and verified in a browser against the deployed CSP, not in a dev server
 * that has none.
 */
function CodeField({
	id, field, value, readOnly, onCommit,
}: { id: string; field: Field; value: unknown; readOnly?: boolean; onCommit: (v: unknown) => void }) {
	// A code field may be editing a STRING (a prompt, a snippet) or a STRUCTURE
	// serialised for display (`messages`, a list of {role, content}). Those need
	// different commits, and getting it wrong writes a string where the document
	// wants a list.
	//
	// The old version always committed the raw text. `list` and `keyValue` right
	// above both parse their text back first; `code` never did. Nobody hit it
	// because the editor it lived in could not load at all (see the note above),
	// so the field was unreachable rather than merely wrong.
	const structured = value != null && typeof value !== "string";
	const text = typeof value === "string" ? value : value == null ? "" : toYamlish(value);
	const [local, setLocal] = useState(text);
	const [parseError, setParseError] = useState<string | null>(null);
	const last = useRef(text);
	useEffect(() => {
		if (text !== last.current) {
			last.current = text;
			setLocal(text);
			setParseError(null);
		}
	}, [text]);

	const commit = (raw: string) => {
		if (!structured) { setParseError(null); onCommit(raw); return; }
		// Display is JSON, so try that first; accept YAML too, since the document
		// is YAML and pasting a fragment of it is the obvious thing to do.
		for (const parse of [JSON.parse, parseYaml] as ((t: string) => unknown)[]) {
			try {
				const v = parse(raw);
				if (v !== undefined) { setParseError(null); onCommit(v); return; }
			} catch { /* try the next one */ }
		}
		// REFUSE rather than write. Committing the raw text here would replace a
		// list with a string and the failure would surface much later, at run time.
		setParseError("Not valid JSON or YAML — not saved. Fix the text or click away and back to restore.");
	};

	return (
		<>
			<Textarea
				id={id}
				disabled={readOnly}
				spellCheck={false}
				value={local}
				rows={8}
				aria-label={field.label}
				onChange={(e) => { setLocal(e.target.value); last.current = e.target.value; }}
				// Commit on blur, not per keystroke: a code field is edited in bursts,
				// and one undo entry per character would make undo useless.
				onBlur={() => commit(local)}
				className={`resize-y font-mono text-[11px] leading-relaxed${parseError ? " border-rose-300" : ""}`}
			/>
			{parseError && <p className="mt-1 text-[10px] leading-snug text-rose-600">{parseError}</p>}
		</>
	);
}

// --- debounced primitives ---------------------------------------------------
// Local state exists ONLY to keep the caret steady while typing; the document
// is still the source of truth, and the commit is what makes it real.

function useDebouncedText(value: string, onCommit: (v: string) => void) {
	const [local, setLocal] = useState(value);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const external = useRef(value);

	useEffect(() => {
		if (value !== external.current) {
			external.current = value;
			setLocal(value);
		}
	}, [value]);

	useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

	const onChange = (v: string) => {
		setLocal(v);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			external.current = v;
			onCommit(v);
		}, DEBOUNCE_MS);
	};
	const flush = () => {
		if (timer.current) clearTimeout(timer.current);
		if (local !== external.current) {
			external.current = local;
			onCommit(local);
		}
	};
	return { local, onChange, flush };
}

function DebouncedInput({
	value, onCommit, ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
	const { local, onChange, flush } = useDebouncedText(value, onCommit);
	return (
		<Input
			{...rest}
			value={local}
			onChange={(e) => onChange(e.target.value)}
			onBlur={flush}
			className="h-8 text-[12px]"
		/>
	);
}

function DebouncedTextarea({
	value, onCommit, ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange">) {
	const { local, onChange, flush } = useDebouncedText(value, onCommit);
	return (
		<Textarea
			{...rest}
			value={local}
			onChange={(e) => onChange(e.target.value)}
			onBlur={flush}
			className="resize-y font-mono text-[11px]"
		/>
	);
}

// --- helpers ----------------------------------------------------------------

function asList(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String);
	if (typeof v === "string" && v) return [v];
	return [];
}

function asRecord(v: unknown): Record<string, string> {
	if (v && typeof v === "object" && !Array.isArray(v)) {
		const out: Record<string, string> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = String(val);
		return out;
	}
	return {};
}

/** Structured value shown in a code field — good enough for display + re-edit. */
function toYamlish(v: unknown): string {
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return String(v);
	}
}
