// WarehouseActivity — which warehouse tables a run (or a workflow) wrote and
// read, each a link into the Data Warehouse catalog. Recorded by the data
// services since 25 Nov for runs that say who they are; an instance that
// records nothing yet is left out, never shown as "wrote nothing".
//
// Words and links come from lib/data-activity (tested); this only places them.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Database } from "lucide-react";
import type { InstanceActivity } from "@/api/dataLake";
import { activityRows, emptyActivityLine, tableHref, tableUseLine } from "@/lib/data-activity";
import { cn } from "@/lib/utils";

type Row = ReturnType<typeof activityRows>[number];

function TableRow({ r }: { r: Row }) {
	return (
		<li>
			<Link to={tableHref(r.instanceId, r.use.schema, r.use.table)} title={`Open ${r.use.schema}.${r.use.table} in the Data Warehouse`}
				className="flex items-start gap-2 rounded-lg border border-ink-200 bg-card px-2.5 py-1.5 hover:border-ink-300 hover:bg-muted/40 transition-colors min-w-0">
				<Database className="w-3.5 h-3.5 mt-0.5 text-ink-500 flex-shrink-0" aria-hidden />
				<span className="min-w-0">
					<span className="block text-caption font-medium text-ink-900 font-mono truncate">{r.use.schema}.{r.use.table}</span>
					<span className="block text-micro text-ink-600 truncate">{tableUseLine(r.use, r.verb)} · {r.instanceLabel}</span>
				</span>
			</Link>
		</li>
	);
}

export default function WarehouseActivity({ load, what, loadKey }: {
	/** Fetch the activity (runActivityAcrossLakes / appActivityAcrossLakes). */
	load: () => Promise<InstanceActivity[]>;
	what: "run" | "workflow";
	loadKey: string;
}) {
	const [acts, setActs] = useState<InstanceActivity[] | null>(null);
	const [openReads, setOpenReads] = useState(what === "workflow");
	useEffect(() => {
		let live = true;
		setActs(null);
		load().then((a) => { if (live) setActs(a); }).catch(() => { if (live) setActs([]); });
		return () => { live = false; };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loadKey]);
	if (!acts) return null;
	const rows = activityRows(acts);
	const wrote = rows.filter((r) => r.verb === "wrote");
	const read = rows.filter((r) => r.verb === "read");
	// A run that touched no table says nothing (most runs); a workflow says so.
	if (!rows.length) return what === "workflow" ? <p className="text-micro text-ink-600">{emptyActivityLine(what)}</p> : null;
	return (
		<div className="space-y-2">
			{wrote.length > 0 && (
				<div>
					<div className="text-micro text-ink-600 mb-1">{what === "run" ? "Data it wrote" : "Writes"}</div>
					<ul className="space-y-1">{wrote.map((r) => <TableRow key={`${r.instanceId}:${r.use.schema}.${r.use.table}`} r={r} />)}</ul>
				</div>
			)}
			{read.length > 0 && (
				<div>
					<button type="button" aria-expanded={openReads} onClick={() => setOpenReads((v) => !v)}
						className="inline-flex items-center gap-1 text-micro text-ink-600 hover:text-ink-900 mb-1">
						<ChevronRight className={cn("w-3 h-3 transition-transform", openReads && "rotate-90")} aria-hidden />
						{what === "run" ? "Data it read" : "Reads"} · {read.length}
					</button>
					{openReads && <ul className="space-y-1">{read.map((r) => <TableRow key={`${r.instanceId}:${r.use.schema}.${r.use.table}:r`} r={r} />)}</ul>}
				</div>
			)}
		</div>
	);
}
