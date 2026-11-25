// DatasetPicker — choose the data a workflow learns from.
//
// Extracted from NewWorkflowFlow's Data step (2026-11-26) so the "Make a
// variant" sheet can use the same picker. Three sources, in this order:
//   1. "Start empty" — the workflow gathers or fetches its own data;
//   2. datasets the app's spec already declares (`declared`, quick chips);
//   3. casebooks: dataset groups on the user's apps (me.listApps → appDatasets,
//      loaded per app on first open), optionally limited to `apps`.
// Plus, with `allowTyped`, a dataset named by id.
//
// Single-pick (`multiple` false, NewWorkflowFlow) or multi-pick (the sheet).
// An empty `value` means "start empty".

import { useEffect, useState } from "react";
import { ArrowRight, Check, Database, Loader2, Package, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { me, type MeAppCard, type MeDatasetGroup } from "@/api/me";

export interface DatasetRef {
	/** The app whose casebook this is; absent for a dataset the spec declares by id. */
	app?: string;
	group: string;
	label: string;
}

/** Two refs name the same dataset (a bare id matches a casebook with that group). */
export function sameDataset(a: DatasetRef, b: DatasetRef): boolean {
	return a.group === b.group && (!a.app || !b.app || a.app === b.app);
}

interface Props {
	value: DatasetRef[];
	onChange: (next: DatasetRef[]) => void;
	multiple?: boolean;
	/** Only list these apps' casebooks (default: all of the user's apps). */
	apps?: string[];
	/** Dataset ids the app's spec declares, offered first. */
	declared?: string[];
	/** Let the user add a dataset by id. */
	allowTyped?: boolean;
	emptyTitle?: string;
	emptyHint?: string;
	heading?: string;
}

export function DatasetPicker({
	value, onChange, multiple = false, apps: only, declared = [], allowTyped = false,
	emptyTitle = "Start empty / external data",
	emptyHint = "The workflow will gather or fetch its own data each run.",
	heading = "Existing casebooks",
}: Props) {
	const [apps, setApps] = useState<MeAppCard[] | null>(null);
	// app slug → its dataset groups (lazy, per app)
	const [groupsByApp, setGroupsByApp] = useState<Record<string, MeDatasetGroup[]>>({});
	const [loadingApp, setLoadingApp] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [typed, setTyped] = useState("");
	const onlyKey = only?.join(",") ?? "";

	useEffect(() => {
		let live = true;
		me.listApps()
			.then((r) => {
				if (!live) return;
				const keep = onlyKey ? new Set(onlyKey.split(",")) : null;
				setApps((r.apps || []).filter((a) => a.status !== "failed" && (!keep || keep.has(a.name))));
			})
			.catch(() => { if (live) setApps([]); });
		return () => { live = false; };
	}, [onlyKey]);

	const loadGroups = async (appName: string) => {
		if (groupsByApp[appName]) return;
		setLoadingApp(appName);
		try {
			const r = await me.appDatasets(appName);
			setGroupsByApp((prev) => ({ ...prev, [appName]: r.datasets || [] }));
		} catch {
			setGroupsByApp((prev) => ({ ...prev, [appName]: [] }));
		} finally {
			setLoadingApp(null);
		}
	};

	// One app to show: open it straight away.
	useEffect(() => {
		if (apps?.length === 1 && expanded === null) { setExpanded(apps[0].name); void loadGroups(apps[0].name); }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [apps]);

	const openApp = (appName: string) => {
		if (expanded === appName) { setExpanded(null); return; }
		setExpanded(appName);
		void loadGroups(appName);
	};

	const picked = (r: DatasetRef) => value.some((v) => sameDataset(v, r));
	const toggle = (r: DatasetRef) => {
		if (!multiple) { onChange(picked(r) ? value : [r]); return; }
		onChange(picked(r) ? value.filter((v) => !sameDataset(v, r)) : [...value, r]);
	};
	const addTyped = () => {
		const id = typed.trim();
		if (!id) return;
		if (!picked({ group: id, label: id })) toggle({ group: id, label: id });
		setTyped("");
	};

	const isEmpty = value.length === 0;
	// Spec ids and anything picked that isn't a listed casebook (so it can be unpicked).
	const chips = [...new Set([...declared, ...value.filter((v) => !v.app).map((v) => v.group)])];

	return (
		<div className="space-y-4">
			{/* Start empty / external */}
			<button
				type="button"
				onClick={() => onChange([])}
				aria-pressed={isEmpty}
				className={cn(
					"w-full text-left rounded-xl border p-3.5 transition-all",
					isEmpty ? "border-gold-300 bg-gold-50/60 ring-2 ring-gold-200" : "border-ink-200 bg-card hover:border-gold-200",
				)}
			>
				<div className="flex items-center gap-3">
					<div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isEmpty ? "bg-gold-100 text-gold-700" : "bg-ink-100 text-ink-600")}>
						<Database className="w-4.5 h-4.5" />
					</div>
					<div className="min-w-0">
						<div className="text-body font-medium text-ink-900">{emptyTitle}</div>
						<div className="text-micro text-ink-600">{emptyHint}</div>
					</div>
					{isEmpty && <Check className="w-4 h-4 text-gold-600 ml-auto flex-shrink-0" />}
				</div>
			</button>

			{chips.length > 0 && (
				<div>
					<div className="eyebrow text-ink-600 mb-1.5">Datasets this app declares</div>
					<div className="flex flex-wrap gap-1.5">
						{chips.map((id) => {
							const on = picked({ group: id, label: id });
							return (
								<button
									key={id}
									type="button"
									aria-pressed={on}
									onClick={() => toggle({ group: id, label: id })}
									className={cn(
										"inline-flex items-center gap-1 text-caption rounded-full px-2.5 py-1 border transition-colors",
										on ? "bg-gold-50 text-gold-700 border-gold-300" : "bg-card text-ink-700 border-ink-200 hover:border-gold-300",
									)}
								>
									{on ? <Check className="w-3 h-3" /> : <Database className="w-3 h-3" />}{id}
								</button>
							);
						})}
					</div>
				</div>
			)}

			{/* Casebooks, grouped by the user's apps */}
			<div>
				<div className="eyebrow text-ink-600 mb-1.5">{heading}</div>
				{apps === null ? (
					<div className="text-caption text-ink-600 flex items-center gap-1.5 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading your apps…</div>
				) : apps.length === 0 ? (
					<div className="text-caption text-ink-600 py-2">No casebooks to pick from — start empty above.</div>
				) : (
					<div className="space-y-1.5">
						{apps.map((a) => {
							const groups = groupsByApp[a.name];
							const open = expanded === a.name;
							return (
								<div key={a.name} className="rounded-xl border border-ink-200 overflow-hidden bg-card">
									<button type="button" onClick={() => openApp(a.name)} aria-expanded={open} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-ink-50">
										<Package className="w-3.5 h-3.5 text-ink-600 flex-shrink-0" />
										<span className="text-meta text-ink-700 font-medium flex-1 truncate">{a.name}</span>
										{loadingApp === a.name && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-600" />}
										<ArrowRight className={cn("w-3.5 h-3.5 text-ink-600 transition-transform", open && "rotate-90")} />
									</button>
									{open && groups && (
										<div className="border-t border-ink-100 px-3 py-2 space-y-1">
											{groups.length === 0 ? (
												<div className="text-micro text-ink-600">No casebooks on this app.</div>
											) : groups.map((g) => {
												const ref = { app: a.name, group: g.group, label: g.label };
												const on = picked(ref);
												return (
													<button
														key={g.group}
														type="button"
														aria-pressed={on}
														onClick={() => toggle(ref)}
														className={cn(
															"w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors",
															on ? "bg-gold-50 ring-1 ring-gold-200" : "hover:bg-ink-50",
														)}
													>
														<Database className="w-3 h-3 text-gold-500 flex-shrink-0" />
														<span className="text-caption text-ink-700 flex-1 truncate">{g.label}</span>
														<span className="text-nano text-ink-600">{g.files.length} file{g.files.length === 1 ? "" : "s"}</span>
														{on && <Check className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" />}
													</button>
												);
											})}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{allowTyped && (
				<div className="flex items-center gap-2">
					<input
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
						placeholder="Or name a dataset by its id"
						aria-label="Dataset id"
						className="flex-1 px-3 py-2 text-meta rounded-lg border border-ink-200 bg-card focus:outline-none focus:ring-4 focus:ring-gold-400/15 focus:border-gold-400"
					/>
					<button type="button" onClick={addTyped} disabled={!typed.trim()} className="inline-flex items-center gap-1 text-caption text-gold-700 hover:text-gold-800 font-medium disabled:opacity-50">
						<Plus className="w-3.5 h-3.5" />Add
					</button>
				</div>
			)}

			{multiple && value.some((v) => v.app) && (
				<div className="flex flex-wrap gap-1.5" aria-label="Picked casebooks">
					{value.filter((v) => v.app).map((v) => (
						<span key={`${v.app}/${v.group}`} className="inline-flex items-center gap-1 text-caption rounded-full px-2.5 py-1 bg-gold-50 text-gold-700 border border-gold-300">
							{v.label}
							<button type="button" onClick={() => toggle(v)} aria-label={`Remove ${v.label}`} className="hover:text-gold-900"><X className="w-3 h-3" /></button>
						</span>
					))}
				</div>
			)}
		</div>
	);
}

export default DatasetPicker;
