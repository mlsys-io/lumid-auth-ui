// Your runs — the jobs YOU ran on the fleet, from any surface (the workflow
// editor's Run, the Run dialog here, job_run from chat or the SDK).
//
// Read from identity's own records (api/fleet.ts), not fanned out across
// sites: one site's task list alone has measured 13.8 MB. Statuses are the last
// ones seen; a job that is still going is refreshed while this view is open.
//
// Identity's list has no paging (newest first, `limit` only), so the panel says
// when it shows only the latest LIST_LIMIT. Every word below comes from
// lib/fleet-result.ts; this file only places them.

import { Fragment, useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
	fleet, type FleetJob, type FleetJobResult, type FleetJobStatus, type FleetStatus,
} from "../../api/fleet";
import {
	fleetStatusWord, latestRunsNote, lumilakeView, NO_REASON, picturesContext, problemLine, publicResult,
	resultButtonLabel, resultUnavailableLine, rowsLabel, runLabel, runProblems, tableCapLine, type ResultTable,
} from "../../lib/fleet-result";
import { runImages } from "../../lib/run-images";
import ResultImages from "./result-images";
import RunFiles from "./run-files";
import { runFiles } from "../../lib/run-files";

const LIST_LIMIT = 100;

const TONE: Record<FleetStatus, string> = {
	queued: "bg-ink-100 text-ink-600",
	running: "bg-plum-50 text-plum-700",
	succeeded: "bg-gold-50 text-gold-700",
	failed: "bg-brick-50 text-brick-700",
	canceled: "bg-ink-100 text-ink-600",
};

interface Opened {
	id: string;
	status: FleetStatus;
	result?: FleetJobResult;
	/** The status view, read alongside the result for a failed run: its `error` / `failed_step`. */
	detail?: FleetJobStatus;
	error?: string;
	loading: boolean;
}

export default function MyRuns() {
	const [jobs, setJobs] = useState<FleetJob[] | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [open, setOpen] = useState<Opened | null>(null);

	const load = useCallback(async () => {
		try {
			const { jobs } = await fleet.list({ limit: LIST_LIMIT });
			// Refresh the ones still going, so a finished job does not keep
			// reading "running" until someone opens it.
			const fresh = await Promise.all(
				jobs.map(async (j) => {
					if (j.terminal) return j;
					try {
						const s = await fleet.status(j.id);
						return { ...j, status: s.status, terminal: s.terminal };
					} catch {
						return j;
					}
				}),
			);
			setJobs(fresh);
			setProblem(null);
		} catch (e) {
			setProblem((e as Error)?.message || "could not load your runs");
		}
	}, []);

	useEffect(() => {
		void load();
		const t = setInterval(() => void load(), 15_000);
		return () => clearInterval(t);
	}, [load]);

	const toggleResult = async (j: FleetJob) => {
		if (open?.id === j.id) {
			setOpen(null);
			return;
		}
		setOpen({ id: j.id, status: j.status, loading: true });
		// A failed run's reason lives partly in the status view (error,
		// failed_step); read both, and keep whichever answered.
		const [res, st] = await Promise.allSettled([
			fleet.result(j.id),
			j.status === "failed" ? fleet.status(j.id) : Promise.reject(new Error("skip")),
		]);
		setOpen((cur) =>
			cur?.id !== j.id
				? cur
				: {
						id: j.id,
						status: j.status,
						loading: false,
						result: res.status === "fulfilled" ? res.value : undefined,
						detail: st.status === "fulfilled" ? st.value : undefined,
						error: res.status === "rejected" ? (res.reason as Error)?.message || "no result" : undefined,
					},
		);
	};

	if (problem) return <p className="text-xs text-brick-700">{problem}</p>;
	if (!jobs) return <p className="text-xs text-ink-600">Loading your runs…</p>;
	if (jobs.length === 0) {
		return (
			<p className="text-xs text-ink-600">
				No runs yet. Run a compute graph from the workflow editor, or with{" "}
				<code>job_run</code> from chat.
			</p>
		);
	}
	const capNote = latestRunsNote(jobs.length, LIST_LIMIT);
	return (
		<div className="overflow-x-auto rounded-lg border border-ink-200 bg-card">
			<table className="w-full text-xs">
				<thead className="bg-ink-50 text-left text-ink-600">
					<tr>
						<th className="px-3 py-2">Run</th>
						<th className="px-3 py-2">Status</th>
						<th className="px-3 py-2">Experiment · version</th>
						<th className="px-3 py-2">Started</th>
						<th className="px-3 py-2" />
					</tr>
				</thead>
				<tbody>
					{jobs.map((j) => {
						const isOpen = open?.id === j.id;
						return (
							<Fragment key={j.id}>
								<tr className={`border-t border-ink-100 align-top ${isOpen ? "bg-ink-50" : ""}`}>
									<td className="px-3 py-2">
										<div className="text-meta font-medium text-ink-900">{runLabel(j)}</div>
										<CopyId id={j.id} />
									</td>
									<td className="px-3 py-2">
										<span className={`rounded px-1.5 py-0.5 ${TONE[j.status]}`}>{fleetStatusWord(j.status)}</span>
									</td>
									<td className="px-3 py-2 text-ink-600">
										{[j.labels?.study, j.labels?.experiment].filter(Boolean).join(" · ") || "—"}
									</td>
									<td className="px-3 py-2 text-ink-600">
										{j.created_at ? new Date(j.created_at).toLocaleString() : "—"}
									</td>
									<td className="px-3 py-2 text-right whitespace-nowrap">
										{/* A failed run has a result too: which step failed, and why. */}
										{(j.status === "succeeded" || j.status === "failed") && (
											<button
												className="text-plum-700 hover:underline"
												aria-expanded={isOpen}
												onClick={() => void toggleResult(j)}
											>
												{resultButtonLabel(j.status, isOpen)}
											</button>
										)}
										{!j.terminal && (
											<button
												className="ml-2 text-ink-600 hover:text-ink-800"
												onClick={() => void fleet.cancel(j.id).then(load)}
											>
												Cancel
											</button>
										)}
									</td>
								</tr>
								{isOpen && open && (
									<tr className="bg-ink-50">
										<td colSpan={5} className="px-3 pb-3 pt-1">
											<RunResult opened={open} />
										</td>
									</tr>
								)}
							</Fragment>
						);
					})}
				</tbody>
			</table>
			{capNote && <p className="border-t border-ink-100 px-3 py-2 text-micro text-ink-600">{capNote}</p>}
		</div>
	);
}

/** The machine id, small, with a copy button. */
function CopyId({ id }: { id: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(id);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* clipboard refused: the id is still selectable */
		}
	};
	return (
		<div className="mt-0.5 flex items-center gap-1 text-micro text-ink-600">
			<span className="select-all font-mono">{id}</span>
			<button
				type="button"
				onClick={() => void copy()}
				className="rounded p-0.5 hover:bg-ink-100 hover:text-ink-800"
				aria-label={copied ? "Copied" : "Copy run id"}
				title={copied ? "Copied" : "Copy run id"}
			>
				{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
			</button>
		</div>
	);
}

/** What one run produced, or why it failed — shown directly under its row. */
function RunResult({ opened }: { opened: Opened }) {
	if (opened.loading) return <p className="text-ink-600">Loading…</p>;
	const outputs = opened.result?.outputs;
	const problems = runProblems({ outputs, status: opened.detail });
	const failed = opened.status === "failed";
	const view = lumilakeView(outputs);
	const recognized = view.tables.length > 0 || view.texts.length > 0;
	const images = runImages(opened.id, outputs);
	const metrics = Object.entries(opened.result?.metrics ?? {});

	return (
		<div className="space-y-2">
			{failed && (
				<div className="space-y-1">
					{(problems.length > 0 ? problems.map(problemLine) : [NO_REASON]).map((line, i) => (
						<p key={i} className="whitespace-pre-wrap text-meta text-brick-700">{line}</p>
					))}
				</div>
			)}
			{opened.error ? (
				<p className={failed ? "text-ink-600" : "text-brick-700"}>{resultUnavailableLine(opened.status, opened.error)}</p>
			) : (
				opened.result && (
					<>
						{metrics.length > 0 && (
							<p className="text-ink-700">
								Metrics: {metrics.map(([k, v]) => `${k} = ${v}`).join(", ")}
							</p>
						)}
						{/* Pictures first: a run that made images should show them, not their paths. */}
						<ResultImages images={images} context={picturesContext(outputs)} />
						{/* Every file the run produced, openable and downloadable (owner-only, via identity). */}
						<RunFiles fleetId={opened.id} files={runFiles(opened.id, outputs)} />
						{view.tables.map((t, i) => <ResultTableView key={`t${i}`} table={t} />)}
						{view.texts.map((t, i) => (
							<div key={`x${i}`}>
								<div className="mb-1 text-micro font-medium text-ink-700">{t.caption}</div>
								{t.texts.map((s, k) => (
									<p key={k} className="mb-1 whitespace-pre-wrap rounded bg-card p-2 text-ink-800">{s}</p>
								))}
							</div>
						))}
						<details open={!recognized && images.length === 0 && !failed}>
							<summary className="cursor-pointer text-micro text-ink-600 hover:text-ink-800">Raw result</summary>
							<pre className="mt-1 max-h-72 overflow-auto rounded bg-card p-2 text-micro text-ink-800">
								{JSON.stringify(publicResult(outputs), null, 2)}
							</pre>
						</details>
					</>
				)
			)}
		</div>
	);
}

function ResultTableView({ table }: { table: ResultTable }) {
	const cap = tableCapLine(table);
	return (
		<div className="max-h-96 overflow-auto rounded border border-ink-200 bg-card">
			<table className="w-full text-xs">
				<caption className="px-2 py-1.5 text-left text-micro text-ink-600">
					<span className="font-medium text-ink-800">{table.caption}</span> · {rowsLabel(table.totalRows)}
					{cap && ` · ${cap}`}
				</caption>
				<thead className="sticky top-0 bg-ink-50 text-ink-600">
					<tr>
						{table.index && <th className="px-2 py-1" />}
						{table.columns.map((c, i) => (
							<th key={c} className={`px-2 py-1 font-medium ${table.numeric[i] ? "text-right" : "text-left"}`}>{c}</th>
						))}
					</tr>
				</thead>
				<tbody>
					{table.rows.map((row, r) => (
						<tr key={r} className="border-t border-ink-100">
							{table.index && <th scope="row" className="px-2 py-1 text-left font-medium text-ink-700">{table.index[r]}</th>}
							{row.map((cell, c) => (
								<td key={c} className={`px-2 py-1 text-ink-800 ${table.numeric[c] ? "text-right tabular-nums" : ""}`}>{cell}</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
