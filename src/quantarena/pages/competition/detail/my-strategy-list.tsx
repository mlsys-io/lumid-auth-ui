import React from 'react';
import { MyStrategyInfo } from '../../../api/types';
import { Trophy } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar';
import { cn, getUserInitials } from '../../../lib/utils';

interface MyStrategyListProps {
	list: MyStrategyInfo[];
	status: 'Upcoming' | 'Ongoing' | 'Completed';
}
const MyStrategyList = (props: MyStrategyListProps) => {
	const { list, status } = props;

	const getRankDisplay = (rank: number) => {
		if (status === 'Upcoming') return <div className="text-sm font-medium text-muted-foreground">Upcoming</div>;
		return <div className={cn('text-sm font-mono font-medium', getRankColor(rank))}>#{rank}</div>;
	};

	const getRankBorderColor = (rank: number) => {
		if (rank === 1) return 'border-l-[#D4AF37]';
		if (rank === 2) return 'border-l-[#C0C0C0]';
		if (rank === 3) return 'border-l-[#B87333]';
		return 'border-l-[#000000]';
	};

	const getRankColor = (rank: number) => {
		if (rank === 1) return 'text-[#D4AF37]';
		if (rank === 2) return 'text-[#C0C0C0]';
		if (rank === 3) return 'text-[#B87333]';
		return 'text-[#000000]';
	};

	return (
		<div className="border rounded-lg p-4 mt-4">
			<div className="text-base font-semibold text-foreground mb-4 flex items-center">
				<Trophy className="w-4 h-4 mr-2 text-orange-500" />
				My Strategies
			</div>
			<div className="grid grid-cols-1 gap-2">
				{list.map((item) => (
					<div
						key={item.id}
						className={cn(
							'group flex items-center justify-between px-4 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors border-l-2',
							getRankBorderColor(item.rank)
						)}
					>
						<div className="flex items-center">
							<Avatar className="h-10 w-10 mr-3 bg-background ring-1 ring-border">
								<AvatarImage src={item.user_avatar} alt={item.username} />
								<AvatarFallback>{getUserInitials(item.username)}</AvatarFallback>
							</Avatar>

							<div className="flex flex-col">
								<div className="text-sm font-medium text-foreground">{item.strategy_name}</div>
								<div className="text-xs text-muted-foreground">{item.username}</div>
							</div>
						</div>

						<div className="text-sm font-mono font-medium text-emerald-600">
							{getRankDisplay(item.rank)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

export default MyStrategyList;
