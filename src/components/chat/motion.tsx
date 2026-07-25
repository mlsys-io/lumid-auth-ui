// Motion primitives for the chat transcript.
//
// Centralized so timing/easing stay consistent and — more importantly — so
// `prefers-reduced-motion` is honored in exactly ONE place. globals.css already
// neutralizes CSS animations for that media query, but framer-motion is
// JS-driven and needs the hook, so every primitive here degrades to an instant,
// non-animated render when the user asks for reduced motion.
//
// Historical note: the transcript used to carry `animate-in fade-in
// slide-in-from-bottom-1` classes from tailwindcss-animate — a plugin that was
// never installed. Those classes resolved to nothing, so messages had appeared
// with zero enter animation for as long as they'd been there.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

// Fast enough to feel immediate on every streamed block, slow enough to read as
// motion rather than a flicker. Chat blocks arrive constantly — anything longer
// stacks up visibly behind a fast stream.
const ENTER = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };
const COLLAPSE = { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const };

export { AnimatePresence };

/** True when the user has NOT asked for reduced motion. */
export function useMotionOK(): boolean {
	return !useReducedMotion();
}

/**
 * Mount animation for a transcript item (message bubble, content block).
 *
 * No `layout` prop on purpose: the transcript can hold hundreds of blocks and
 * layout animation measures every one of them on each commit. Blocks only ever
 * APPEND, so a plain enter transition gives the right feel for free.
 */
export function Appear({
	children, className, delay = 0,
}: { children: ReactNode; className?: string; delay?: number }) {
	const ok = useMotionOK();
	if (!ok) return <div className={className}>{children}</div>;
	return (
		<motion.div
			className={className}
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ ...ENTER, delay }}
		>
			{children}
		</motion.div>
	);
}

/**
 * Height-auto collapse. Every collapsible in the chat used to be a bare
 * conditional mount, so panels snapped open and shut.
 *
 * Render this ALWAYS and pass `open` — it needs both states present to animate
 * between them, unlike `{open && <div/>}`.
 */
export function Collapse({
	open, children, className,
}: { open: boolean; children: ReactNode; className?: string }) {
	const ok = useMotionOK();
	if (!ok) return open ? <div className={className}>{children}</div> : null;
	return (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					className={className}
					style={{ overflow: 'hidden' }}
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: 'auto', opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={COLLAPSE}
				>
					{children}
				</motion.div>
			)}
		</AnimatePresence>
	);
}

/**
 * Streaming caret — the "still writing" affordance the transcript never had.
 * The three bouncing dots only cover the window BEFORE the first token; once
 * text starts flowing it grew with nothing marking the live edge.
 *
 * Steady opacity under reduced motion so it still marks the position.
 */
export function StreamCaret() {
	const ok = useMotionOK();
	const base = 'inline-block w-[2px] h-[0.95em] -mb-[0.1em] ml-0.5 bg-gold-500 align-baseline';
	if (!ok) return <span className={base} />;
	return (
		<motion.span
			className={base}
			animate={{ opacity: [1, 1, 0, 0] }}
			transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: 'linear' }}
		/>
	);
}

/**
 * "Jump to latest" pill. Auto-scroll deliberately stops following once the user
 * scrolls up (so reading isn't yanked), which left no way back to the live edge
 * except manual scrolling.
 */
export function JumpToLatest({ onClick }: { onClick: () => void }) {
	const ok = useMotionOK();
	const body = (
		<button
			type="button"
			onClick={onClick}
			className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/95 backdrop-blur-sm shadow-md text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95"
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
			</svg>
			Jump to latest
		</button>
	);
	// Anchored to the composer footer (which is `relative`), so it floats just
	// above the input rather than inside the scrolling transcript — an absolute
	// child of the scroll container would scroll away with the content.
	const wrap = 'pointer-events-none absolute inset-x-0 -top-9 z-20 flex justify-center';
	if (!ok) return <div className={wrap}>{body}</div>;
	return (
		<motion.div
			className={wrap}
			initial={{ opacity: 0, y: 6 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: 6 }}
			transition={ENTER}
		>
			{body}
		</motion.div>
	);
}

/**
 * Shimmer for a row that is actively working. A static ✓/spinner glyph is easy
 * to miss on a dense transcript — the whole row breathing is what reads as
 * "this is happening now".
 */
export function Working({ children, className }: { children: ReactNode; className?: string }) {
	const ok = useMotionOK();
	if (!ok) return <div className={className}>{children}</div>;
	return (
		<motion.div
			className={className}
			animate={{ opacity: [1, 0.55, 1] }}
			transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
		>
			{children}
		</motion.div>
	);
}

/**
 * Three-dot "thinking" pulse. Reasoning had NO in-progress affordance at all —
 * just a static "Thinking…" label that looked identical to a finished block.
 */
export function ThinkingDots() {
	const ok = useMotionOK();
	if (!ok) return <span className="inline-flex gap-[3px]">{[0, 1, 2].map((i) => (
		<span key={i} className="w-1 h-1 rounded-full bg-gold-500" />
	))}</span>;
	return (
		<span className="inline-flex gap-[3px] items-center">
			{[0, 1, 2].map((i) => (
				<motion.span
					key={i}
					className="w-1 h-1 rounded-full bg-gold-500"
					animate={{ opacity: [0.25, 1, 0.25], y: [0, -1.5, 0] }}
					transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.16 }}
				/>
			))}
		</span>
	);
}

/** Chevron that rotates instead of snapping. */
export function Chevron({ open, className }: { open: boolean; className?: string }) {
	const ok = useMotionOK();
	return (
		<motion.span
			className={['inline-flex', className].filter(Boolean).join(' ')}
			animate={{ rotate: open ? 0 : -90 }}
			transition={ok ? COLLAPSE : { duration: 0 }}
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<polyline points="6 9 12 15 18 9" />
			</svg>
		</motion.span>
	);
}
