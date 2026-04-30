import React from 'react';
import CompetitionLobby from './competition-lobby';
import Pathways from './pathways';
import { TooltipProvider } from '../../components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';

// "API Doc" tab retired 2026-04-30 in favour of "Pathways" — a
// side-by-side of the raw REST surface and the higher-level Lumid
// app + /lumid MCP route. Full TRADING_API.md still lives at
// /docs/TRADING_API.md and is linked from the Pathways card.
const tabList = [
	{ id: 'competition-lobby', label: 'Competition Lobby', component: <CompetitionLobby /> },
	{ id: 'pathways', label: 'Pathways', component: <Pathways /> },
];

const Competition = () => {
	return (
		<TooltipProvider>
			<div className="flex items-center justify-between mb-4">
				<div>
					<h1 className="text-3xl font-bold">Competition</h1>
					<p className="text-muted-foreground">
						Join a competition, manage your strategies, and pick a way to trade — direct API or the Lumid app.
					</p>
				</div>
			</div>
			<Tabs defaultValue="competition-lobby">
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

export default Competition;
