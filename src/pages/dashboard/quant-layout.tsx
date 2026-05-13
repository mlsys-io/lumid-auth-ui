import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/quantarena/components/ui/tooltip';

// Pass-through wrapper for /dashboard/quant/*. The LQA navigation
// (Competitions + Backtest, plus a dynamic My-contests roster when
// the user has joined any) lives in the global app-layout sidebar
// and is shown at every depth. There is no second sidebar here —
// one left rail across the whole app.
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
