import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar';
import { Loading } from '../../../components/ui/loading';
import { getCompetitionRecentTrades, type ActivityTradeInfo } from '../../../api/competition';
import { ArrowUpRight, ArrowDownRight, Activity, TrendingUp } from 'lucide-react';

interface ActivityFeedProps {
	competitionId: number;
	status: string;
}

export default function ActivityFeed({ competitionId, status }: ActivityFeedProps) {
	const [trades, setTrades] = useState<ActivityTradeInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [newTradeIds, setNewTradeIds] = useState<Set<number>>(new Set());
	const prevTradeIds = useRef<Set<number>>(new Set());
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchTrades = useCallback(async (incremental = false) => {
		if (!competitionId) return;
		try {
			const sinceTime = incremental && trades.length > 0 ? trades[0].trade_time : undefined;
			const data = await getCompetitionRecentTrades(competitionId, {
				limit: 50,
				since_time: sinceTime,
			});

			if (incremental && sinceTime) {
				// Merge new trades at the top
				const newOnes = data.trades.filter(t => !prevTradeIds.current.has(t.id));
				if (newOnes.length > 0) {
					setNewTradeIds(new Set(newOnes.map(t => t.id)));
					setTimeout(() => setNewTradeIds(new Set()), 2500);
					setTrades(prev => [...newOnes, ...prev].slice(0, 100));
					newOnes.forEach(t => prevTradeIds.current.add(t.id));
				}
			} else {
				setTrades(data.trades);
				prevTradeIds.current = new Set(data.trades.map(t => t.id));
			}
		} catch {
			// keep existing
		} finally {
			setLoading(false);
		}
	}, [competitionId, trades]);

	useEffect(() => {
		fetchTrades(false);
		if (status === 'Ongoing') {
			intervalRef.current = setInterval(() => {
				if (!document.hidden) fetchTrades(true);
			}, 5000);
		}
		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [competitionId, status]);

	// Summary stats
	const buyCount = trades.filter(t => t.direction === 'Buy').length;
	const sellCount = trades.filter(t => t.direction === 'Sell').length;
	const symbolCounts: Record<string, number> = {};
	trades.forEach(t => { symbolCounts[t.symbol] = (symbolCounts[t.symbol] || 0) + 1; });
	const topSymbol = Object.entries(symbolCounts).sort(([,a], [,b]) => b - a)[0]?.[0] || '-';
	const totalVolume = trades.reduce((sum, t) => sum + t.value, 0);

	// Symbol filter
	const [filterSymbol, setFilterSymbol] = useState<string | null>(null);
	const symbols = [...new Set(trades.map(t => t.symbol))];
	const filtered = filterSymbol ? trades.filter(t => t.symbol === filterSymbol) : trades;

	if (loading) return <Loading text="Loading activity feed..." />;

	return (
		<div className="space-y-4">
			{/* Summary stats bar */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<div className="bg-white rounded-lg border border-gray-100 px-4 py-3">
					<div className="text-[11px] text-gray-500 font-medium">Total Trades</div>
					<div className="text-xl font-bold text-gray-900">{trades.length}</div>
				</div>
				<div className="bg-white rounded-lg border border-gray-100 px-4 py-3">
					<div className="text-[11px] text-gray-500 font-medium">Buy / Sell</div>
					<div className="text-xl font-bold">
						<span className="text-green-600">{buyCount}</span>
						<span className="text-gray-300 mx-1">/</span>
						<span className="text-red-500">{sellCount}</span>
					</div>
				</div>
				<div className="bg-white rounded-lg border border-gray-100 px-4 py-3">
					<div className="text-[11px] text-gray-500 font-medium">Most Active</div>
					<div className="text-xl font-bold text-indigo-600">{topSymbol}</div>
				</div>
				<div className="bg-white rounded-lg border border-gray-100 px-4 py-3">
					<div className="text-[11px] text-gray-500 font-medium">Total Volume</div>
					<div className="text-xl font-bold text-gray-900">${totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}K` : totalVolume.toFixed(0)}</div>
				</div>
			</div>

			{/* Symbol filter chips */}
			{symbols.length > 1 && (
				<div className="flex gap-1.5 flex-wrap">
					<button
						onClick={() => setFilterSymbol(null)}
						className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors cursor-pointer ${
							!filterSymbol ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
						}`}
					>
						All
					</button>
					{symbols.map(sym => (
						<button
							key={sym}
							onClick={() => setFilterSymbol(filterSymbol === sym ? null : sym)}
							className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors cursor-pointer ${
								filterSymbol === sym ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
							}`}
						>
							{sym}
						</button>
					))}
				</div>
			)}

			{/* Activity feed */}
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="flex items-center gap-2 text-base font-semibold">
						<Activity className="w-4 h-4 text-indigo-500" />
						Live Activity
						{status === 'Ongoing' && (
							<span className="flex items-center gap-1 ml-2 text-[10px] text-green-600 font-normal">
								<span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
								Live
							</span>
						)}
					</CardTitle>
				</CardHeader>
				<CardContent>
					{filtered.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<TrendingUp className="w-10 h-10 text-gray-200 mb-3" />
							<p className="text-sm text-gray-400">No trades yet. Activity will appear here as participants trade.</p>
						</div>
					) : (
						<div className="space-y-0 divide-y divide-gray-50">
							{filtered.map(trade => (
								<div
									key={trade.id}
									className={`flex items-center gap-3 py-2.5 px-1 ${
										newTradeIds.has(trade.id) ? 'animate-slide-in-down bg-indigo-50/50 rounded-lg' : ''
									}`}
								>
									{/* Avatar */}
									<Avatar className="h-7 w-7 shrink-0">
										<AvatarImage src={trade.user_avatar} />
										<AvatarFallback className="text-[10px] bg-gradient-to-br from-indigo-400 to-purple-500 text-white">
											{trade.username?.[0]?.toUpperCase() || '?'}
										</AvatarFallback>
									</Avatar>

									{/* Trade description */}
									<div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
										<span className="text-xs font-semibold text-gray-800 truncate max-w-[100px]">{trade.username}</span>
										<Badge
											variant="outline"
											className={`text-[10px] px-1.5 py-0 font-semibold ${
												trade.direction === 'Buy'
													? 'text-green-700 border-green-200 bg-green-50'
													: 'text-red-700 border-red-200 bg-red-50'
											}`}
										>
											{trade.direction === 'Buy' ? (
												<ArrowUpRight className="w-2.5 h-2.5 mr-0.5" />
											) : (
												<ArrowDownRight className="w-2.5 h-2.5 mr-0.5" />
											)}
											{trade.direction}
										</Badge>
										<span className="text-xs text-gray-500">
											{trade.volume} <span className="font-semibold text-gray-700">{trade.symbol}</span>
										</span>
										<span className="text-xs text-gray-400">@</span>
										<span className="text-xs font-medium text-gray-700 tabular-nums">
											${trade.price >= 1 ? trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : trade.price.toFixed(6)}
										</span>
									</div>

									{/* Strategy + time */}
									<div className="shrink-0 text-right">
										<div className="text-[10px] text-gray-400 truncate max-w-[80px]">{trade.strategy_name}</div>
										<div className="text-[10px] text-gray-300 tabular-nums">
											{new Date(trade.trade_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
										</div>
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
