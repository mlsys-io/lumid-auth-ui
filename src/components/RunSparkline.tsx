// RunSparkline — tiny inline state-history strip for workflow list rows.
//
// 14 squares max, oldest left → newest right. Color encodes outcome:
//   succeeded → emerald, recovered → amber, failed → rose, skipped → slate,
//   running → amber-pulse. Empty (no runs yet) → "—" text.
//
// The spec field comes from /me/workflows MeWorkflowRow.run_spark (one char
// per run, oldest→newest); we translate to colored squares.
//
// INTERACTIVE MODE: pass `runs` (MeWorkflowRow.runs_recent — same order as
// spec, each carrying the cycle dir-id) plus `app`/`loop`, and every dot
// becomes addressable: hover previews that cycle's CycleCard, click pins it
// open. Without those props it stays a plain display strip.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SparkRun } from "@/api/me";
import CycleCard from "@/components/workflow/CycleCard";

interface Props {
	spec: string;
	className?: string;
	// Interactive mode (all three required to enable clickable dots):
	runs?: SparkRun[];
	app?: string;
	loop?: string;
}

const SQ_CLASS: Record<string, string> = {
	o: "bg-emerald-400",
	r: "bg-amber-400",   // recovered: succeeded only via retry/fallback (self-healed)
	x: "bg-rose-500",
	_: "bg-slate-300",
	".": "bg-amber-400 animate-pulse",
};

const STATE_LABEL: Record<string, string> = {
	o: "succeeded",
	r: "recovered (self-healed via retry)",
	x: "failed",
	_: "skipped",
	".": "running",
};

export function RunSparkline({ spec, className, runs, app, loop }: Props) {
	// Event motion (not load): when the spec changes — a new run landed —
	// pop the newest bar. No animation on first mount or unchanged polls.
	const prev = useRef(spec);
	const changed = prev.current !== spec;
	useEffect(() => { prev.current = spec; });

	// Active dot is tracked with its on-screen rect so the CycleCard can be
	// rendered in a PORTAL at fixed viewport coords — escaping the app card's
	// overflow-hidden / grid stacking that would otherwise clip or occlude it.
	type Hit = { idx: number; rect: DOMRect };
	const [hover, setHover] = useState<Hit | null>(null);
	const [pinned, setPinned] = useState<Hit | null>(null);
	const active = pinned ?? hover;

	const interactive = !!(runs && runs.length && app && loop);

	// Hover-intent: the card lives in a portal (not a DOM child of the dot
	// strip), so moving the mouse dot→card leaves the strip. Delay the close
	// so the card can cancel it; otherwise the popover vanishes mid-travel.
	const closeT = useRef<number | undefined>(undefined);
	const cancelClose = () => { if (closeT.current) window.clearTimeout(closeT.current); };
	const scheduleClose = () => { cancelClose(); closeT.current = window.setTimeout(() => setHover(null), 140); };

	// A pinned popover placed at fixed coords goes stale on scroll/resize —
	// close it rather than let it drift.
	useEffect(() => {
		if (!pinned) return;
		const close = () => setPinned(null);
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		return () => {
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
		};
	}, [pinned]);

	if (!spec) {
		return <span className={["text-[10px] text-slate-300", className].filter(Boolean).join(" ")}>—</span>;
	}
	const chars = spec.split("");

	if (!interactive) {
		return (
			<div className={["inline-flex items-center gap-px", className].filter(Boolean).join(" ")} title={`${chars.length} recent runs`}>
				{chars.map((c, i) => (
					<span
						key={i}
						className={["w-1.5 h-3 rounded-sm transition-transform hover:scale-125", changed && i === chars.length - 1 ? "spark-pop" : "", SQ_CLASS[c] || "bg-slate-200"].join(" ")}
						title={STATE_LABEL[c] || c}
					/>
				))}
			</div>
		);
	}

	// Interactive: dots are buttons; the CycleCard renders in a portal at
	// fixed coords computed from the active dot's rect.
	const activeRun = active ? runs![active.idx] : null;
	const CARD_W = 288; // w-72
	let cardStyle: React.CSSProperties | null = null;
	if (active) {
		const r = active.rect;
		const gap = 8;
		const left = Math.max(8, Math.min(window.innerWidth - CARD_W - 8, r.right - CARD_W));
		// Prefer above the dot; flip below when there isn't room overhead.
		cardStyle = r.top > 300
			? { position: "fixed", left, bottom: window.innerHeight - r.top + gap, zIndex: 60 }
			: { position: "fixed", left, top: r.bottom + gap, zIndex: 60 };
	}

	return (
		<div
			className={["relative inline-flex items-center gap-px", className].filter(Boolean).join(" ")}
			onMouseLeave={scheduleClose}
		>
			{chars.map((c, i) => {
				const isActive = active?.idx === i;
				return (
					<button
						key={i}
						type="button"
						aria-label={`run ${i + 1}: ${STATE_LABEL[c] || c}`}
						title={STATE_LABEL[c] || c}
						onMouseEnter={(e) => { cancelClose(); setHover({ idx: i, rect: e.currentTarget.getBoundingClientRect() }); }}
						onClick={(e) => {
							e.stopPropagation();
							const rect = e.currentTarget.getBoundingClientRect();
							setPinned((p) => (p?.idx === i ? null : { idx: i, rect }));
						}}
						className={[
							"w-1.5 h-3 rounded-sm transition-transform cursor-pointer hover:scale-150",
							isActive ? "scale-150 ring-1 ring-slate-400 ring-offset-1" : "",
							changed && i === chars.length - 1 ? "spark-pop" : "",
							SQ_CLASS[c] || "bg-slate-200",
						].join(" ")}
					/>
				);
			})}
			{activeRun && cardStyle && createPortal(
				<>
					{/* click-away catcher while pinned (below the card) */}
					{pinned && <div className="fixed inset-0" style={{ zIndex: 59 }} onClick={() => setPinned(null)} />}
					<div
						style={cardStyle}
						onClick={(e) => e.stopPropagation()}
						onMouseEnter={cancelClose}
						onMouseLeave={scheduleClose}
					>
						<CycleCard app={app!} loop={loop!} ts={activeRun.ts} st={activeRun.st} onOpenFull={() => setPinned(null)} />
					</div>
				</>,
				document.body,
			)}
		</div>
	);
}

export default RunSparkline;
