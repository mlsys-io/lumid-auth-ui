import HistoryDatabase from './history-database';
import Universe from './universe';
import Bundle from './bundle';
import FreqTradeDataset from './freqtrade-dataset';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useState } from 'react';
import { AdminManageLink } from '../../components/admin-manage-link';

// 2026-05-03 split: Datasource is a Strategy sub-tab now (data
// sources are backtest fuel — they don't deserve their own LQA
// sidebar entry). DatasourceTabs is the inner 4-tab strip
// (History / Universe / Bundle / FreqTrade Data) with no page
// header — embedded inside Strategy. Default export Datasource
// wraps it with h1 + AdminManageLink for the legacy
// /dashboard/quant/datasource standalone route, which redirects
// to ?tab=data-sources but stays renderable for direct visitors.
export function DatasourceTabs() {
	const [activeTab, setActiveTab] = useState('history');
	return (
		<Tabs value={activeTab} onValueChange={setActiveTab}>
			<TabsList>
				<TabsTrigger value="history">History Database</TabsTrigger>
				<TabsTrigger value="universe">Universe</TabsTrigger>
				<TabsTrigger value="bundle">Bundle</TabsTrigger>
				<TabsTrigger value="freqtrade">FreqTrade Data</TabsTrigger>
			</TabsList>
			<TabsContent value="history">
				<HistoryDatabase />
			</TabsContent>
			<TabsContent value="universe">
				<Universe />
			</TabsContent>
			<TabsContent value="bundle">
				<Bundle />
			</TabsContent>
			<TabsContent value="freqtrade">
				<FreqTradeDataset />
			</TabsContent>
		</Tabs>
	);
}

const Datasource = () => {
	return (
		<TooltipProvider>
			<div className="flex items-center justify-between mb-4">
				<div>
					<h1 className="text-3xl font-bold">Datasource</h1>
					<p className="text-muted-foreground">
						Centralized data bundle and universe management for backtesting
					</p>
				</div>
				<AdminManageLink to="/dashboard/admin/markets" />
			</div>
			<DatasourceTabs />
		</TooltipProvider>
	);
};

export default Datasource;
