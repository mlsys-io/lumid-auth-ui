import { useState } from 'react';
import CustomTag from './custom-tag';
import SystemTag from './system-tag';
import { TooltipProvider } from '../../components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { AdminManageLink } from '../../components/admin-manage-link';

const tabList = [
	{
		id: 'system',
		label: 'System Template',
		component: <SystemTag />,
	},
	{
		id: 'custom',
		label: 'Custom Template',
		component: <CustomTag />,
	},
];
const Template = () => {
	const [activeTab, setActiveTab] = useState('system');

	const handleTabChange = (value: string) => {
		setActiveTab(value);
	};

	return (
		<TooltipProvider>
			<div className="flex items-center justify-between mb-4">
				<div>
					<h1 className="text-3xl font-bold">Backtesting Template</h1>
					<p className="text-muted-foreground">Manage parameter templates for backtest tasks</p>
				</div>
				<AdminManageLink to="/dashboard/admin/templates" />
			</div>
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				<TabsList>
					{tabList.map((tab) => (
						<TabsTrigger key={tab.id} value={tab.id}>
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="system">
					<SystemTag />
				</TabsContent>
				<TabsContent value="custom">
					<CustomTag />
				</TabsContent>
			</Tabs>
		</TooltipProvider>
	);
};

export default Template;
