import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/quantarena/components/ui/tooltip';

// Pass-through wrapper for /dashboard/quant/*. The LQA navigation
// (Browse / My strategies / Strategy / Data sources / Pathways +
// dynamic My contests) lives in the global app-layout sidebar;
// when the user is on /dashboard/quant/* that sidebar's Quant
// section expands inline. There is no second sidebar here — one
// left rail across the whole app.
//
// TooltipProvider stays so the deeper LQA pages (which use Radix
// tooltips on action icons) don't have to wrap themselves.
export default function QuantLayout() {
	return (
		<TooltipProvider>
			<Outlet />
		</TooltipProvider>
	);
}
