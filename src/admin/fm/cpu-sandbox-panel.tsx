// CPU sandbox capacity for one site — the part of a site's compute that is NOT
// a FlowMesh worker.
//
// why this exists: research-fleet renders exactly what a site's FlowMesh registry
// says, and a CPU sandbox is not in that registry. h0 and the NUS storage head are
// rentable CPU boxes that appear in no worker list at all, so a site looked idle
// while its CPU was being handed out. A GPU sandbox is at least adjacent to the
// worker rows; a CPU sandbox had nothing on this page pointing at it.
//
// WHAT THIS SHOWS, AND WHAT IT REFUSES TO CLAIM. `GET /api/sandboxes` publishes the
// site's CPU menu (`CPU_SIZES` / `max_memory_gi`) and nothing else about CPU. The
// cluster has no CPU equivalent of `nvidia.com/gpu` capacity here — /api/admin/usage
// skips every node without a GPU capacity (`if not cap: continue`), so a CPU-only
// node is invisible to it — which means there is NO honest "N cores free" number to
// render. So this panel shows the menu and how many boxes are running, and says so.
// A headline "free cores" assembled from anything else would be a number nobody
// measured.
//
// The box count is SITE-WIDE for an admin and the CALLER'S OWN otherwise, because
// the per-caller endpoint is the only one a non-admin may read. Labelling that
// difference is not decoration: "3 running" off a per-caller list reads as site
// load.

import { useMemo } from "react";
import { fanoutForSites } from "../../api/fm";
import { SANDBOX_SITES, cpuFactsForSite, type CpuSiteFacts } from "../../api/sandboxes";
import { useFanout } from "./shared";

// GPU sandboxes carry gpu > 0 and are represented by the worker rows; a CPU
// sandbox is the one with no GPU at all. `Queued`/`Pending` are counted with
// running for the same reason the sandbox table does it: a box that cannot be
// placed is still a box someone holds and still reserves its request.
const ACTIVE_PHASES = new Set(["Running", "Pending", "Queued", "Terminating"]);

export default function CpuSandboxPanel({ site, isAdmin }: { site: string; isAdmin: boolean }) {
	const facts = useFanout<CpuSiteFacts>(() => fanoutForSites([site], (s) => cpuFactsForSite(s, isAdmin).then((f) => [f])), 30_000);

	const result = facts.data?.items[0] ?? null;
	const refused = facts.data?.sites.find((s) => !s.ok);

	const counts = useMemo(() => {
		const boxes = result?.boxes ?? [];
		const live = boxes.filter((b) => ACTIVE_PHASES.has(b.phase));
		// Only meaningful when EVERY live box reported its request — a partial sum
		// understates and reads as headroom that is not there.
		const sized = live.length > 0 && live.every((b) => b.cpu != null);
		const cores = sized ? live.reduce((a, b) => a + Number(b.cpu), 0) : null;
		return { live: live.length, total: boxes.length, cores };
	}, [result]);

	const menu = result?.menu ?? null;

	return (
		<div className="border-t border-slate-200 bg-slate-50/40 px-3 py-3">
			<div className="grid gap-3 sm:grid-cols-3">
				<div>
					<p className="text-xs text-slate-500">
						CPU sandboxes {isAdmin ? "(site-wide)" : "(yours)"}
					</p>
					<p className="mt-0.5 text-lg font-semibold text-slate-900">
						{refused ? "—" : counts.live}
						{counts.cores != null && (
							<span className="ml-1 text-xs font-normal text-slate-500">
								· {counts.cores} core(s) requested
							</span>
						)}
					</p>
					<p className="text-xs text-slate-500">
						{refused
							? `did not answer — ${refused.error ?? "no response"}`
							: isAdmin
								? counts.total > counts.live
									? `${counts.total - counts.live} finished/failed row(s) excluded`
									: "running, queued and terminating"
								: "your boxes only — every renter is admin-only"}
					</p>
				</div>
				<div>
					<p className="text-xs text-slate-500">Rentable sizes</p>
					{menu && menu.sizes.length > 0 ? (
						<>
							<div className="mt-1 flex flex-wrap gap-1">
								{menu.sizes.map((n) => (
									<span
										key={n}
										className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700"
									>
										{n} {n === 1 ? "core" : "cores"}
										<span className="ml-1 text-slate-400">
											{Math.min(n * 4, menu.max_memory_gi)} GiB
										</span>
									</span>
								))}
							</div>
							<p className="mt-1 text-xs text-slate-500">
								memory follows cores at 4 GiB each, capped at {menu.max_memory_gi} GiB
							</p>
						</>
					) : (
						<>
							<p className="mt-0.5 text-lg font-semibold text-slate-400">—</p>
							<p className="text-xs text-slate-500">
								{refused
									? "the site did not answer"
									: "this site publishes no fixed menu — any size it can place"}
							</p>
						</>
					)}
				</div>
				<div>
					<p className="text-xs text-slate-500">What this is not</p>
					<p className="mt-0.5 text-xs text-slate-600">
						The site's menu, not measured headroom. Nothing on this page reports free CPU: no
						per-node CPU capacity is collected for a sandbox pool, so a number would be a guess.
					</p>
				</div>
			</div>
		</div>
	);
}

/** True for a site that runs a sandbox-control at all (vast and cloud do not). */
export function hasCpuSandboxes(site: string): boolean {
	return SANDBOX_SITES.includes(site);
}
