import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '../../components/ui/sheet';
import { Button } from '../../components/ui/button';
import { TooltipProvider } from '../../components/ui/tooltip';
import { CompetitionSidebar } from './competition-sidebar';

// Two-column layout for /dashboard/quant/competition/* — sidebar on
// the left, route Outlet on the right. Sidebar contains Browse
// (Lobby + My strategies), a derived "My contests" list, and the
// Pathways reference link. On narrow viewports the sidebar collapses
// to a Sheet drawer triggered by a Menu button.
//
// Replaces the prior 2-tab strip (Lobby + Pathways). Forward Testing
// (the cross-competition simulation roster previously inside Strategy)
// now lives at /my under this shell.
export default function CompetitionShell() {
	const [drawerOpen, setDrawerOpen] = useState(false);

	return (
		<TooltipProvider>
			<div className="-mt-2 flex flex-col">
				<div className="flex items-center gap-3 mb-3 lg:mb-1">
					<Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
						<SheetTrigger asChild>
							<Button variant="ghost" size="icon" className="lg:hidden">
								<Menu className="w-5 h-5" />
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-72 px-3 pt-10">
							<SheetTitle className="sr-only">Competition navigation</SheetTitle>
							<CompetitionSidebar onNavigate={() => setDrawerOpen(false)} />
						</SheetContent>
					</Sheet>
					<div>
						<h1 className="text-3xl font-bold">Competition</h1>
						<p className="text-muted-foreground">
							Browse competitions, manage your live strategies, and pick a way to trade.
						</p>
					</div>
				</div>

				<div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
					<div className="hidden lg:block border-r border-slate-200">
						<CompetitionSidebar />
					</div>
					<div className="min-w-0">
						<Outlet />
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}
