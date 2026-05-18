import React, { useState } from 'react';
import { MyStrategyInfo } from '../../../api/types';
import { Trophy, RotateCcw } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar';
import { cn, getUserInitials } from '../../../lib/utils';
import { toast } from 'sonner';
import { ApiError, resetStrategy } from '../../../api';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '../../../components/ui/alert-dialog';

interface MyStrategyListProps {
	competitionId: number;
	list: MyStrategyInfo[];
	status: 'Upcoming' | 'Ongoing' | 'Completed';
	onReset?: () => void;
}

const MyStrategyList = (props: MyStrategyListProps) => {
	const { competitionId, list, status, onReset } = props;
	const [resettingId, setResettingId] = useState<number | null>(null);

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

	const handleReset = async (strategyId: number) => {
		setResettingId(strategyId);
		try {
			await resetStrategy(competitionId, strategyId);
			toast.success('Strategy reset successfully. All trades and positions have been cleared.');
			onReset?.();
		} catch (error) {
			const msg = error instanceof ApiError ? error.message : 'Failed to reset strategy';
			toast.error(msg);
		} finally {
			setResettingId(null);
		}
	};

	const formatResetTime = (ts: number) => {
		return new Date(ts * 1000).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
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
								<div className="text-xs text-muted-foreground">
									{item.username}
									{item.last_reset_at && (
										<span className="ml-2 text-amber-500">
											· Reset {formatResetTime(item.last_reset_at)}
										</span>
									)}
								</div>
							</div>
						</div>

						<div className="flex items-center gap-3">
							{status === 'Ongoing' && (
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<button
											className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
											disabled={resettingId === item.simulation_strategy_id}
											title="Reset strategy"
										>
											<RotateCcw className="w-3.5 h-3.5" />
										</button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Reset Strategy</AlertDialogTitle>
											<AlertDialogDescription>
												This will permanently delete all trade history and positions for{' '}
												<strong>{item.strategy_name}</strong>. Your cash will be restored to
												the initial funding amount. This action cannot be undone.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction
												onClick={() => handleReset(item.simulation_strategy_id)}
												className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
											>
												Reset
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							)}
							<div className="text-sm font-mono font-medium text-emerald-600">
								{getRankDisplay(item.rank)}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

export default MyStrategyList;
