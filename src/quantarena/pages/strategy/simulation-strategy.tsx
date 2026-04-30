import React, { useEffect, useState } from 'react';
import { getSimulationStrategies } from '../../api/strategy';
import { SimulationStrategyInfo } from '../../api/types';
import { Loading } from '../../components/ui/loading';
import EmptyData from '../../components/empty-data';
import { Plus, Eye, EyeOff, RefreshCw, Trash, Sparkles, Microscope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TableCell, Table, TableHead, TableHeader, TableRow, TableBody, TableFooter } from '../../components/ui/table';
import { Pagination } from '../../components/ui/pagination';
import { usePagination } from '../../hooks/usePagination';
import { PAGE_SIZE } from '../../lib/enum';
import { Button } from '../../components/ui/button';
import NewSimulationStrategyDialog from './new-simulation-strategy-dialog';
import AIStrategyWizard from './ai-strategy-wizard';
import { toast } from 'sonner';
import { ApiError, createSimulationStrategy, deleteSimulationStrategy } from '../../api';
import ModalConfirm from '../../components/modal-confirm';
import { formatDate } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';

const SimulationStrategy = () => {
	const [strategies, setStrategies] = useState<SimulationStrategyInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [visibleTokens, setVisibleTokens] = useState<Record<number, boolean>>({});
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [showAIWizard, setShowAIWizard] = useState(false);
	const [refresh, setRefresh] = useState<number>(Date.now());
	const [deleteTarget, setDeleteTarget] = useState<SimulationStrategyInfo | null>(null);
	const navigate = useNavigate();

	useEffect(() => {
		fetchStrategies();
	}, [refresh, pagination.currentPage]);

	const fetchStrategies = async () => {
		setLoading(true);
		try {
			const response = await getSimulationStrategies({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			});
			setStrategies(response.data.strategies);
			pagination.setTotal(response.total);
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	const toggleTokenVisibility = (strategyId: number) => {
		setVisibleTokens((prev) => ({
			...prev,
			[strategyId]: !prev[strategyId],
		}));
	};

	const maskToken = (token: string) => {
		if (!token) return '';
		return '•'.repeat(Math.min(token.length, 20));
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteSimulationStrategy(deleteTarget.id);
			toast.success('Forward testing strategy deleted successfully');
			setDeleteTarget(null);
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to delete strategy');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	const handleCreateStrategySuccess = async (data: { name: string; description: string; competition_id: number }) => {
		try {
			await createSimulationStrategy(data);
			toast.success('Forward testing strategy created successfully!');
			setRefresh(Date.now());
			setShowCreateDialog(false);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to create forward testing strategy');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	return (
		<div>
			<div className="flex items-center justify-end mb-4 gap-2">
				<Button
					onClick={() => setRefresh(Date.now())}
					disabled={loading}
					variant="outline"
					className="gap-2 cursor-pointer"
				>
					<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
					Refresh
				</Button>
				<Button
					onClick={() => setShowAIWizard(true)}
					variant="outline"
					className="gap-2 cursor-pointer border-indigo-200 text-indigo-700 hover:bg-indigo-50"
				>
					<Sparkles className="h-4 w-4" />
					Create with AI
				</Button>
				<Button onClick={() => setShowCreateDialog(true)} className="gap-2 cursor-pointer">
					<Plus className="h-4 w-4" />
					Create
				</Button>
			</div>
			{loading && <Loading />}
			{!loading && strategies.length === 0 && (
				<EmptyData
					title="No forward testing strategies"
					buttonText="Create Forward Testing Strategy"
					ButtonIcon={Plus}
					buttonOnClick={() => setShowCreateDialog(true)}
				/>
			)}
			{!loading && strategies.length > 0 && (
				<div>
					<TooltipProvider>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Description</TableHead>
								<TableHead className="w-160 text-left">API Token</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Competition</TableHead>
								<TableHead>Create Time</TableHead>
								<TableHead>Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{strategies.map((strategy) => {
								const isVisible = visibleTokens[strategy.id] || false;
								return (
									<TableRow key={strategy.id}>
										<TableCell>{strategy.name}</TableCell>
										<TableCell>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="block max-w-[200px] truncate">{strategy.description}</span>
										</TooltipTrigger>
										<TooltipContent>{strategy.description}</TooltipContent>
									</Tooltip>
								</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<span className="font-mono text-sm ">
													{isVisible ? strategy.api_token : maskToken(strategy.api_token)}
												</span>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="h-6 w-6 p-0 hover:bg-transparent"
													onClick={() => toggleTokenVisibility(strategy.id)}
												>
													{isVisible ? (
														<EyeOff className="h-4 w-4 text-muted-foreground" />
													) : (
														<Eye className="h-4 w-4 text-muted-foreground" />
													)}
												</Button>
											</div>
										</TableCell>
										<TableCell>{strategy.status}</TableCell>
										<TableCell>
											<a
												href={`/competition/detail/${strategy.competition_id}`}
												className={
													strategy.status === 'Competing'
														? 'text-blue-500 hover:text-blue-600'
														: 'text-gray-500'
												}
												target="_blank"
											>
												{strategy.competition_name || '-'}
											</a>
										</TableCell>
										<TableCell>{formatDate(strategy.create_time)}</TableCell>
										<TableCell>
											<div className="flex items-center gap-3">
												<Tooltip>
													<TooltipTrigger asChild>
														<Microscope
															className="h-4 w-4 text-indigo-600 cursor-pointer hover:text-indigo-700"
															onClick={() => navigate(`/dashboard/quant/research/${strategy.id}`)}
														/>
													</TooltipTrigger>
													<TooltipContent>Research &amp; runs</TooltipContent>
												</Tooltip>
												<Tooltip>
													<TooltipTrigger asChild>
														<span>
															<Trash
																className={`h-4 w-4 ${
																	strategy.status === 'Competing'
																		? 'text-muted-foreground cursor-not-allowed opacity-50'
																		: 'text-destructive cursor-pointer'
																}`}
																onClick={() => {
																	if (strategy.status !== 'Competing') {
																		setDeleteTarget(strategy);
																	}
																}}
															/>
														</span>
													</TooltipTrigger>
													<TooltipContent>
														{strategy.status === 'Competing'
															? 'Cannot delete while competing'
															: 'Delete'}
													</TooltipContent>
												</Tooltip>
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
						<TableFooter>
							<TableRow>
								<TableCell colSpan={7}>
									<Pagination
										currentPage={pagination.currentPage}
										totalPages={pagination.totalPages}
										total={pagination.total}
										onPageChange={pagination.goToPage}
									/>
								</TableCell>
							</TableRow>
						</TableFooter>
					</Table>
					</TooltipProvider>
				</div>
			)}
			{showCreateDialog && (
				<NewSimulationStrategyDialog
					open={showCreateDialog}
					onOpenChange={setShowCreateDialog}
					onSuccess={handleCreateStrategySuccess}
				/>
			)}
			{showAIWizard && (
				<AIStrategyWizard
					open={showAIWizard}
					onOpenChange={setShowAIWizard}
					onCreated={() => setRefresh(Date.now())}
				/>
			)}
			{deleteTarget && (
				<ModalConfirm
					title="Are you sure?"
					description={`This will permanently delete the forward testing strategy "${deleteTarget.name}". This action cannot be undone.`}
					onConfirm={handleDelete}
					open={!!deleteTarget}
					onOpenChange={() => setDeleteTarget(null)}
				/>
			)}
		</div>
	);
};

export default SimulationStrategy;
