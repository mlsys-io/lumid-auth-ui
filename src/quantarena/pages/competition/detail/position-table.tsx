import React, { useState } from 'react';
import { PositionInfo } from '../../../api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { useIsMobile } from '../../../components/ui/use-mobile';
import { CircleQuestionMark } from 'lucide-react';

interface PositionTableProps {
	positions: PositionInfo[];
}
const PositionTable = (props: PositionTableProps) => {
	const { positions } = props;
	const isMobile = useIsMobile();
	const [openHelpKey, setOpenHelpKey] = useState<string | null>(null);
	return (
		<Card className="mt-4">
			<CardHeader>
				<CardTitle className="text-base font-semibold text-foreground">Current Positions</CardTitle>
				<CardDescription className="text-xs text-muted-foreground">
					Display all stocks where the holding quantity is not zero
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Symbol</TableHead>
							<TableHead className="text-center">Market Price</TableHead>
							<TableHead className="text-center">
								<div className="flex items-center justify-center gap-1">
									Position Size
									{isMobile ? (
										<Popover open={openHelpKey === 'positionSize'} onOpenChange={(o) => setOpenHelpKey(o ? 'positionSize' : null)}>
											<PopoverTrigger asChild>
												<button type="button" className="touch-manipulation">
													<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
												</button>
											</PopoverTrigger>
											<PopoverContent align="center" className="max-w-[min(90vw,24rem)]">
												<p className="text-sm">Current open quantity held.</p>
											</PopoverContent>
										</Popover>
									) : (
										<Tooltip>
											<TooltipTrigger>
												<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
											</TooltipTrigger>
											<TooltipContent>
												<p>Current open quantity held.</p>
											</TooltipContent>
										</Tooltip>
									)}
								</div>
							</TableHead>
							<TableHead className="text-center">
								<div className="flex items-center justify-center gap-1">
									Average Price
									{isMobile ? (
										<Popover open={openHelpKey === 'averagePrice'} onOpenChange={(o) => setOpenHelpKey(o ? 'averagePrice' : null)}>
											<PopoverTrigger asChild>
												<button type="button" className="touch-manipulation">
													<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
												</button>
											</PopoverTrigger>
											<PopoverContent align="center" className="max-w-[min(90vw,24rem)]">
												<p className="text-sm">Average cost of the open position.</p>
											</PopoverContent>
										</Popover>
									) : (
										<Tooltip>
											<TooltipTrigger>
												<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
											</TooltipTrigger>
											<TooltipContent>
												<p>Average cost of the open position.</p>
											</TooltipContent>
										</Tooltip>
									)}
								</div>
							</TableHead>
							<TableHead className="text-center">
								<div className="flex items-center justify-center gap-1">
									Unrealized P&L
									{isMobile ? (
										<Popover open={openHelpKey === 'unrealizedPnl'} onOpenChange={(o) => setOpenHelpKey(o ? 'unrealizedPnl' : null)}>
											<PopoverTrigger asChild>
												<button type="button" className="touch-manipulation">
													<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
												</button>
											</PopoverTrigger>
											<PopoverContent align="center" className="max-w-[min(90vw,24rem)]">
												<p className="text-sm">Current profit or loss of open positions.</p>
											</PopoverContent>
										</Popover>
									) : (
										<Tooltip>
											<TooltipTrigger>
												<CircleQuestionMark className="w-4 h-4 text-orange-500 cursor-pointer" />
											</TooltipTrigger>
											<TooltipContent>
												<p>Current profit or loss of open positions.</p>
											</TooltipContent>
										</Tooltip>
									)}
								</div>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{positions.map((position) => (
							<TableRow key={position.symbol}>
								<TableCell>{position.symbol}</TableCell>
								<TableCell className="text-center">{position.market_price}</TableCell>
								<TableCell className="text-center">{position.position_size}</TableCell>
								<TableCell className="text-center">{position.average_price}</TableCell>
								<TableCell
									className={`font-medium ${position.unrealized_pnl > 0 ? 'text-green-600' : 'text-red-600'} text-center`}
								>
									{position.unrealized_pnl > 0 ? '+' : ''}
									{position.unrealized_pnl}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
};

export default PositionTable;
