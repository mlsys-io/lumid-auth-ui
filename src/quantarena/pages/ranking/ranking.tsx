import React, { useState, useEffect, useCallback, memo } from 'react';
import { Card, CardContent } from '../../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Pagination } from '../../components/ui/pagination';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { ArrowUp, ArrowDown, RefreshCw, Trophy, ChevronDown, X, Check, ArrowDownUp } from 'lucide-react';
import { toast } from 'sonner';
import { Loading } from '../../components/ui/loading';
import { getStrategyRanking, ApiError, getRankingTemplatesList } from '../../api';
import type { StrategyRankingItem } from '../../api';
import { getFrameworkColor } from '../../lib/tag-colors';
import { usePagination } from '../../hooks/usePagination';
import { useAuth } from '../../hooks/useAuth';
import { PAGE_SIZE } from '../../lib/enum';
import { cn } from '../../lib/utils';
import { selectHeaderCss } from '../strategy/upload-strategy-dialog';
type SortField = 'cagr' | 'sharpe_ratio' | 'max_drawdown' | 'cumulative_return';
type SortOrder = 'asc' | 'desc';

// Memoized utility functions
const getRankDisplay = (rank: number) => {
	if (rank === 1) return <span className="text-3xl">🥇</span>;
	if (rank === 2) return <span className="text-3xl">🥈</span>;
	if (rank === 3) return <span className="text-3xl">🥉</span>;
	return <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-xs font-medium">{rank}</span>;
};

const getUserInitials = (username: string) => {
	return username
		.split(' ')
		.map((n) => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
};

// Memoized table row component
const RankingTableRow = memo(function RankingTableRow({
	item,
	isCurrentUser,
	templatesList,
}: {
	item: StrategyRankingItem;
	isCurrentUser: boolean;
	templatesList: { id: number; name: string }[];
}) {
	return (
		<TableRow className="hover:bg-muted/50">
			<TableCell className="align-middle">
				<div className="flex items-center justify-center h-8">{getRankDisplay(item.rank)}</div>
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-3">
					<Avatar className="h-10 w-10">
						<AvatarImage src={item.user_avatar} alt={item.username} />
						<AvatarFallback>{getUserInitials(item.username)}</AvatarFallback>
					</Avatar>
					<div className="flex items-center gap-2">
						<p className="font-medium">{item.username}</p>
						{isCurrentUser && (
							<span className="text-xs bg-orange-100 text-gray-800 px-2 py-1 rounded-full font-medium">
								You
							</span>
						)}
					</div>
				</div>
			</TableCell>
			<TableCell>
				<div>
					<p className="font-medium">
						{item.strategy_name}
						<span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium ml-2">
							v{item.version}
						</span>
					</p>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="text-sm text-muted-foreground truncate max-w-xs cursor-default">
								{item.strategy_description}
							</div>
						</TooltipTrigger>
						<TooltipContent className="max-w-sm whitespace-pre-line">
							<p>{item.strategy_description}</p>
						</TooltipContent>
					</Tooltip>
				</div>
			</TableCell>
			<TableCell>
				<span
					className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors ${getFrameworkColor(item.framework)}`}
				>
					{item.framework}
				</span>
			</TableCell>
			<TableCell>
				<div className="flex flex-wrap gap-1">
					{templatesList.find((template) => template.id === item.template_id)?.name}
				</div>
			</TableCell>
			<TableCell className={`font-medium ${item.cagr > 0 ? 'text-green-600' : 'text-red-600'}`}>
				{item.cagr > 0 ? '+' : ''}
				{(item.cagr * 100)?.toFixed(2)}%
			</TableCell>
			<TableCell className="font-medium">{item.sharpe_ratio?.toFixed(2)}</TableCell>
			<TableCell className={`font-medium ${item.max_drawdown > 0 ? 'text-green-600' : 'text-red-600'}`}>
				{(item.max_drawdown * 100)?.toFixed(2)}%
			</TableCell>
			<TableCell className={`font-medium ${item.cumulative_return > 0 ? 'text-green-600' : 'text-red-600'}`}>
				{item.cumulative_return > 0 ? '+' : ''}
				{(item.cumulative_return * 100)?.toFixed(2)}%
			</TableCell>
		</TableRow>
	);
});

// Memoized sortable table header
const SortableTableHead = memo(function SortableTableHead({
	field,
	currentField,
	sortOrder,
	onSort,
	children,
}: {
	field: SortField;
	currentField: SortField;
	sortOrder: SortOrder;
	onSort: (field: SortField) => void;
	children: React.ReactNode;
}) {
	const isActive = currentField === field;

	return (
		<TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => onSort(field)}>
			<div className="flex items-center">
				{children}
				{isActive &&
					(sortOrder === 'asc' ? (
						<ArrowUp className="h-3 w-3 ml-1 inline text-blue-500" />
					) : (
						<ArrowDown className="h-3 w-3 ml-1 inline text-blue-500" />
					))}
				{!isActive && <ArrowDownUp className="h-3 w-3 ml-1 inline text-gray-500 hover:text-blue-500" />}
			</div>
		</TableHead>
	);
});
const DEFAULT_SORT: { sort_by: SortField; order: 'asc' | 'desc' } = {
	sort_by: 'cagr',
	order: 'desc',
};
export const Ranking = memo(function Ranking() {
	const { user } = useAuth();
	const [rankings, setRankings] = useState<StrategyRankingItem[]>([]);
	const [loading, setLoading] = useState(false);
	// const [selectedTags, setSelectedTags] = useState<string[]>([]);
	// const [availableTags, setAvailableTags] = useState<string[]>([]);
	const [availableTemplates, setAvailableTemplates] = useState<{ id: number; name: string }[]>([]);
	const [selectedTemplates, setSelectedTemplates] = useState<number[]>([]);
	const [sortInfo, setSortInfo] = useState<{ sort_by: SortField; order: 'asc' | 'desc' }>(DEFAULT_SORT);

	const pagination = usePagination({ pageSize: PAGE_SIZE });

	// const fetchTags = async () => {
	// 	try {
	// 		const response = await getRankingTags();
	// 		setAvailableTags(response.data.tags || []);
	// 		console.log(response);
	// 	} catch (error) {
	// 		console.error('Failed to fetch tags:', error);
	// 	}
	// };

	const fetchTemplates = async () => {
		try {
			const response = await getRankingTemplatesList();
			setAvailableTemplates(response.data.templates);
		} catch (error) {
			console.error('Failed to fetch templates:', error);
		}
	};
	// Fetch available tags on mount
	useEffect(() => {
		//fetchTags();
		fetchTemplates();
	}, []);

	const fetchRankings = useCallback(async () => {
		setLoading(true);
		try {
			const response = await getStrategyRanking({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
				// sort_by: sortField,
				// order: sortOrder,
				sort_by: sortInfo.sort_by,
				order: sortInfo.order,
				template_ids: selectedTemplates.length > 0 ? selectedTemplates : undefined,
			});
			setRankings(response.data.rankings);
			pagination.setTotal(response.total);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load rankings');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	}, [
		pagination.currentPage,
		pagination.pageSize,
		// sortField,
		// sortOrder,
		selectedTemplates,
		pagination.setTotal,
		sortInfo,
	]);

	useEffect(() => {
		fetchRankings();
	}, [fetchRankings]);

	const handleSort = useCallback(
		(field: SortField) => {
			setSortInfo((prev) => {
				if (prev.sort_by !== field) {
					return { sort_by: field, order: 'desc' };
				}
				if (prev.order === 'desc') {
					return { sort_by: field, order: 'asc' };
				}
				return DEFAULT_SORT;
			});
			pagination.resetPage();
		},
		[pagination.resetPage]
	);

	const handleTemplateToggle = useCallback(
		(templateId: number) => {
			setSelectedTemplates((prev) => {
				const newTemplates = prev.includes(templateId)
					? prev.filter((t) => t !== templateId)
					: [...prev, templateId];
				return newTemplates;
			});
			pagination.resetPage();
		},
		[pagination.resetPage]
	);

	const handleClearTemplates = useCallback(() => {
		setSelectedTemplates([]);
		pagination.resetPage();
	}, [pagination.resetPage]);

	const handleRemoveTemplate = useCallback(
		(templateId: number) => {
			setSelectedTemplates((prev) => prev.filter((t) => t !== templateId));
			pagination.resetPage();
		},
		[pagination.resetPage]
	);

	const handleRefresh = useCallback(() => {
		//	fetchTags();
		fetchTemplates();
		fetchRankings();
	}, [fetchRankings]);

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold">Ranking</h1>
					<p className="text-muted-foreground">
						Top strategies ranked by backtesting performance and risk metrics
					</p>
				</div>
				<Button onClick={handleRefresh} disabled={loading} variant="outline" className="gap-2">
					<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
					Refresh
				</Button>
			</div>

			{/* Tags Filter */}
			<div className="flex items-center gap-4 p-3 rounded-lg border">
				<label className="text-sm font-medium text-muted-foreground">Templates:</label>
				<Popover>
					<PopoverTrigger asChild>
						<div className={cn(selectHeaderCss, selectedTemplates.length === 0 && 'text-muted-foreground', 'w-60')}>
							{selectedTemplates.length === 0 ? (
								'Select templates'
							) : (
								<span>{selectedTemplates.length} selected</span>
							)}
							<ChevronDown className="ml-2 h-4 w-4 opacity-50" />
						</div>
					</PopoverTrigger>
					<PopoverContent className="w-[250px] p-0" align="start">
						<div className="p-2 border-b">
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-start text-muted-foreground"
								onClick={handleClearTemplates}
								disabled={selectedTemplates.length === 0}
							>
								Clear all
							</Button>
						</div>
						<div className="max-h-[200px] overflow-y-auto p-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
							{availableTemplates.length === 0 ? (
								<div className="text-sm text-muted-foreground text-center py-2">
									No templates available
								</div>
							) : (
								availableTemplates.map((template) => (
									<div
										key={template.id}
										className="flex items-center space-x-2 p-2 hover:bg-muted rounded cursor-pointer"
										onClick={() => handleTemplateToggle(template.id)}
									>
										<span className="text-sm">{template.name}</span>
										{selectedTemplates.includes(template.id) && (
											<Check className="size-4 text-indigo-500" />
										)}
									</div>
								))
							)}
						</div>
					</PopoverContent>
				</Popover>
				{selectedTemplates.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{selectedTemplates.map((templateId) => (
							<Badge
								key={templateId}
								variant="secondary"
								className="cursor-pointer hover:bg-destructive/20"
								onClick={() => handleRemoveTemplate(templateId)}
							>
								{availableTemplates.find((template) => template.id === templateId)?.name}
								<X className="ml-1 h-3 w-3" />
							</Badge>
						))}
					</div>
				)}
			</div>

			{/* Loading State */}
			{loading && rankings.length === 0 && <Loading text="Loading rankings..." />}

			{/* Empty State */}
			{!loading && rankings.length === 0 && (
				<div
					className="flex flex-col items-center justify-center py-24 border rounded-lg bg-muted/20"
					style={{ padding: '20px' }}
				>
					<div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
						<Trophy className="w-8 h-8 text-muted-foreground" />
					</div>
					<h3 className="text-lg font-semibold mb-2">No rankings yet</h3>
					<p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
						Rankings will appear once strategies have completed backtest tasks with results.
					</p>
				</div>
			)}
			{!loading && rankings.length > 0 && (
				<Card>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-24">Rank</TableHead>
									<TableHead>User</TableHead>
									<TableHead>Strategy</TableHead>
									<TableHead>Framework</TableHead>
									<TableHead>Templates</TableHead>
									<SortableTableHead
										field="cagr"
										currentField={sortInfo.sort_by}
										sortOrder={sortInfo.order}
										onSort={handleSort}
									>
										CAGR %
									</SortableTableHead>
									<SortableTableHead
										field="sharpe_ratio"
										currentField={sortInfo.sort_by}
										sortOrder={sortInfo.order}
										onSort={handleSort}
									>
										Sharpe Ratio
									</SortableTableHead>
									<SortableTableHead
										field="max_drawdown"
										currentField={sortInfo.sort_by}
										sortOrder={sortInfo.order}
										onSort={handleSort}
									>
										Max Drawdown %
									</SortableTableHead>
									<SortableTableHead
										field="cumulative_return"
										currentField={sortInfo.sort_by}
										sortOrder={sortInfo.order}
										onSort={handleSort}
									>
										Cumulative Return %
									</SortableTableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rankings.map((item) => (
									<RankingTableRow
										key={item.backtest_task_id}
										item={item}
										isCurrentUser={user?.id === item.user_id}
										templatesList={availableTemplates}
									/>
								))}
							</TableBody>
						</Table>

						{/* Pagination */}
						{rankings.length > 0 && (
							<div className="p-4 border-t">
								<Pagination
									currentPage={pagination.currentPage}
									totalPages={pagination.totalPages}
									total={pagination.total}
									onPageChange={pagination.goToPage}
								/>
							</div>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	);
});
