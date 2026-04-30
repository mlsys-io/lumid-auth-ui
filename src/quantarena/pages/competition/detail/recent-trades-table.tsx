import React from 'react';
import { RecentTradeInfo } from '../../../api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableCell, TableRow, TableHeader, TableHead, TableBody } from '../../../components/ui/table';
import { formatDateTime, formatCurrency, formatNumberToThousands } from '../../../lib/utils';

interface RecentTradesTableProps {
	recentTrades: RecentTradeInfo[];
}
const directionColorMap = {
	Buy: 'text-green-600',
	Sell: 'text-red-600',
};
const RecentTradesTable = (props: RecentTradesTableProps) => {
	const { recentTrades } = props;
	return (
		<Card className="mt-4">
			<CardHeader>
				<CardTitle className="text-base font-semibold text-foreground">Trade Records</CardTitle>
				<CardDescription className="text-xs text-muted-foreground">
					Display the Recent Trading History
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Time</TableHead>
							<TableHead className="text-center">Direction</TableHead>
							<TableHead className="text-center">Symbol</TableHead>
							<TableHead className="text-center">Price</TableHead>
							<TableHead className="text-center">Trading Volume</TableHead>
							<TableHead className="text-center">Trading Value</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{recentTrades.length === 0 && (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground py-8">
									No trades yet. Submit orders via the Trading API to see them here.
								</TableCell>
							</TableRow>
						)}
						{recentTrades.map((trade) => (
							<TableRow key={trade.id}>
								<TableCell>{formatDateTime(trade.trade_time)}</TableCell>
								<TableCell className="text-center">
									<div
										className={directionColorMap[trade.direction as keyof typeof directionColorMap]}
									>
										{trade.direction}
									</div>
								</TableCell>
								<TableCell className="text-center">{trade.symbol}</TableCell>
								<TableCell className="text-center">{formatCurrency(trade.price)}</TableCell>
								<TableCell className="text-center">{formatNumberToThousands(trade.volume)}</TableCell>
								<TableCell className="text-center">{formatCurrency(trade.value)}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
};

export default RecentTradesTable;
