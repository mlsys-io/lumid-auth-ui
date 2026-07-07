// App credentials — the pure-UI path for the secrets an app declares in its
// xpcloud.yaml `config_schema`. Values are AES-256-GCM encrypted server-side
// (app_secrets table), NEVER returned to the browser (only `is_set`), and
// injected into the cycle env by the scheduler at run time (keyed 1:1 to env
// var names). This is what lets a user run an app end-to-end without touching
// a terminal: paste the key here → Run now → it works.
//
// config_schema is best-effort (the manage panel loads it from the installed
// xpcloud.yaml when reachable). Any already-set secret NOT in the schema is
// still shown so it can be rotated/removed, and a free-form row lets a user
// add a key the schema didn't declare.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Check, Loader2, Trash2, Plus } from "lucide-react";
import { me } from "@/api/me";

export type ConfigField = {
	key: string;
	label?: string;
	description?: string;
	secret?: boolean;
	required?: boolean;
};

type SecretRow = { key: string; is_set: boolean; updated_at?: string };

export default function AppSecretsSection({
	app,
	schema,
}: {
	app: string;
	schema?: ConfigField[];
}) {
	const [rows, setRows] = useState<SecretRow[]>([]);
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const [customKey, setCustomKey] = useState("");
	const [customVal, setCustomVal] = useState("");
	const [err, setErr] = useState("");

	const reload = useCallback(() => {
		me.listSecrets(app)
			.then((r) => setRows(r.secrets ?? []))
			.catch((e) => setErr(e instanceof Error ? e.message : String(e)));
	}, [app]);
	useEffect(() => { reload(); }, [reload]);

	const isSet = (k: string) => rows.find((r) => r.key === k)?.is_set ?? false;

	const save = async (key: string, value: string) => {
		if (!value) return;
		setBusy(key);
		try {
			await me.putSecret(app, key, value);
			toast.success(`Saved ${key}`);
			setDraft((d) => ({ ...d, [key]: "" }));
			reload();
		} catch (e) {
			toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	};

	const remove = async (key: string) => {
		setBusy(key);
		try {
			await me.deleteSecret(app, key);
			toast.success(`Removed ${key}`);
			reload();
		} catch (e) {
			toast.error(`Remove failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	};

	// Declared secret fields (schema) + any set-but-undeclared keys (rotate/remove).
	const declared = (schema ?? []).filter((f) => f.secret !== false && f.key);
	const declaredKeys = new Set(declared.map((f) => f.key));
	const extras = rows.filter((r) => !declaredKeys.has(r.key)).map((r) => r.key);

	const Field = ({ f }: { f: ConfigField }) => (
		<div className="rounded-lg border border-slate-200 p-3">
			<div className="flex items-center gap-2 mb-1">
				<span className="text-[13px] font-medium text-slate-800">{f.label || f.key}</span>
				{f.required && <span className="text-rose-500 text-[11px]">required</span>}
				{isSet(f.key) ? (
					<span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><Check className="w-3 h-3" /> set</span>
				) : (
					<span className="text-[11px] text-amber-600">not set</span>
				)}
				<code className="ml-auto text-[10.5px] text-slate-400 font-mono">{f.key}</code>
			</div>
			{f.description && <p className="text-[11.5px] text-slate-500 mb-2">{f.description}</p>}
			<div className="flex items-center gap-2">
				<input
					type="password"
					autoComplete="off"
					value={draft[f.key] ?? ""}
					onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
					placeholder={isSet(f.key) ? "•••••••• (enter a new value to replace)" : "paste value"}
					className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/20 focus:border-gold-400"
				/>
				<button
					onClick={() => save(f.key, draft[f.key] ?? "")}
					disabled={busy === f.key || !(draft[f.key] ?? "").trim()}
					className="px-3 py-1.5 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-40"
				>
					{busy === f.key ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
				</button>
				{isSet(f.key) && (
					<button onClick={() => remove(f.key)} disabled={busy === f.key} title="Remove"
						className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
						<Trash2 className="w-4 h-4" />
					</button>
				)}
			</div>
		</div>
	);

	return (
		<section className="space-y-3">
			<div className="flex items-center gap-2">
				<KeyRound className="w-4 h-4 text-slate-500" />
				<h3 className="text-[13px] font-medium text-slate-800">Credentials</h3>
			</div>
			<p className="text-[12px] text-slate-500">
				Keys this app needs to run. Values are encrypted, never shown again, and passed to the
				app as environment variables when a cycle runs.
			</p>

			{declared.length === 0 && extras.length === 0 && (
				<p className="text-[12px] text-slate-400">
					This app declares no credentials — add one below only if you know it needs it.
				</p>
			)}

			<div className="space-y-2">
				{declared.map((f) => <Field key={f.key} f={f} />)}
				{extras.map((k) => <Field key={k} f={{ key: k, secret: true, label: k }} />)}
			</div>

			{/* Free-form add (for keys the schema didn't declare) */}
			<div className="rounded-lg border border-dashed border-slate-300 p-3">
				<div className="flex items-center gap-2">
					<input
						value={customKey}
						onChange={(e) => setCustomKey(e.target.value)}
						placeholder="KEY (env var name)"
						className="w-48 px-3 py-1.5 text-sm rounded-lg border border-slate-200 font-mono"
					/>
					<input
						type="password"
						autoComplete="off"
						value={customVal}
						onChange={(e) => setCustomVal(e.target.value)}
						placeholder="value"
						className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200"
					/>
					<button
						onClick={() => {
							const k = customKey.trim().toUpperCase();
							if (k && customVal) { save(k, customVal); setCustomKey(""); setCustomVal(""); }
						}}
						disabled={!customKey.trim() || !customVal}
						className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
					>
						<Plus className="w-3.5 h-3.5" /> Add
					</button>
				</div>
			</div>

			{err && <p className="text-[12px] text-rose-600">{err}</p>}
		</section>
	);
}
