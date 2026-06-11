// Stagger animation helper — pairs with the `animate-in fade-in
// slide-in-from-bottom-2` class convention (from the pre-migration AppCard)
// to make grids feel alive on load. Apply STAGGER_CLASS + style={staggerDelay(i)}.

export const STAGGER_CLASS = "animate-in fade-in slide-in-from-bottom-2";

// Cap the delay so long lists don't drag; 40ms per item up to ~480ms.
export function staggerDelay(index: number): React.CSSProperties {
	return { animationDelay: `${Math.min(index, 12) * 40}ms`, animationFillMode: "backwards" };
}
