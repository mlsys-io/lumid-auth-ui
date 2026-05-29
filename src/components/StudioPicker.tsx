// StudioPicker — the chat-driven "pick a UI element" mode.
//
// Activated from the chat header's Crosshair button. While active:
//   • A fullscreen capture overlay catches pointer events so the user
//     doesn't accidentally navigate while picking.
//   • Hovering paints a green ring around the nearest pickable
//     ancestor (any element with [data-pick-id]) + a tooltip with
//     `<kind> · <label>`.
//   • Clicking commits the pick → setStudioPickedTarget(...) →
//     chip appears above the chat input. Esc cancels.
//
// Pages opt in declaratively. To make an element pickable:
//
//   <div
//     data-pick-kind="intent"
//     data-pick-id="common-person-week-2"
//     data-pick-label="Handle my weekly inbox the way I would"
//     data-pick-affordances="pause,resume,rerun,inspect"
//   >…</div>
//
// `id` is required; `kind`/`label`/`affordances` default sensibly.

import { useEffect, useRef, useState } from 'react';
import { setStudioPickedTarget } from './StudioContext';

// ── Module-level activation flag + setter ─────────────────────────
// StudioChat toggles this; StudioPicker subscribes and re-renders.
let active = false;
const activeListeners = new Set<(v: boolean) => void>();

export function startStudioPicking(): void {
	if (active) return;
	active = true;
	activeListeners.forEach((l) => l(true));
}
export function stopStudioPicking(): void {
	if (!active) return;
	active = false;
	activeListeners.forEach((l) => l(false));
}
export function isStudioPicking(): boolean { return active; }
export function subscribeStudioPicking(l: (v: boolean) => void): () => void {
	activeListeners.add(l);
	return () => { activeListeners.delete(l); };
}

// ── Pickable resolution ───────────────────────────────────────────
// Walk up from the hit element until we find an ancestor with
// data-pick-id. Skip our own overlay/highlight nodes (they're tagged
// data-studio-picker-chrome so elementsFromPoint won't be confused).

function findPickable(el: Element | null): HTMLElement | null {
	let cur: Element | null = el;
	while (cur && cur instanceof HTMLElement) {
		if (cur.dataset.pickId) return cur;
		cur = cur.parentElement;
	}
	return null;
}

// ── Meaningful-element heuristic ──────────────────────────────────
// Walk up from the hit element looking for the smallest semantically-
// meaningful ancestor. A "meaningful" element is one of:
//   1. A semantic tag (button, link, heading, list item, section …)
//      with non-trivial text.
//   2. A container with text AND visible styling (border / shadow /
//      background / padding) — i.e. a card.
// Pure layout wrappers, single-word spans, and chrome (sidebar, top
// bar, chat aside) are skipped via SKIP_TAGS + the chrome marker.

// Semantic units the picker will pick directly. `<aside>` is
// excluded since it's reserved for the sidebar + chat panel in this
// shell — anything in there is chrome.
const SEMANTIC_TAGS = new Set([
	'button', 'a',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'li', 'tr', 'td', 'th',
	'article', 'section', 'figure', 'figcaption',
	'blockquote', 'pre', 'code',
	'summary', 'details',
	'label',
	'img',
]);
// Tags we always walk past — input fields (user is editing), top-
// level shells (would pick the whole page), nav/header/aside chrome
// (picking the sidebar is never the intent), SVG primitives (used as
// icons), <p> wrappers (often inline runs, walk to a better unit).
const SKIP_TAGS = new Set([
	'body', 'html', 'main', 'header', 'footer', 'nav', 'aside',
	'input', 'textarea', 'select', 'option',
	'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs',
	'script', 'style', 'noscript', 'br',
]);

// Map tag → user-facing kind label. Keeps the chip readable
// ("heading · …", "card · …") instead of always saying "element".
function kindForElement(el: HTMLElement): string {
	const tag = el.tagName.toLowerCase();
	if (tag === 'button')                          return 'button';
	if (tag === 'a')                               return 'link';
	if (/^h[1-6]$/.test(tag))                      return 'heading';
	if (tag === 'li')                              return 'item';
	if (tag === 'tr')                              return 'row';
	if (tag === 'td' || tag === 'th')              return 'cell';
	if (tag === 'pre' || tag === 'code')           return 'code';
	if (tag === 'blockquote')                      return 'quote';
	if (tag === 'figure' || tag === 'figcaption') return 'figure';
	if (tag === 'img')                             return 'image';
	if (tag === 'section' || tag === 'article' || tag === 'aside') return 'section';
	if (tag === 'label')                           return 'label';
	if (tag === 'summary' || tag === 'details')   return 'toggle';
	return 'card';
}

// Does this element look styled-as-a-card? Border, shadow, distinct
// background, or generous padding. Avoids false-positives on layout
// wrappers that have no visual presence.
function looksCardLike(el: HTMLElement): boolean {
	const cs = window.getComputedStyle(el);
	// Border
	const bw = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderRightWidth)
	         + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth);
	if (bw >= 1) return true;
	// Box-shadow other than 'none'
	if (cs.boxShadow && cs.boxShadow !== 'none') return true;
	// Distinct (non-transparent, non-inherited-default) background
	const bg = cs.backgroundColor;
	if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
		// Skip pure white/near-white — every block "has" white because
		// of inheritance and tailwind defaults. Pick by other signals.
		if (bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(255, 255, 255, 1)') return true;
	}
	// Generous padding signals an intentional container
	const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
	if (pad >= 12) return true;
	return false;
}

function findMeaningfulAncestor(el: Element | null): HTMLElement | null {
	let cur: Element | null = el;
	while (cur && cur instanceof HTMLElement) {
		// Skip our own chrome and anything explicitly off-limits.
		if (cur.dataset.studioPickerChrome === '1') { cur = cur.parentElement; continue; }
		const tag = cur.tagName.toLowerCase();
		if (SKIP_TAGS.has(tag)) { cur = cur.parentElement; continue; }

		const txt = (cur.innerText || '').trim();
		const r = cur.getBoundingClientRect();

		// (1) Semantic tag with a bit of text.
		if (SEMANTIC_TAGS.has(tag) && txt.length >= 2 && r.height >= 16) {
			return cur;
		}
		// Special-case: <img> has no text — accept based on size alone.
		if (tag === 'img' && r.height >= 32 && r.width >= 32) {
			return cur;
		}
		// Special-case: <p> only if it's a standalone paragraph
		// (substantial). Inline-ish <p>s are walked past.
		if (tag === 'p' && txt.length >= 24 && r.height >= 20) {
			return cur;
		}

		// (2) Visually card-like container with non-trivial text.
		if (txt.length >= 12 && r.height >= 40 && r.width >= 80 && looksCardLike(cur)) {
			return cur;
		}

		cur = cur.parentElement;
	}
	return null;
}

function readPickable(el: HTMLElement) {
	const id = el.dataset.pickId || '';
	const kind = el.dataset.pickKind || 'item';
	let label = el.dataset.pickLabel || '';
	if (!label) {
		label = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
		if (label.length > 80) label = label.slice(0, 77) + '…';
	}
	const affRaw = el.dataset.pickAffordances || '';
	const affordances = affRaw ? affRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
	return { id, kind, label, affordances };
}

// readFreeform — derive a picked-target shape from an un-annotated
// meaningful ancestor. Kind is inferred from the tag (heading, button,
// item, card, …) so the chip stays readable. No preset affordances;
// the agent reads the label and the kind and decides what to do.
function readFreeform(el: HTMLElement) {
	let label = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
	// For <img> use alt or src as the label since innerText is empty.
	if (!label && el.tagName.toLowerCase() === 'img') {
		const img = el as HTMLImageElement;
		label = img.alt || img.title || (img.src ? img.src.split('/').pop() || 'image' : 'image');
	}
	if (!label) label = '(empty)';
	if (label.length > 120) label = label.slice(0, 117) + '…';
	const kind = kindForElement(el);
	const id =
		el.dataset.studioFreeformId ||
		(el.dataset.studioFreeformId =
			'el:' + kind + ':' + Math.random().toString(36).slice(2, 10));
	return { id, kind, label, affordances: undefined };
}

interface HoverState {
	rect: DOMRect;
	label: string;
	kind: string;
	mode: 'annotated' | 'freeform';
}

export function StudioPicker() {
	const [on, setOn] = useState(active);
	const [hover, setHover] = useState<HoverState | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => subscribeStudioPicking(setOn), []);

	useEffect(() => {
		if (!on) {
			setHover(null);
			return;
		}
		// Use the document-level keydown for Esc since the overlay
		// might not have focus.
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				stopStudioPicking();
			}
		};
		document.addEventListener('keydown', onKey, true);
		return () => document.removeEventListener('keydown', onKey, true);
	}, [on]);

	if (!on) return null;

	// Resolve the topmost user-visible element at (x, y), skipping our
	// own chrome. Returns the annotated ancestor when present (so a
	// click on an inner paragraph still pins the card), otherwise the
	// nearest meaningful element. When the click lands inside chrome
	// (sidebar, top bar, chat aside — anything tagged with
	// data-studio-picker-chrome="1"), we bail entirely instead of
	// picking the chrome's inner buttons/items.
	const elementUnderPointer = (
		clientX: number,
		clientY: number,
	): { el: HTMLElement; mode: 'annotated' | 'freeform' } | null => {
		const stack = document.elementsFromPoint(clientX, clientY);
		for (const el of stack) {
			if (!(el instanceof HTMLElement)) continue;
			if (el.dataset.studioPickerChrome === '1') continue;
			// Inside chrome (sidebar nav, top bar, chat panel) → no
			// pick. Deeper layers are obscured by the chrome anyway,
			// so there's nothing meaningful behind it.
			if (el.closest('[data-studio-picker-chrome="1"]')) return null;
			const annotated = findPickable(el);
			if (annotated) return { el: annotated, mode: 'annotated' };
			const free = findMeaningfulAncestor(el);
			if (free) return { el: free, mode: 'freeform' };
			// Stack is frontmost-first; if neither annotated nor
			// meaningful matched, deeper layers are obscured anyway.
			break;
		}
		return null;
	};

	const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
		const hit = elementUnderPointer(e.clientX, e.clientY);
		if (!hit) {
			setHover(null);
			return;
		}
		const meta = hit.mode === 'annotated' ? readPickable(hit.el) : readFreeform(hit.el);
		setHover({
			rect: hit.el.getBoundingClientRect(),
			label: meta.label || '(unlabeled)',
			kind: meta.kind,
			mode: hit.mode,
		});
	};

	const commit = (e: React.MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		const hit = elementUnderPointer(e.clientX, e.clientY);
		if (hit) {
			const target = hit.mode === 'annotated' ? readPickable(hit.el) : readFreeform(hit.el);
			if (target.id) setStudioPickedTarget(target);
		}
		stopStudioPicking();
	};

	const hint = hover
		? `${hover.kind} · ${hover.label}`
		: 'Click anything · Esc to cancel';

	// Ring styling differs by mode so the user can see at a glance
	// whether the pick will carry rich metadata (annotated, solid
	// emerald ring + glow) or only a text snapshot (freeform, dashed
	// sky ring). Both still commit on click.
	const ringClass =
		hover?.mode === 'annotated'
			? 'rounded-lg border-2 border-emerald-400 bg-emerald-200/15 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]'
			: 'rounded-md border-2 border-dashed border-sky-400/80 bg-sky-200/10';

	return (
		<>
			{/* Capture overlay — pointer-events: auto so clicks land on us, not on the page. */}
			<div
				ref={overlayRef}
				data-studio-picker-chrome="1"
				className="fixed inset-0 z-[1000] cursor-crosshair bg-transparent"
				onMouseMove={onMove}
				onClick={commit}
			/>

			{/* Highlight ring around the hovered element — solid for
			    annotated picks, dashed for free-form. */}
			{hover && (
				<div
					data-studio-picker-chrome="1"
					className={`fixed pointer-events-none z-[1001] transition-[left,top,width,height] duration-100 ${ringClass}`}
					style={{
						left:   hover.rect.left   - 4,
						top:    hover.rect.top    - 4,
						width:  hover.rect.width  + 8,
						height: hover.rect.height + 8,
					}}
				/>
			)}

			{/* Floating instruction pill — color-coded by mode. */}
			<div
				data-studio-picker-chrome="1"
				className="fixed top-4 left-1/2 -translate-x-1/2 z-[1002] px-3 py-1.5 rounded-full bg-slate-900/90 backdrop-blur-sm text-white text-[12px] font-medium shadow-lg pointer-events-none flex items-center gap-2 max-w-[80vw]"
			>
				<span
					className={`w-1.5 h-1.5 rounded-full animate-pulse ${
						hover?.mode === 'freeform' ? 'bg-sky-400' : 'bg-emerald-400'
					}`}
				/>
				<span className="truncate">{hint}</span>
			</div>
		</>
	);
}

export default StudioPicker;
