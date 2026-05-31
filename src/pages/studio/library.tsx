// /studio/marketplace — install-only surface (browse skills & workflows).
//
// Was previously tabbed (Browse + Knowledge); 2026-05-25 the Knowledge
// tab moved to /studio/inbox?tab=your-ai because the per-agent bank
// browser belongs next to the inbox feed ("what your AI is doing" +
// "what your AI knows" live together as the personal-AI surface).

import MarketplaceBrowse from "@/components/MarketplaceBrowse";

export default function StudioMarketplace() {
	return (
		<div className="space-y-4">
			{/* Page identity (icon + title + subtitle) is rendered by the
			    StudioShell's TopStatusStrip — see PAGE_META there. */}
			<MarketplaceBrowse />
		</div>
	);
}
