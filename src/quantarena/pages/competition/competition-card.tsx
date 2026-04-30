import React, { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { CompetitionInfo } from '../../api/types';
import { formatTimestampToDateHour, formatCurrency, formatPercentage } from '../../lib/utils';
import { cn } from '../../lib/utils';
import { Calendar, Currency, Percent, TrendingUp, Users, CircleQuestionMark } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { useIsMobile } from '../../components/ui/use-mobile';
import { useNavigate } from 'react-router-dom';

interface CompetitionCardProps {
	competition: CompetitionInfo;
	onViewDetails?: (competition: CompetitionInfo) => void;
	onRegister?: (competition: CompetitionInfo) => void;
}

export const getStatusBadgeColor = (status: CompetitionInfo['status']) => {
	switch (status) {
		case 'Ongoing':
			return 'bg-green-100 text-green-800 border-green-200';
		case 'Upcoming':
			return 'bg-blue-100 text-blue-800 border-blue-200';
		case 'Completed':
			return 'bg-gray-100 text-gray-800 border-gray-200';
		default:
			return '';
	}
};
export const getStatusBadgeVariant = (status: CompetitionInfo['status']) => {
	switch (status) {
		case 'Ongoing':
			return 'default';
		case 'Upcoming':
			return 'secondary';
		case 'Completed':
			return 'outline';
		default:
			return 'outline';
	}
};
const CompetitionCard: React.FC<CompetitionCardProps> = ({ competition, onRegister }) => {
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const [namePopoverOpen, setNamePopoverOpen] = useState(false);
	const [symbolsPopoverOpen, setSymbolsPopoverOpen] = useState(false);

	const handleViewDetails = (competition: CompetitionInfo) => {
		navigate(`/dashboard/quant/competition/${competition.id}`);
	};

	return (
		<Card className="h-full flex flex-col">
			<CardHeader className="relative">
				<div className="flex items-start justify-between gap-2 min-w-0">
					{isMobile ? (
						<Popover open={namePopoverOpen} onOpenChange={setNamePopoverOpen}>
							<PopoverTrigger asChild>
								<div className="flex-1 min-w-0 line-clamp-2 pr-2 cursor-pointer touch-manipulation">
									<CardTitle className="text-lg font-semibold text-left">
										{competition.name}
									</CardTitle>
								</div>
							</PopoverTrigger>
							<PopoverContent align="start" className="max-w-[min(90vw,24rem)]">
								<p className="text-sm font-semibold">{competition.name}</p>
							</PopoverContent>
						</Popover>
					) : (
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex-1 min-w-0 line-clamp-2 pr-2 cursor-default">
									<CardTitle className="text-lg font-semibold text-left">
										{competition.name}
									</CardTitle>
								</div>
							</TooltipTrigger>
							<TooltipContent side="top" className="max-w-[min(90vw,24rem)]">
								<p className="text-sm">{competition.name}</p>
							</TooltipContent>
						</Tooltip>
					)}
					<Badge
						variant={getStatusBadgeVariant(competition.status)}
						className={cn('shrink-0', getStatusBadgeColor(competition.status))}
					>
						{competition.status}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="flex-1 space-y-3">
				<div className="space-y-4 text-sm">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground flex items-center">
							<Currency className="w-4 h-4 mr-0.5" /> Initial Funding:
						</span>
						<span className="font-medium">{formatCurrency(competition.initial_funding)}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground flex items-center">
							<TrendingUp className="w-4 h-4 mr-0.5" />
							Market:
						</span>
						<span className="font-medium flex items-center gap-1">
							{competition.market_name}
							{competition?.symbols?.length > 0 && (
								<Popover open={symbolsPopoverOpen} onOpenChange={setSymbolsPopoverOpen}>
									<PopoverTrigger asChild>
										<button type="button" className="touch-manipulation">
											<CircleQuestionMark className="w-4 h-4 mr-0.5 text-orange-500 cursor-pointer" />
										</button>
									</PopoverTrigger>
									<PopoverContent align="start" className="max-w-[min(90vw,24rem)] bg-black text-white border-black">
										<p className="text-sm break-all">{competition?.symbols?.join(', ')}</p>
									</PopoverContent>
								</Popover>
							)}
						</span>
					</div>

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground flex items-center">
							<Percent className="w-4 h-4 mr-0.5" />
							Trading Fees:
						</span>
						<span className="font-medium">{formatPercentage(competition.trading_fees)}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground flex items-center">
							<Users className="w-4 h-4 mr-0.5" />
							Participant Strategies Count:
						</span>
						<span className="font-medium">{competition.participant_count}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground flex items-center">
							<Calendar className="w-4 h-4 mr-0.5" />
							Date:
						</span>
						<span className="font-medium text-xs">
							{formatTimestampToDateHour(competition.start_time)} ~{' '}
							{formatTimestampToDateHour(competition.end_time)}
						</span>
					</div>
				</div>
			</CardContent>
			<CardFooter className="flex gap-2 pt-4">
				<Button
					variant="outline"
					className="flex-1 cursor-pointer"
					onClick={() => handleViewDetails?.(competition)}
				>
					View Details
				</Button>
				{competition.status === 'Upcoming' && (
					<Button
						className="flex-1 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
						onClick={() => onRegister?.(competition)}
					>
						Join
					</Button>
				)}
				{competition.status === 'Ongoing' && (
					<Button variant="secondary" className="flex-1 cursor-not-allowed" disabled>
						Ongoing
					</Button>
				)}
			</CardFooter>
		</Card>
	);
};

export default CompetitionCard;
