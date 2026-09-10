// Nodes — every mesh's nodes in one table, tagged by site.

import { useMemo, useState } from "react";
import { listNodes, nodeTags, secondsSince, type FmNode } from "../../api/fm";
import { Age, SiteBadge, SiteStrip, TabShell, useFanout } from "./shared";

export default function NodesTab() {
	const { data, loading, error, refresh } = useFanout<FmNode>(() => listNodes(), 30_000);
	const [q, setQ] = useState("");

	const rows = useMemo(() => {
		const items = data?.items ?? [];
		const needle = q.trim().toLowerCase();
		const filtered = needle
			? items.filter((n) =>
					[n.alias, n.id, n.site, n.cluster, ...nodeTags(n)]
						.filter(Boolean)
						.some((v) => String(v).toLowerCase().includes(needle)),
				)
			: items;
		return [...filtered].sort(
			(a, b) => (a.site ?? "").localeCompare(b.site ?? "") || a.alias.localeCompare(b.alias),
		);
	}, [data, q]);

	return (
		<TabShell
			title="Nodes"
			subtitle={`${data?.items.length ?? 0} node(s) across the federation`}
			loading={loading}
			error={error}
			onRefresh={refresh}
		>
			<SiteStrip sites={data?.sites ?? []} />

			<input
				value={q}
				onChange={(e) => setQ(e.target.value)}
				placeholder="Filter by alias, id, site, tag…"
				className="mb-3 w-full max-w-sm rounded-md border border-slate-200 px-3 py-1.5 text-sm"
			/>

			<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
						<tr>
							<th className="px-3 py-2">Site</th>
							<th className="px-3 py-2">Alias</th>
							<th className="px-3 py-2">Node</th>
							<th className="px-3 py-2">GPUs</th>
							<th className="px-3 py-2">Tags</th>
							<th className="px-3 py-2">Version</th>
							<th className="px-3 py-2">Last seen</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.map((n) => (
							<tr key={`${n.site}:${n.id}`} className="hover:bg-slate-50">
								<td className="px-3 py-2">
									<SiteBadge site={n.site} />
								</td>
								<td className="px-3 py-2 font-medium text-slate-900">{n.alias}</td>
								<td className="px-3 py-2 font-mono text-xs text-slate-600">{n.id}</td>
								<td className="px-3 py-2">
									{n.current_gpu_count}/{n.max_gpu_count}
								</td>
								<td className="px-3 py-2">
									{/* nodeTags() splits the comma-joined string the node registry
									    serializes; worker tags arrive as a real array. */}
									<div className="flex flex-wrap gap-1">
										{nodeTags(n).map((t) => (
											<span
												key={t}
												className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
											>
												{t}
											</span>
										))}
									</div>
								</td>
								<td className="px-3 py-2 text-xs text-slate-600">{n.version ?? "—"}</td>
								<td className="px-3 py-2 text-xs">
									<Age seconds={secondsSince(n.last_seen)} />
								</td>
							</tr>
						))}
						{!rows.length && !loading && (
							<tr>
								<td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
									No nodes match.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</TabShell>
	);
}
