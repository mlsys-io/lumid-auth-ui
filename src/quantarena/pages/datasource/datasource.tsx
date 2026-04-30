import React from 'react';
import HistoryDatabase from './history-database';
import Universe from './universe';
import Bundle from './bundle';
import FreqTradeDataset from './freqtrade-dataset';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useState } from 'react';
import { AdminManageLink } from '../../components/admin-manage-link';

const tabList = [
	{
		id: 'history',
		label: 'History Database',
		component: <HistoryDatabase />,
	},
	{
		id: 'universe',
		label: 'Universe',
		component: <Universe />,
	},
	{
		id: 'bundle',
		label: 'Bundle',
		component: <Bundle />,
	},
	{
		id: 'freqtrade',
		label: 'FreqTrade Data',
		component: <FreqTradeDataset />,
	},
];

const Datasource = () => {
	const [activeTab, setActiveTab] = useState('history');

	const handleTabChange = (value: string) => {
		setActiveTab(value);
	};

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
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				<TabsList>
					{tabList.map((tab) => (
						<TabsTrigger key={tab.id} value={tab.id}>
							{tab.label}
						</TabsTrigger>
					))}
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
		</TooltipProvider>
	);
};

export default Datasource;
