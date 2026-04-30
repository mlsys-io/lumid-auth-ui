import React from 'react';
import { BacktestingStrategy } from './backtesting-strategy';
import SimulationStrategy from './simulation-strategy';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { TooltipProvider } from '../../components/ui/tooltip';

const tabList = [
	{
		id: 'backtesting',
		label: 'Backtesting',
		component: <BacktestingStrategy />,
	},
	{
		id: 'forward-testing',
		label: 'Forward Testing',
		component: <SimulationStrategy />,
	},
];

const Strategy = () => {
	return (
		<TooltipProvider>
			<div className="flex items-center justify-between mb-4"></div>
			<div>
				<h1 className="text-3xl font-bold">Strategy</h1>
				<p className="text-muted-foreground">Manage your trading strategies and run backtests</p>
			</div>
			<Tabs defaultValue="backtesting" className="mt-4">
				<TabsList>
					{tabList.map((tab) => (
						<TabsTrigger key={tab.id} value={tab.id}>
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>
				{tabList.map((tab) => (
					<TabsContent key={tab.id} value={tab.id}>
						{tab.component}
					</TabsContent>
				))}
			</Tabs>
		</TooltipProvider>
	);
};

export default Strategy;
