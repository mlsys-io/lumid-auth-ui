import React, { useEffect, useState } from 'react';
import { TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { useIsMobile } from '../../../components/ui/use-mobile';
import { useParams } from 'react-router-dom';
import { GetCompetitionDetailResponse, MyStrategyInfo } from '../../../api/types';
import { getCompetitionDetail, ApiError, getMyStrategies } from '../../../api';
import { toast } from 'sonner';
import { ArrowLeft, Calendar, Currency, CircleQuestionMark, Percent, TrendingUp } from 'lucide-react';
import { cn, formatCurrency, formatDate, formatPercentage } from '../../../lib/utils';
import { useNavigate } from 'react-router-dom';
import { getStatusBadgeColor, getStatusBadgeVariant } from '../competition-card';
import { Loading } from '../../../components/ui/loading';
import { Badge } from '../../../components/ui/badge';
import { Tooltip } from '../../../components/ui/tooltip';
import MyStrategyList from './my-strategy-list';
import Leaderboard from './leaderboard';
import ActivityFeed from './activity-feed';
import MyStrategyDetail from './my-strategy-detail';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';

const MarketHoursDialog = ({
	open,
	onOpenChange,
	competitionDetail,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	competitionDetail: GetCompetitionDetailResponse;
}) => (
	<Dialog open={open} onOpenChange={onOpenChange}>
		<DialogContent className="max-w-sm">
			<DialogHeader>
				<DialogTitle>Market Hours</DialogTitle>
			</DialogHeader>
			<TooltipProvider>
				<div className="flex flex-col gap-1">
					{competitionDetail.symbol_trading_hours?.length ? (
						competitionDetail.symbol_trading_hours.map((item, idx) => (
							<div
								key={idx}
								className="text-sm py-1 border-b border-border/50 last:border-0 flex justify-between gap-4"
							>
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="font-medium max-w-[200px] truncate">{item.symbol}</span>
									</TooltipTrigger>
									<TooltipContent>{item.symbol}</TooltipContent>
								</Tooltip>
								<span className="text-muted-foreground">{item.open_time}</span>
							</div>
						))
					) : (
						<p className="text-sm text-muted-foreground">No market hours available.</p>
					)}
				</div>
			</TooltipProvider>
		</DialogContent>
	</Dialog>
);

const getTabList = (status?: 'Upcoming' | 'Ongoing' | 'Completed', onRefreshMyStrategies?: () => void, competitionId?: number) => [
	{
		id: 'leaderboard',
		label: 'Leaderboard',
		component: <Leaderboard status={status} onRefreshMyStrategies={onRefreshMyStrategies} />,
	},
	{
		id: 'activity',
		label: 'Activity',
		component: competitionId ? <ActivityFeed competitionId={competitionId} status={status || ''} /> : null,
	},
	{
		id: 'my-strategies',
		label: 'My Strategies',
		component: <MyStrategyDetail />,
	},
];

const BasicInfoMobileContent = ({
	competitionDetail,
	onOpenMarketHours,
}: {
	competitionDetail: GetCompetitionDetailResponse;
	onOpenMarketHours: () => void;
}) => {
	const [symbolsPopoverOpen, setSymbolsPopoverOpen] = useState(false);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Currency className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Initial Funding</span>
				</div>
				<span className="text-base text-black font-medium shrink-0">
					{formatCurrency(competitionDetail?.initial_funding ?? 0)}
				</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<TrendingUp className="w-5 h-5 text-muted-foreground shrink-0" />
					<div className="flex flex-col">
						<span className="text-sm text-muted-foreground font-medium">Market</span>
						<button
							type="button"
							className="text-xs text-blue-500 hover:underline text-left touch-manipulation"
							onClick={onOpenMarketHours}
						>
							Market Hours
						</button>
					</div>
					{competitionDetail?.symbols?.length > 0 && (
						<Popover open={symbolsPopoverOpen} onOpenChange={setSymbolsPopoverOpen}>
							<PopoverTrigger asChild>
								<button type="button" className="touch-manipulation shrink-0">
									<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
								</button>
							</PopoverTrigger>
							<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
								<p className="text-sm">{competitionDetail?.symbols?.join(', ')}</p>
							</PopoverContent>
						</Popover>
					)}
				</div>
				<span className="text-base text-black font-medium shrink-0 truncate max-w-[60%]">
					{competitionDetail?.market_name}
				</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Percent className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Trading Fees</span>
				</div>
				<span className="text-base text-black font-medium shrink-0">
					{formatPercentage(competitionDetail?.trading_fees ?? 0)}
				</span>
			</div>
		</div>
	);
};

const CompetitionDetail = () => {
	const navigate = useNavigate();
	const { competitionId } = useParams();
	const isMobile = useIsMobile();
	const [competitionDetail, setCompetitionDetail] = useState<GetCompetitionDetailResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [myStrategiesList, setMyStrategiesList] = useState<MyStrategyInfo[]>([]);
	const [namePopoverOpen, setNamePopoverOpen] = useState(false);
	const [marketHoursOpen, setMarketHoursOpen] = useState(false);

	useEffect(() => {
		fetchCompetitionDetail();
		fetchMyStrategies();
	}, [competitionId]);

	const fetchCompetitionDetail = async () => {
		if (!competitionId) return;
		setLoading(true);
		try {
			const response = await getCompetitionDetail(Number(competitionId));
			setCompetitionDetail(response.data);
		} catch (error) {
			const errorMessage = error instanceof ApiError ? error.message : 'Failed to fetch competition detail';
			toast.error(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const fetchMyStrategies = async () => {
		if (!competitionId) return;
		setLoading(true);
		try {
			const response = await getMyStrategies(Number(competitionId));
			setMyStrategiesList(response.data.strategies || []);
		} catch (error) {
			const errorMessage = error instanceof ApiError ? error.message : 'Failed to fetch my strategies';
			toast.error(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	return (
		<TooltipProvider>
			<div>
				{loading && <Loading text="Loading competition detail..." />}
				{competitionDetail && (
					<>
						<header>
							<h1
								className="text-2xl font-bold flex items-center cursor-pointer mb-4"
								onClick={() => navigate(-1)}
							>
								<ArrowLeft className="w-4 h-4 mr-2" /> Back
							</h1>
							<div className="flex items-center justify-between gap-2 min-w-0">
								{isMobile ? (
									<Popover open={namePopoverOpen} onOpenChange={setNamePopoverOpen}>
										<PopoverTrigger asChild>
											<div className="flex-1 min-w-0 line-clamp-2 text-xl font-semibold text-foreground cursor-pointer touch-manipulation">
												{competitionDetail?.name}
											</div>
										</PopoverTrigger>
										<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
											<p className="text-sm font-semibold">{competitionDetail?.name}</p>
										</PopoverContent>
									</Popover>
								) : (
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="flex-1 min-w-0 line-clamp-2 text-xl font-semibold text-foreground cursor-default">
												{competitionDetail?.name}
											</div>
										</TooltipTrigger>
										<TooltipContent side="top" className="max-w-[min(90vw,24rem)]">
											<p className="text-sm">{competitionDetail?.name}</p>
										</TooltipContent>
									</Tooltip>
								)}
								<Badge
									variant={getStatusBadgeVariant(competitionDetail.status)}
									className={cn('shrink-0', getStatusBadgeColor(competitionDetail.status))}
								>
									{competitionDetail.status}
								</Badge>
							</div>
							<div className="flex items-center text-sm text-muted-foreground">
								<Calendar className="w-4 h-4 mr-2" /> {formatDate(competitionDetail?.start_time ?? 0)} ~{' '}
								{formatDate(competitionDetail?.end_time ?? 0)}
							</div>
						</header>
						<div className="border rounded-lg p-4 mt-4">
							<div className="mb-2 text-base font-semibold text-foreground">Basic information:</div>
							{isMobile ? (
								<BasicInfoMobileContent
									competitionDetail={competitionDetail}
									onOpenMarketHours={() => setMarketHoursOpen(true)}
								/>
							) : (
								<div className="grid grid-cols-3 gap-4">
									<div className="flex items-start gap-1">
										<Currency className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1">
												Initial Funding
											</div>
											<div className="text-base text-black font-medium">
												{formatCurrency(competitionDetail?.initial_funding ?? 0)}
											</div>
										</div>
									</div>
									<div className="flex items-start gap-1">
										<TrendingUp className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-2">
												Market
												{!!competitionDetail?.symbol_trading_hours?.length && (
													<button
														type="button"
														className="text-xs text-blue-500 underline font-normal cursor-pointer"
														onClick={() => setMarketHoursOpen(true)}
													>
														Market Hours
													</button>
												)}
											</div>
											<div className="text-base text-black font-medium flex items-center gap-1">
												{competitionDetail?.market_name}
												{competitionDetail?.symbols?.length > 0 && (
													<Tooltip>
														<TooltipTrigger>
															<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
														</TooltipTrigger>
														<TooltipContent className="max-w-sm  whitespace-normal break-all">
															<p>{competitionDetail?.symbols?.join(', ')}</p>
														</TooltipContent>
													</Tooltip>
												)}
											</div>
										</div>
									</div>
									<div className="flex items-start gap-1 ">
										<Percent className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1">
												Trading Fees
											</div>
											<div className="text-base text-black font-medium">
												{formatPercentage(competitionDetail?.trading_fees ?? 0)}
											</div>
										</div>
									</div>
								</div>
							)}
						</div>
						{myStrategiesList.length > 0 && (
							<MyStrategyList list={myStrategiesList} status={competitionDetail.status} />
						)}
						<hr className="my-4" />
						<Tabs defaultValue="leaderboard">
							<TabsList>
								{getTabList(competitionDetail.status, undefined, Number(competitionId))
									.filter((tab) => tab.id !== 'my-strategies' || myStrategiesList.length > 0)
									.map((tab) => (
										<TabsTrigger key={tab.id} value={tab.id} className="text-md font-medium">
											{tab.label}
										</TabsTrigger>
									))}
							</TabsList>

							{getTabList(competitionDetail.status, fetchMyStrategies, Number(competitionId))
								.filter((tab) => tab.id !== 'my-strategies' || myStrategiesList.length > 0)
								.map((tab) => (
									<TabsContent key={tab.id} value={tab.id}>
										{tab.component}
									</TabsContent>
								))}
						</Tabs>
					</>
				)}
			</div>
			{competitionDetail && (
				<MarketHoursDialog
					open={marketHoursOpen}
					onOpenChange={setMarketHoursOpen}
					competitionDetail={competitionDetail}
				/>
			)}
		</TooltipProvider>
	);
};

export default CompetitionDetail;
