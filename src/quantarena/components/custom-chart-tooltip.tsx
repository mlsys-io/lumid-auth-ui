import { formatTimestampToMMDD, formatTimestampToDeatailDate, formatCurrency } from '../lib/utils';

export interface ChartDataPoint {
	date: string; // Formatted date string (MM/DD)
	[strategy_name: string]: number | string;
	timestamp: number; // Original timestamp for tooltip
}
interface TooltipEntry {
	name?: string;
	value?: number | string;
	dataKey?: string;
	color?: string;
	payload?: ChartDataPoint;
}
export type TimeGranularity = 'min' | 'hour' | 'day';
interface CustomTooltipProps {
	active?: boolean;
	payload?: readonly TooltipEntry[] | TooltipEntry[];
	label?: string | number;
	timeGranularity: TimeGranularity;
	status?: 'Upcoming' | 'Ongoing' | 'Completed';
}

const CustomTooltip = ({ active, payload, label, timeGranularity }: CustomTooltipProps) => {
	if (!active || !payload || payload.length === 0) {
		return null;
	}

	const dataPoint = payload[0]?.payload as ChartDataPoint;
	let formattedLabel = label || '';

	if (dataPoint?.timestamp) {
		if (timeGranularity === 'day') {
			formattedLabel = formatTimestampToMMDD(dataPoint.timestamp);
		} else if (timeGranularity === 'hour') {
			const date = new Date(dataPoint.timestamp * 1000);
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			const hours = String(date.getHours()).padStart(2, '0');
			formattedLabel = `${month}/${day} ${hours}:00`;
		} else {
			formattedLabel = formatTimestampToDeatailDate(dataPoint.timestamp);
		}
	}

	return (
		<div
			style={{
				backgroundColor: '#fff',
				border: '1px solid #e5e7eb',
				borderRadius: '6px',
				padding: '14px 16px',
				fontSize: '13px',
			}}
		>
			<div style={{ marginBottom: '4px', fontWeight: 500, color: '#374151' }}>{formattedLabel}</div>
			{payload.map((entry: TooltipEntry, index: number) => {
				if (!entry || entry.dataKey === 'date' || entry.dataKey === 'timestamp') {
					return null;
				}
				const value = typeof entry.value === 'number' ? formatCurrency(entry.value) : entry.value || '';
				const color = entry.color || '#8b5cf6';
				return (
					<div
						key={`item-${index}`}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '12px',
							marginBottom: '4px',
						}}
					>
						<div
							style={{
								width: '10px',
								height: '10px',
								backgroundColor: color,
								flexShrink: 0,
							}}
						/>
						<div
							style={{
								width: '90px',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
								textAlign: 'left',
								color: '#6b7280',
							}}
						>
							{entry.name || entry.dataKey}
						</div>
						<div
							style={{
								flex: 1,
								textAlign: 'right',
								fontWeight: 500,
								color: '#111827',
							}}
						>
							{value}
						</div>
					</div>
				);
			})}
		</div>
	);
};

export default CustomTooltip;
