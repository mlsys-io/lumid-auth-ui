import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import {
	Sheet,
	SheetContent,
	SheetTrigger,
	SheetTitle,
} from '@/quantarena/components/ui/sheet';
import { Button } from '@/quantarena/components/ui/button';
import { TooltipProvider } from '@/quantarena/components/ui/tooltip';
import { LqaSidebar } from '@/quantarena/pages/lqa-sidebar';

// LQA shell — single sidebar on the left, routed Outlet on the right.
//
// History:
//   2026-04-30: this file was a thin horizontal tab strip
//   (Competition / Strategy / Backtesting / Ranking / Templates /
//   Data sources). Then on 2026-05-03 we collapsed that to 3 visible
//   tabs and introduced an inner CompetitionShell (its own sidebar)
//   for the Competition section. Two nav surfaces stacked = one too
//   many; user feedback called it three layers. This rewrite kills
//   the horizontal strip entirely and folds its remaining items into
//   one sidebar that hosts everything quant-related (Browse + My
//   strategies + dynamic My contests + Strategy + Data sources +
//   Pathways).
//
// URLs are stable: every quant route the codebase emits today still
// resolves; only the rendering shell consolidates.
export default function QuantLayout() {
	const [drawerOpen, setDrawerOpen] = useState(false);

	return (
		<TooltipProvider>
			<div className="-mx-4 md:-mx-8 -mt-6 min-h-[calc(100vh-4rem)]">
				<div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
					<div className="hidden lg:block border-r border-slate-200 bg-slate-50/50 px-3 sticky top-0 self-start max-h-screen overflow-y-auto">
						<LqaSidebar />
					</div>
					<div className="min-w-0 px-4 md:px-8 py-5">
						<div className="flex items-center gap-2 mb-3 lg:hidden">
							<Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
								<SheetTrigger asChild>
									<Button variant="ghost" size="icon">
										<Menu className="w-5 h-5" />
									</Button>
								</SheetTrigger>
								<SheetContent side="left" className="w-72 px-3 pt-10">
									<SheetTitle className="sr-only">Lumid Market navigation</SheetTitle>
									<LqaSidebar onNavigate={() => setDrawerOpen(false)} />
								</SheetContent>
							</Sheet>
						</div>
						<Outlet />
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}
