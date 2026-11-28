// /explore — the public Marketplace. The same browse as /studio/library, under
// a page heading and inside the Studio content column, so the cards no longer
// touch the viewport edges (2026-11-28 sweep, #13).

import MarketplaceBrowse from "@/components/MarketplaceBrowse";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";

export default function ExploreMarketplace() {
	return (
		<PageContainer className="mx-auto">
			<PageHeader
				title="Marketplace"
				subtitle="Apps, workflows, memory and datasets others have published. Open Details to see what an app runs and spends before you add it."
			/>
			<MarketplaceBrowse />
		</PageContainer>
	);
}
