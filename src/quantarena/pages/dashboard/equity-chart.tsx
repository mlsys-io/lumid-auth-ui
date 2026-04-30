import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { TrendingUp, ChartSpline, X, CalendarDays, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getEquityChart, ApiError } from '../../api';
import type { EquityChartSeries } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Loading } from '../../components/ui/loading';
import { CHART_COLORS } from '../../lib/enum';
import {
	formatTimestampToMMDD,
	formatTimestampToMMSS,
	formatCurrency,
	formatTimestampToTwoLines,
	roundToHour,
	roundToDay,
} from '../../lib/utils';
import type { ChartDataPoint, TimeGranularity } from '../../components/custom-chart-tooltip';
import CustomTooltip from '../../components/custom-chart-tooltip';

interface EquityChartProps {
	competitionId: number | null;
	from?: 'dashboard' | 'competition';
	status?: 'Upcoming' | 'Ongoing' | 'Completed';
	compact?: boolean; // Compact mode: no polling, no controls, smaller height
	initialData?: EquityChartSeries[]; // Pre-fetched data from overview endpoint -- skips initial fetch
}
// Chart data point format for recharts

// Series info: seriesKey is unique (participant_id + strategy_name), displayName is for legend/tooltip only
interface SeriesInfo {
	seriesKey: string;
	displayName: string;
	color: string;
}

const MAX_VISIBLE_SERIES = 10;

const EquityChart = ({ competitionId, from, status, compact = false, initialData }: EquityChartProps) => {
	const { user } = useAuth();
	const [seriesData, setSeriesData] = useState<EquityChartSeries[]>(initialData ?? []);
	const [initialLoading, setInitialLoading] = useState(!initialData);
	const [timeGranularity, setTimeGranularity] = useState<TimeGranularity>('min');
	// Legend click: hidden series keys (clicking legend toggles line visibility, ECharts-style)
	const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<Set<string>>(new Set());
	const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isInitialMount = useRef(true);
	// Track the competition+user combination for which we've already initialized visibility
	const initSignatureRef = useRef<string | null>(null);
	// Date range filter — only used for Ongoing competitions
	const [startDate, setStartDate] = useState<Date | null>(null);
	const [endDate, setEndDate] = useState<Date | null>(null);
	const [datePickerOpen, setDatePickerOpen] = useState(false);
	const now = new Date();
	const minSelectableDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const toggleSeriesVisibility = useCallback((dataKey: string) => {
		setHiddenSeriesKeys((prev) => {
			const next = new Set(prev);
			if (next.has(dataKey)) next.delete(dataKey);
			else next.add(dataKey);
			return next;
		});
	}, []);

	const fetchEquityChart = useCallback(
		async (isPolling = false) => {
			if (!competitionId) {
				setSeriesData([]);
				return;
			}

			// 只在首次加载/手动刷新时显示 loading，轮询时不显示
			if (!isPolling) {
				setInitialLoading(true);
			}

			try {
				let timeParams:
					| {
							start_time: number | undefined;
							end_time: number | undefined;
					  }
					| undefined;
				if (!startDate && !endDate) {
					// No date range selected: default to last 7 days for better trend visibility
					const nowSeconds = Math.floor(Date.now() / 1000);
					timeParams = {
						start_time: nowSeconds - 7 * 24 * 60 * 60,
						end_time: nowSeconds,
					};
				} else {
					// 选了任意一端，则按用户选择来
					timeParams = {
						start_time: startDate
							? Math.floor(
									new Date(
										startDate.getFullYear(),
										startDate.getMonth(),
										startDate.getDate(),
										0,
										0,
										0
									).getTime() / 1000
								)
							: undefined,
						end_time: endDate
							? Math.floor(
									new Date(
										endDate.getFullYear(),
										endDate.getMonth(),
										endDate.getDate(),
										23,
										59,
										59
									).getTime() / 1000
								)
							: undefined,
					};
				}
				const response = await getEquityChart(competitionId, timeParams);
				const newCharts = response.charts || [];

				setSeriesData((prevData) => {
					// Quick structural check to avoid expensive deep comparison.
					// Compare series count and total data point count as a fast proxy.
					if (prevData.length === newCharts.length) {
						let prevTotal = 0;
						let newTotal = 0;
						for (let i = 0; i < prevData.length; i++) {
							prevTotal += prevData[i].data_points.length;
							newTotal += newCharts[i].data_points.length;
						}
						if (prevTotal === newTotal && prevTotal > 0) {
							// Check the last data point of the first series as a change sentinel
							const prevLast = prevData[0].data_points[prevData[0].data_points.length - 1];
							const newLast = newCharts[0].data_points[newCharts[0].data_points.length - 1];
							if (
								prevLast &&
								newLast &&
								prevLast.timestamp === newLast.timestamp &&
								prevLast.total_equity === newLast.total_equity
							) {
								return prevData;
							}
						}
					}
					return newCharts;
				});
			} catch (error) {
				console.error('Failed to fetch equity chart:', error);
				if (error instanceof ApiError) {
					console.error('API Error:', error.message);
				}
				if (!isPolling) {
					setSeriesData([]);
				}
			} finally {
				if (!isPolling) {
					setInitialLoading(false);
				}
			}
		},
		[competitionId, startDate, endDate]
	);

	useEffect(() => {
		// Initial fetch (skip if pre-fetched data provided)
		if (competitionId && !initialData) {
			isInitialMount.current = true;
			fetchEquityChart(false);
		}

		// Poll only in non-compact mode for ongoing competitions without custom date range
		if (!compact && status === 'Ongoing' && competitionId && !startDate && !endDate) {
			// Clear any existing interval
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
			intervalRef.current = setInterval(() => {
				isInitialMount.current = false;
				fetchEquityChart(true);
			}, 120000);
		} else {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		}
		// Cleanup on unmount or when dependencies change
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [competitionId, status, startDate, endDate, fetchEquityChart]);

	// Initialize hidden series: keep at most MAX_VISIBLE_SERIES visible, always including the user's own strategies
	useEffect(() => {
		if (seriesData.length === 0 || competitionId === null) return;

		const signature = `${competitionId}-${user?.id ?? 'anonymous'}`;
		if (initSignatureRef.current === signature) return;
		initSignatureRef.current = signature;

		if (seriesData.length <= MAX_VISIBLE_SERIES) {
			setHiddenSeriesKeys(new Set());
			return;
		}

		const getKey = (s: EquityChartSeries) => `${s.participant_id}-${s.strategy_name}`;

		// Own strategies always stay visible
		const ownKeys = new Set(seriesData.filter((s) => user && s.user_id === user.id).map(getKey));

		const visibleKeys = new Set<string>(ownKeys);
		for (const s of seriesData) {
			if (visibleKeys.size >= MAX_VISIBLE_SERIES) break;
			visibleKeys.add(getKey(s));
		}

		setHiddenSeriesKeys(new Set(seriesData.map(getKey).filter((k) => !visibleKeys.has(k))));
	}, [seriesData, user, competitionId]);

	// Pre-compute whether the data spans multiple days (used by min-granularity label formatting).
	// Computed once per seriesData change instead of per-data-point.
	const spansMultipleDays = useMemo(() => {
		if (seriesData.length === 0) return false;
		let minTs = Infinity;
		let maxTs = -Infinity;
		for (const s of seriesData) {
			for (const p of s.data_points) {
				if (p.timestamp < minTs) minTs = p.timestamp;
				if (p.timestamp > maxTs) maxTs = p.timestamp;
			}
		}
		if (minTs === Infinity) return false;
		const firstDate = new Date(minTs * 1000);
		const lastDate = new Date(maxTs * 1000);
		return firstDate.getDate() !== lastDate.getDate();
	}, [seriesData]);

	// Helper function to format timestamp based on granularity.
	// No longer reads seriesData — uses pre-computed spansMultipleDays.
	const formatTimestampByGranularity = useCallback(
		(timestamp: number, granularity: TimeGranularity): string => {
			const date = new Date(timestamp * 1000);
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			const hours = String(date.getHours()).padStart(2, '0');

			if (granularity === 'day') {
				return `${month}/${day}`;
			} else if (granularity === 'hour') {
				return `${month}/${day} ${hours}:00`;
			} else {
				if (status === 'Ongoing') {
					return spansMultipleDays
						? formatTimestampToTwoLines(timestamp)
						: formatTimestampToMMSS(timestamp);
				}
				return formatTimestampToMMDD(timestamp);
			}
		},
		[status, spansMultipleDays]
	);

	// Transform backend data to recharts format
	const { chartData, series } = useMemo(() => {
		if (seriesData.length === 0) {
			return { chartData: [], series: [] };
		}

		// Unique key per series to avoid collision when same user has multiple strategies with same name
		const getSeriesKey = (s: EquityChartSeries) => `${s.participant_id}-${s.strategy_name}`;

		// Determine the rounding function for the current granularity
		const roundFn =
			timeGranularity === 'hour'
				? roundToHour
				: timeGranularity === 'day'
					? roundToDay
					: (ts: number) => ts; // min: no rounding

		// Single-pass aggregation: collect all data points and aggregate in one loop
		const aggregatedData = new Map<number, Map<string, { value: number; timestamp: number }>>();

		for (const s of seriesData) {
			const seriesKey = getSeriesKey(s);
			for (const point of s.data_points) {
				const bucketTs = roundFn(point.timestamp);
				let bucket = aggregatedData.get(bucketTs);
				if (!bucket) {
					bucket = new Map();
					aggregatedData.set(bucketTs, bucket);
				}
				const existing = bucket.get(seriesKey);
				if (existing === undefined || point.timestamp > existing.timestamp) {
					bucket.set(seriesKey, {
						value: point.total_equity,
						timestamp: point.timestamp,
					});
				}
			}
		}

		// Sort timestamps
		const sortedTimestamps = Array.from(aggregatedData.keys()).sort((a, b) => a - b);

		// Create chart data points
		const chartDataPoints: ChartDataPoint[] = sortedTimestamps.map((timestamp) => {
			const dateLabel = formatTimestampByGranularity(timestamp, timeGranularity);
			const dataPoint: ChartDataPoint = {
				date: dateLabel,
				timestamp: timestamp,
			};

			// Add equity values for each strategy (keyed by seriesKey)
			const timestampData = aggregatedData.get(timestamp)!;
			timestampData.forEach((data, seriesKey) => {
				dataPoint[seriesKey] = data.value;
			});

			return dataPoint;
		});

		// Create series info: seriesKey for data keys, displayName (strategy_name only) for legend/tooltip
		// Limit to top 5 series for readability
		const sourceSeries = seriesData.slice(0, 5);
		const seriesInfo: SeriesInfo[] = sourceSeries.map((s, index) => ({
			seriesKey: getSeriesKey(s),
			displayName: s.strategy_name,
			color: CHART_COLORS[index % CHART_COLORS.length],
		}));

		return { chartData: chartDataPoints, series: seriesInfo };
	}, [seriesData, timeGranularity, formatTimestampByGranularity, compact]);
	// Calculate Y-axis domain and ticks based on visible data only (hidden series excluded)
	const yAxisConfig = useMemo(() => {
		if (chartData.length === 0) {
			return { domain: [0, 180], ticks: [0, 45, 90, 135, 180] };
		}
		// Find min and max only from visible (non-hidden) series
		let minValue = Infinity;
		let maxValue = -Infinity;
		chartData.forEach((point) => {
			series.forEach((s) => {
				if (hiddenSeriesKeys.has(s.seriesKey)) return;
				const value = point[s.seriesKey];
				if (typeof value === 'number') {
					if (value < minValue) minValue = value;
					if (value > maxValue) maxValue = value;
				}
			});
		});

		// If no visible data or invalid, fallback to default
		if (minValue === Infinity || maxValue === -Infinity || minValue === 0 || maxValue === 0) {
			return { domain: [0, 180], ticks: [0, 45, 90, 135, 180] };
		}

		// Calculate the range
		const range = maxValue - minValue || 20; // if range is 0, set to 20

		// Calculate tick interval based on range (aim for 4-5 ticks)
		// Round to a nice number based on the magnitude
		const magnitude = Math.pow(10, Math.floor(Math.log10(range)));
		const normalizedRange = range / magnitude;
		let tickInterval = magnitude;

		if (normalizedRange <= 2) {
			tickInterval = magnitude * 0.5;
		} else if (normalizedRange <= 5) {
			tickInterval = magnitude;
		} else {
			tickInterval = magnitude * 2;
		}

		// Round min down and subtract one tick interval for buffer
		const chartMin = Math.floor(minValue / tickInterval) * tickInterval - tickInterval;
		// Ensure min is not negative if all values are positive
		const finalMin = chartMin < 0 && minValue >= 0 ? minValue : chartMin;

		// Round max up and add one tick interval for buffer
		const roundedMax = Math.ceil(maxValue / tickInterval) * tickInterval;
		const chartMax = roundedMax + tickInterval;

		// Generate ticks from min to max
		const tickCount = Math.ceil((chartMax - finalMin) / tickInterval);
		const ticks: number[] = [];
		for (let i = 0; i <= tickCount; i++) {
			const tick = finalMin + i * tickInterval;
			if (tick <= chartMax) {
				ticks.push(tick);
			}
		}

		return { domain: [finalMin, chartMax], ticks };
	}, [chartData, series, hiddenSeriesKeys]);

	return (
		<Card className="h-full flex flex-col">
			{!compact && (
			<CardHeader className="flex flex-col gap-2 pb-1 pt-3">
				<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-3 w-full">
					{from === 'competition' ? (
						<div className="flex-1 min-w-0">
							<CardTitle className="text-sm font-semibold text-foreground">
								Equity Curve
							</CardTitle>
							<CardDescription className="text-xs text-muted-foreground">
								Top 5 Strategies
							</CardDescription>
						</div>
					) : (
						<CardTitle className="flex items-center gap-2 text-sm font-semibold">
							<TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
							Capital Curve
						</CardTitle>
					)}
					<div className="flex items-center gap-2 flex-wrap">
						{status === 'Ongoing' && (
							<div className="flex items-center gap-2">
								<Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
									<PopoverTrigger asChild>
										<button
											type="button"
											className="h-7 flex items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs hover:bg-accent transition-colors cursor-pointer"
										>
											<CalendarDays className="w-3 h-3 text-muted-foreground" />
											{startDate || endDate
												? `${startDate ? `${String(startDate.getMonth() + 1).padStart(2, '0')}/${String(startDate.getDate()).padStart(2, '0')}` : '...'} — ${endDate ? `${String(endDate.getMonth() + 1).padStart(2, '0')}/${String(endDate.getDate()).padStart(2, '0')}` : '...'}`
												: 'Date range'}
										</button>
									</PopoverTrigger>
									<PopoverContent className="w-auto p-0" align="end">
										<DatePicker
											selected={startDate}
											onChange={(dates) => {
												const [start, end] = dates as [Date | null, Date | null];
												setStartDate(start);
												setEndDate(end);
												if (start && end) {
													setDatePickerOpen(false);
												}
											}}
											startDate={startDate ?? undefined}
											endDate={endDate ?? undefined}
											selectsRange
											inline
											minDate={minSelectableDate}
											maxDate={now}
											calendarClassName="react-datepicker--compact"
										/>
									</PopoverContent>
								</Popover>
								{(startDate || endDate) && (
									<>
										<button
											type="button"
											onClick={() => {
												fetchEquityChart(false);
											}}
											className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
										>
											<RotateCcw className="w-3 h-3" />
											Refresh
										</button>
										<button
											type="button"
											onClick={() => {
												setStartDate(null);
												setEndDate(null);
											}}
											className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
										>
											<X className="w-3 h-3" />
											Clear
										</button>
									</>
								)}
							</div>
						)}
						<Tabs
							value={timeGranularity}
							onValueChange={(value) => setTimeGranularity(value as TimeGranularity)}
							className="w-full w-auto"
						>
							<TabsList className="h-8 w-full w-auto">
								<TabsTrigger value="min" className="text-xs px-2 py-1 flex-1 flex-initial">
									Min
								</TabsTrigger>
								<TabsTrigger value="hour" className="text-xs px-2 py-1 flex-1 flex-initial">
									Hour
								</TabsTrigger>
								<TabsTrigger value="day" className="text-xs px-2 py-1 flex-1 flex-initial">
									Day
								</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
				</div>
			</CardHeader>
			)}

			<CardContent className={compact ? 'p-2' : ''}>
				{initialLoading ? (
					<Loading text="Loading chart..." className="py-8" />
				) : chartData.length === 0 || series.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-12 px-4">
						<div className="relative mb-6">
							{/* 背景光晕效果 */}
							<div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 to-indigo-500/20 rounded-full blur-2xl"></div>
							{/* 图标容器 */}
							<div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 flex items-center justify-center border border-blue-200/50 dark:border-blue-800/50">
								<ChartSpline className="w-10 h-10 text-blue-500 dark:text-blue-400" strokeWidth={1.5} />
							</div>
						</div>
						<h3 className="text-lg font-semibold text-foreground mb-2">No Capital Chart Data Yet</h3>
						<p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
							The competition hasn't started or no participants have submitted strategies yet. Check back
							soon to see the equity curve!
						</p>
					</div>
				) : (
					<div className="w-full">
						<ResponsiveContainer width="100%" height={compact ? 140 : 260}>
							<LineChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
								<XAxis
									dataKey="date"
									stroke="#6b7280"
									style={{ fontSize: '12px' }}
									angle={0}
									tick={(props) => {
										const { x, y, payload } = props;
										const text = payload.value as string;
										if (text && text.includes('\n')) {
											const [line1, line2] = text.split('\n');
											return (
												<g transform={`translate(${x},${y})`}>
													<text
														x={0}
														y={0}
														dy={8}
														textAnchor="middle"
														fill="#6b7280"
														fontSize="12"
													>
														{line1}
													</text>
													<text
														x={0}
														y={0}
														dy={20}
														textAnchor="middle"
														fill="#6b7280"
														fontSize="12"
													>
														{line2}
													</text>
												</g>
											);
										}
										return (
											<text x={x} y={y} dy={16} textAnchor="middle" fill="#6b7280" fontSize="12">
												{text}
											</text>
										);
									}}
								/>
								<YAxis
									stroke="#6b7280"
									style={{ fontSize: '12px' }}
									tick={{ fill: '#6b7280' }}
									tickFormatter={(value) => {
										if (value >= 1000000) {
											return `${(value / 1000000).toFixed(1)}M`;
										}
										if (value >= 1000) {
											return `${(value / 1000).toFixed(1)}k`;
										}
										if (value > 0) {
											return `${formatCurrency(value)}`;
										}
										return value;
									}}
									domain={yAxisConfig.domain}
									ticks={yAxisConfig.ticks}
								/>
								{!compact && (
									<Tooltip
										content={(props) => (
											<CustomTooltip {...props} timeGranularity={timeGranularity} status={status} />
										)}
									/>
								)}
								{!compact && <Legend
									iconType="line"
									content={({ payload }) => (
										<ul className="flex flex-wrap justify-center gap-4 gap-y-1 list-none m-0 mt-2 p-0">
											{payload?.map((entry) => {
												const isHidden = hiddenSeriesKeys.has(entry.dataKey as string);
												return (
													<li
														key={entry.value}
														onClick={() => toggleSeriesVisibility(entry.dataKey as string)}
														className="inline-flex items-center gap-1.5 cursor-pointer select-none transition-opacity hover:opacity-80"
														style={{
															opacity: isHidden ? 0.45 : 1,
															textDecoration: isHidden ? 'line-through' : 'none',
														}}
													>
														<span
															className="inline-block w-4 h-0.5 rounded shrink-0"
															style={{ backgroundColor: entry.color }}
														/>
														<span className="text-xs text-[#6b7280]">{entry.value}</span>
													</li>
												);
											})}
										</ul>
									)}
								/>}
								{series.map((strategy) => (
									<Line
										key={strategy.seriesKey}
										type="monotone"
										dataKey={strategy.seriesKey}
										name={strategy.displayName}
										stroke={strategy.color}
										strokeWidth={2}
										strokeOpacity={hiddenSeriesKeys.has(strategy.seriesKey) ? 0 : 1}
										dot={false}
										activeDot={compact ? false : hiddenSeriesKeys.has(strategy.seriesKey) ? false : { r: 4 }}
										isAnimationActive={!compact}
									/>
								))}
							</LineChart>
						</ResponsiveContainer>
					</div>
				)}
			</CardContent>
		</Card>
	);
};

export default EquityChart;
