import React, { useState, useEffect } from 'react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useParams } from 'react-router-dom';
import { Loading } from '../../../components/ui/loading';
import { ArrowLeft, User, Trophy, TrendingUp, Activity, Wallet, Scale, TrendingDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getStrategyDetail } from '../../../api';
import { MyStrategyInfo, RecentTradeInfo } from '../../../api/types';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { formatCurrency, getUserInitials } from '../../../lib/utils';
import { Avatar, AvatarImage, AvatarFallback } from '../../../components/ui/avatar';
import { formatPercentage } from '../../../lib/utils';
import RecentTradesTable from './recent-trades-table';
import { cn } from '../../../lib/utils';
import { useIsMobile } from '../../../components/ui/use-mobile';

const CommonStrategyOverviewMobileContent = ({ baseInfo }: { baseInfo: MyStrategyInfo }) => {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Activity className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Strategy Name</span>
				</div>
				<span className="text-base text-black font-medium shrink-0 truncate max-w-[60%]">{baseInfo.strategy_name}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<User className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">User</span>
				</div>
				<div className="flex items-center gap-1 shrink-0 min-w-0 max-w-[60%] justify-end">
					<Avatar className="h-6 w-6">
						<AvatarImage src={baseInfo.user_avatar} alt={baseInfo.username} />
						<AvatarFallback className="text-xs">{getUserInitials(baseInfo.username)}</AvatarFallback>
					</Avatar>
					<span className="text-base text-black font-medium truncate">{baseInfo.username}</span>
				</div>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Trophy className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Rank</span>
				</div>
				<span className="text-base text-black font-medium shrink-0">{`${baseInfo.rank ? `#${baseInfo.rank}` : '-'}`}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<TrendingUp className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Return Rate</span>
				</div>
				<span
					className={cn(
						baseInfo.return_rate >= 0 ? 'text-green-600' : 'text-red-600',
						'text-base font-medium shrink-0'
					)}
				>
					{baseInfo.return_rate ? formatPercentage(baseInfo.return_rate) : '-'}
				</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Wallet className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Total Equity</span>
				</div>
				<span className="text-base text-black font-medium shrink-0">{formatCurrency(baseInfo.total_equity)}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<Scale className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Sharpe Ratio</span>
				</div>
				<span className="text-base text-black font-medium shrink-0">{baseInfo.sharpe_ratio}</span>
			</div>
			<div className="flex items-center justify-between gap-2 py-2 border-b border-border/50">
				<div className="flex items-center gap-1 min-w-0">
					<TrendingDown className="w-5 h-5 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground font-medium">Max Drawdown</span>
				</div>
				<span className="text-base text-black font-medium shrink-0">{baseInfo.max_drawdown}</span>
			</div>
		</div>
	);
};

const CommonStrategyDetail = () => {
	const navigate = useNavigate();
	const { competitionId, strategyId } = useParams();
	const isMobile = useIsMobile();
	const [loading, setLoading] = useState(false);
	const [baseInfo, setBaseInfo] = useState<MyStrategyInfo | null>(null);
	const [recentTrades, setRecentTrades] = useState<RecentTradeInfo[]>([]);

	useEffect(() => {
		fetchStrategyDetail();
	}, [competitionId, strategyId]);

	const fetchStrategyDetail = async () => {
		try {
			setLoading(true);
			const response = await getStrategyDetail(Number(competitionId), Number(strategyId));
			setRecentTrades(response.data.recent_trades);
			setBaseInfo(response.data.participant_info);
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		<TooltipProvider>
			<header>
				<h1 className="text-2xl font-bold flex items-center cursor-pointer mb-4" onClick={() => navigate(-1)}>
					<ArrowLeft className="w-4 h-4 mr-2" /> Back
				</h1>
				<div className="text-xl font-semibold text-foreground mb-4">Details of Strategy Trades</div>
			</header>
			<div>{loading && <Loading text="Loading strategy detail..." />}</div>
			{baseInfo && (
				<Card>
					<CardHeader>
						<div className="flex items-center gap-6">
							<CardTitle className="flex items-center gap-2 text-base font-semibold">
								Strategy Overview
							</CardTitle>
							{/* {user?.id !== baseInfo.user_id && !baseInfo.is_follower_strategy && (
								<Button
									variant="outline"
									size="sm"
									className="w-20 h-8 border-blue-500  text-blue-500 cursor-pointer"
									onClick={handleFollow}
								>
									<BookCopy className="w-4 h-4" />
									Follow
								</Button>
							)} */}
						</div>
					</CardHeader>
					<CardContent>
						{isMobile ? (
							<CommonStrategyOverviewMobileContent baseInfo={baseInfo} />
						) : (
							<>
								<div className="grid grid-cols-4 gap-4">
									<div className="flex items-start gap-2">
										<Activity className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Strategy Name
											</div>
											<div className="text-base text-black font-medium">{baseInfo.strategy_name}</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<User className="w-5 h-5 text-muted-foreground" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												User
											</div>
											<div className="text-base text-black font-medium flex items-center gap-1">
												<Avatar>
													<AvatarImage src={baseInfo.user_avatar} alt={baseInfo.username} />
													<AvatarFallback>{getUserInitials(baseInfo.username)}</AvatarFallback>
												</Avatar>
												{baseInfo.username}
											</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<Trophy className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1">Rank</div>
											<div className="text-base text-black font-medium">{`${baseInfo.rank ? `#${baseInfo.rank}` : '-'}`}</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<TrendingUp className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Return Rate
											</div>
											<div
												className={cn(
													baseInfo.return_rate >= 0 ? 'text-green-600' : 'text-red-600',
													'text-base font-medium'
												)}
											>
												{baseInfo.return_rate ? `${formatPercentage(baseInfo.return_rate)}` : '-'}
											</div>
										</div>
									</div>
								</div>
								<div className="grid grid-cols-4 gap-4 mt-6">
									<div className="flex items-start gap-2">
										<Wallet className="w-5 h-5 text-muted-foreground" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Total Equity
											</div>
											<div className="text-base text-black font-medium">
												{formatCurrency(baseInfo.total_equity)}
											</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<Scale className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Sharpe Ratio
											</div>
											<div className="text-base text-black font-medium">{baseInfo.sharpe_ratio}</div>
										</div>
									</div>
									<div className="flex items-start gap-2">
										<TrendingDown className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
										<div className="flex flex-col">
											<div className="text-sm text-muted-foreground font-medium mb-1 flex items-center gap-1">
												Max Drawdown
											</div>
											<div className="text-base text-black font-medium">{baseInfo.max_drawdown}</div>
										</div>
									</div>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			)}
			{recentTrades.length > 0 && <RecentTradesTable recentTrades={recentTrades} />}
		</TooltipProvider>
	);
};

export default CommonStrategyDetail;
