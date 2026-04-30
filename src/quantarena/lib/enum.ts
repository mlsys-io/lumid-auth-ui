/**
 * Application-wide constants and enums
 */

// Pagination
export const PAGE_SIZE = 20;

// Filter values
export const FILTER_ALL = 'all';

// Backtest task statuses
export enum BacktestStatus {
	PENDING = 'Pending',
	RUNNING = 'Running',
	FINISHED = 'Finished',
	FAILED = 'Failed',
	CANCELLED = 'Cancelled',
}

// Backtest status options for filters
export const BACKTEST_STATUS_OPTIONS = [
	BacktestStatus.PENDING,
	BacktestStatus.RUNNING,
	BacktestStatus.FINISHED,
	BacktestStatus.FAILED,
	BacktestStatus.CANCELLED,
];

// Strategy visibility
export enum StrategyVisibility {
	PUBLIC = 'Public',
	PRIVATE = 'Private',
}

// Strategy visibility options for filters
export const VISIBILITY_OPTIONS = [StrategyVisibility.PUBLIC, StrategyVisibility.PRIVATE];

// Framework types
export enum Framework {
	MOONSHOT = 'Moonshot',
	ZIPLINE = 'Zipline',
	FREQTRADE = 'FreqTrade',
}

// Framework options for filters
export const FRAMEWORK_OPTIONS = [Framework.MOONSHOT, Framework.ZIPLINE, Framework.FREQTRADE];

// Export file types
export enum ExportFileType {
	CSV = 'csv',
	PDF = 'pdf',
	JSON = 'json',
}

// Backtest status badge styles
export const BACKTEST_STATUS_STYLES: Record<BacktestStatus, string> = {
	[BacktestStatus.PENDING]: 'bg-gray-100 text-gray-800 border-gray-200',
	[BacktestStatus.RUNNING]: 'bg-blue-100 text-blue-800 border-blue-200',
	[BacktestStatus.FINISHED]: 'bg-green-100 text-green-800 border-green-200',
	[BacktestStatus.FAILED]: 'bg-red-100 text-red-800 border-red-200',
	[BacktestStatus.CANCELLED]: 'bg-orange-100 text-orange-800 border-orange-200',
};

// Equity chart colors
export const CHART_COLORS: string[] = [
	'#8b5cf6', // Purple
	'#3b82f6', // Blue
	'#f59e0b', // Orange
	'#10b981', // Green
	'#ef4444', // Red
	'#ec4899', // Pink
	'#6b7280', // Gray
	'#f59e0b', // yellow
	'#8c564b', // brown
	'#bcbd22', // Olive
	'#17becf', // cyan
	'#003f5c', // Dark Blue
	'#2f4b7c', // Teal
	'#c51b8a', // Magenta
];
// FreqTrade exchange options
export const FREQTRADE_EXCHANGE_OPTIONS = [
	{ value: 'binance', label: 'Binance' },
	{ value: 'kraken', label: 'Kraken' },
	{ value: 'bybit', label: 'Bybit' },
	{ value: 'okx', label: 'OKX' },
	{ value: 'kucoin', label: 'KuCoin' },
];

// FreqTrade timeframe options
export const FREQTRADE_TIMEFRAME_OPTIONS = [
	{ value: '1m', label: '1 Minute' },
	{ value: '5m', label: '5 Minutes' },
	{ value: '15m', label: '15 Minutes' },
	{ value: '30m', label: '30 Minutes' },
	{ value: '1h', label: '1 Hour' },
	{ value: '4h', label: '4 Hours' },
	{ value: '1d', label: '1 Day' },
	{ value: '1w', label: '1 Week' },
];

// FreqTrade download status
export enum DownloadStatus {
	PENDING = 'Pending',
	RUNNING = 'Running',
	COMPLETED = 'Completed',
	FAILED = 'Failed',
}

export const DOWNLOAD_STATUS_STYLES: Record<DownloadStatus, string> = {
	[DownloadStatus.PENDING]: 'bg-gray-100 text-gray-800 border-gray-200',
	[DownloadStatus.RUNNING]: 'bg-blue-100 text-blue-800 border-blue-200',
	[DownloadStatus.COMPLETED]: 'bg-green-100 text-green-800 border-green-200',
	[DownloadStatus.FAILED]: 'bg-red-100 text-red-800 border-red-200',
};

export const VENDOR_OPTIONS = [
	// {
	// 	value: 'edi',
	// 	label: 'EDI',
	// },
	// {
	// 	value: 'ibkr',
	// 	label: 'IBKR',
	// },
	// {
	// 	value: 'sharadar',
	// 	label: 'Sharadar',
	// },
	{
		value: 'usstock',
		label: 'USStock',
	},
];
export const INGEST_TYPE_OPTIONS = [
	{
		value: 'usstock',
		label: 'USStock',
	},
	// {
	// 	value: 'sharadar',
	// 	label: 'Sharadar',
	// },
];
export const COMPETITION_STATUS_OPTIONS: { value: string; label: string }[] = [
	{
		value: 'Upcoming',
		label: 'Upcoming',
	},
	{
		value: 'Ongoing',
		label: 'Ongoing',
	},
	{
		value: 'Completed',
		label: 'Completed',
	},
];
