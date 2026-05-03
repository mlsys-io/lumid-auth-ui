import { Suspense, lazy, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BacktestingStrategy } from './backtesting-strategy';
import SimulationStrategy from './simulation-strategy';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { TooltipProvider } from '../../components/ui/tooltip';
import { Loading } from '../../components/ui/loading';

// Three sub-tabs as of 2026-05-03 — "Results" absorbs the formerly
// standalone /dashboard/quant/backtesting page. The legacy route
// redirects to /dashboard/quant/strategy?tab=results so the third
// tab opens by default for old deep links. The Backtesting view is
// lazy-loaded so its ~600 LOC don't block first paint of the
// Backtesting/Forward sub-tabs that most users land on.
const Backtesting = lazy(() =>
	import('../backtesting/backtesting').then((m) => ({ default: m.Backtesting })),
);

const TAB_IDS = ['backtesting', 'forward-testing', 'results'] as const;
type TabId = (typeof TAB_IDS)[number];
const VALID_TABS: ReadonlySet<string> = new Set(TAB_IDS);

const TAB_LABELS: Record<TabId, string> = {
	'backtesting': 'Backtesting',
	'forward-testing': 'Forward Testing',
	'results': 'Results',
};

const Strategy = () => {
	const [params, setParams] = useSearchParams();
	const requested = params.get('tab') ?? '';
	const active: TabId = (VALID_TABS.has(requested) ? requested : 'backtesting') as TabId;

	const onTabChange = (next: string) => {
		// Two-way sync: clicking a tab updates ?tab=... so the URL is
		// deep-linkable and refresh-safe. Default tab keeps a clean URL.
		const nextParams = new URLSearchParams(params);
		if (next === 'backtesting') nextParams.delete('tab');
		else nextParams.set('tab', next);
		setParams(nextParams, { replace: true });
	};

	const content = useMemo(
		() => ({
			'backtesting': <BacktestingStrategy />,
			'forward-testing': <SimulationStrategy />,
			'results': (
				<Suspense fallback={<Loading />}>
					<Backtesting />
				</Suspense>
			),
		}),
		[],
	);

	return (
		<TooltipProvider>
			<div className="flex items-center justify-between mb-4"></div>
			<div>
				<h1 className="text-3xl font-bold">Strategy</h1>
				<p className="text-muted-foreground">Manage your trading strategies and run backtests</p>
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

export default Strategy;
