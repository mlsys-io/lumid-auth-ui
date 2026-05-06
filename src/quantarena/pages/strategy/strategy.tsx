import { Suspense, lazy, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BacktestingStrategy } from './backtesting-strategy';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { TooltipProvider } from '../../components/ui/tooltip';
import { Loading } from '../../components/ui/loading';

// Three sub-tabs as of 2026-05-03 — the page covers the full
// backtest engine workflow: edit strategies (Strategies), browse
// past runs (Results), and manage the data those backtests run on
// (Data sources, formerly its own /dashboard/quant/datasource page
// — folded in here since data sources are exclusively backtest
// fuel). Forward Testing moved out earlier today because simulation
// strategies are competition-bound.
//
// Heavy children (Backtesting list, Datasource tabs) lazy-load so
// landing on the default Strategies tab paints fast.
const Backtesting = lazy(() =>
	import('../backtesting/backtesting').then((m) => ({ default: m.Backtesting })),
);
const DatasourceTabs = lazy(() =>
	import('../datasource/datasource').then((m) => ({ default: m.DatasourceTabs })),
);

const TAB_IDS = ['strategies', 'results', 'data-sources'] as const;
type TabId = (typeof TAB_IDS)[number];
const VALID_TABS: ReadonlySet<string> = new Set(TAB_IDS);

// Old `?tab=backtesting` deep-links pre-date the Strategies/Results
// rename; map them onto the new ID.
const TAB_ALIASES: Record<string, TabId> = {
	backtesting: 'strategies',
};

const TAB_LABELS: Record<TabId, string> = {
	'strategies': 'Strategies',
	'results': 'Results',
	'data-sources': 'Data sources',
};

const Backtest = () => {
	const [params, setParams] = useSearchParams();
	const requested = params.get('tab') ?? '';
	const aliased = TAB_ALIASES[requested] ?? requested;
	const active: TabId = (VALID_TABS.has(aliased) ? aliased : 'strategies') as TabId;

	const onTabChange = (next: string) => {
		// Two-way sync: clicking a tab updates ?tab=... so the URL is
		// deep-linkable and refresh-safe. Default tab keeps a clean URL.
		const nextParams = new URLSearchParams(params);
		if (next === 'strategies') nextParams.delete('tab');
		else nextParams.set('tab', next);
		setParams(nextParams, { replace: true });
	};

	const content = useMemo(
		() => ({
			'strategies': <BacktestingStrategy />,
			'results': (
				<Suspense fallback={<Loading />}>
					<Backtesting />
				</Suspense>
			),
			'data-sources': (
				<Suspense fallback={<Loading />}>
					<DatasourceTabs />
				</Suspense>
			),
		}),
		[],
	);

	return (
		<TooltipProvider>
			<div className="flex items-center justify-between mb-4"></div>
			<div>
				<h1 className="text-3xl font-bold">Backtest</h1>
				<p className="text-muted-foreground">
					Build strategies, run backtests, review results, and manage the data they run on.
				</p>
			</div>
			<Tabs value={active} onValueChange={onTabChange} className="mt-4">
				<TabsList>
					{TAB_IDS.map((id) => (
						<TabsTrigger key={id} value={id}>
							{TAB_LABELS[id]}
						</TabsTrigger>
					))}
				</TabsList>
				{TAB_IDS.map((id) => (
					<TabsContent key={id} value={id}>
						{content[id]}
					</TabsContent>
				))}
			</Tabs>
		</TooltipProvider>
	);
};

export default Backtest;
