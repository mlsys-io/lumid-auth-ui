// Rental economics for the `vast` site — the part of the old Vast tab that was
// NOT already in Fleet.
//
// Vast is a SITE, not a section. Fleet already lists its nodes and workers with
// every other site, so a separate tab re-listed the same rows and the only thing
// it added was money: what is rented, against which caps, under which autoscaler
// policy. That belongs ON the vast site, which is where someone looking at rented
// capacity already is.
//
// Takes the workers Fleet has already fetched rather than fetching again.

import { FM_DEFAULT_COST_PER_HOUR, secondsSince, type FmWorker } from "../../api/fm";

// Mirrors the vast-autoscaler CronJob env. Display-only: the authoritative values
// live in k8s-lift/vast-autoscaler/vast-autoscaler.yaml.
const CAPS = {
	maxPerInstance: 0.35,
	maxFleet: 1.0,
	maxInstances: 3,
	minInstances: 0,
	idleTtlSec: 900,
	gpu: "RTX 5080",
};

const STALE_SEC = 300;

export default function VastEconomics({ workers }: { workers: FmWorker[] }) {
	const live = workers.filter((w) => {
		const age = secondsSince(w.last_seen);
		return age !== null && age < STALE_SEC;
	});
	const stale = workers.length - live.length;

	// FlowMesh's `cost_per_hour` is WORKER_COST_PER_HOUR, default 1.0, and nothing
	// on most sites sets it — so summing it raw once produced a headline
	// "Burn rate $2.000/hr" with a red over-cap bar while the true fleet was 0
	// instances at $0.000/hr: a false overspend alarm assembled from a default
	// multiplied by ghosts. Only count workers someone actually priced.
	const priced = live.filter(
		(w) => w.cost_per_hour != null && w.cost_per_hour !== FM_DEFAULT_COST_PER_HOUR,
	);
	const burn = priced.reduce((a, w) => a + (w.cost_per_hour ?? 0), 0);
	const costKnown = priced.length === live.length && live.length > 0;
	const pctFleet = Math.min(100, (burn / CAPS.maxFleet) * 100);

	return (
		<div className="border-t border-slate-200 bg-amber-50/30 px-3 py-3">
			<div className="grid gap-3 sm:grid-cols-3">
				<div>
					<p className="text-xs text-slate-500">Rented workers</p>
					<p className="mt-0.5 text-lg font-semibold text-slate-900">
						{live.length}
						<span className="ml-1 text-xs font-normal text-slate-500">
							/ {CAPS.maxInstances} cap
						</span>
					</p>
					<p className="text-xs text-slate-500">
						floor {CAPS.minInstances} — scales to zero
						{stale > 0 && (
							<span className="ml-1 text-amber-700">
								· {stale} stale row{stale > 1 ? "s" : ""} excluded
							</span>
						)}
					</p>
				</div>
				<div>
					<p className="text-xs text-slate-500">Burn rate</p>
					{costKnown ? (
						<>
							<p className="mt-0.5 text-lg font-semibold text-slate-900">
								${burn.toFixed(3)}
								<span className="ml-1 text-xs font-normal text-slate-500">/hr</span>
							</p>
							<div className="mt-1 h-1.5 w-full rounded bg-slate-200">
								<div
									className={`h-1.5 rounded ${pctFleet > 80 ? "bg-red-500" : "bg-emerald-500"}`}
									style={{ width: `${pctFleet}%` }}
								/>
							</div>
						</>
					) : (
						<>
							<p className="mt-0.5 text-lg font-semibold text-slate-400">—</p>
							<p className="text-xs text-slate-500">
								{live.length === 0
									? "nothing rented"
									: "not reported — the vast.ai console is authoritative"}
							</p>
						</>
					)}
					<p className="text-xs text-slate-500">cap ${CAPS.maxFleet.toFixed(2)}/hr fleet</p>
				</div>
				<div>
					<p className="text-xs text-slate-500">Autoscaler policy</p>
					<ul className="mt-0.5 space-y-0.5 text-xs text-slate-600">
						<li>≤ ${CAPS.maxPerInstance.toFixed(2)}/hr per instance</li>
						<li>idle {CAPS.idleTtlSec / 60} min → destroy</li>
						<li>{CAPS.gpu} only</li>
					</ul>
				</div>
			</div>
			{live.length === 0 && (
				<p className="mt-2 text-xs text-slate-500">
					No rented capacity right now — the normal idle state. The floor is zero, so an idle
					day costs nothing but the in-cluster supervisor; queue GPU work and the autoscaler
					rents within a minute.
				</p>
			)}
		</div>
	);
}
