import React, { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import type { FreqTradeDatasetInfo } from '../../api/types';
import { ApiError, getFreqTradeDatasets, downloadFreqTradeData, deleteFreqTradeDataset } from '../../api';
import { usePagination } from '../../hooks/usePagination';
import { PAGE_SIZE, DOWNLOAD_STATUS_STYLES, DownloadStatus } from '../../lib/enum';
import { toast } from 'sonner';
import { Loading } from '../../components/ui/loading';
import { RefreshCw, Plus, Database, Download, Trash } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Button } from '../../components/ui/button';
import { Pagination } from '../../components/ui/pagination';
import EmptyData from '../../components/empty-data';
import NewFreqTradeDatasetDialog from './new-freqtrade-dataset-dialog';
import ModalConfirm from '../../components/modal-confirm';
import { formatDate } from '../../lib/utils';

const FreqTradeDataset = () => {
	const [datasets, setDatasets] = useState<FreqTradeDatasetInfo[]>([]);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [loading, setLoading] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [refresh, setRefresh] = useState<number>(Date.now());
	const [downloadLoading, setDownloadLoading] = useState<Record<number, boolean>>({});
	const [deleteTarget, setDeleteTarget] = useState<FreqTradeDatasetInfo | null>(null);

	useEffect(() => {
		fetchDatasets();
	}, [refresh, pagination.currentPage]);

	const fetchDatasets = async () => {
		setLoading(true);
		try {
			const response = await getFreqTradeDatasets({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			});
			setDatasets(response.data.datasets);
			pagination.setTotal(response.total);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load datasets');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	const handleDownload = async (datasetId: number) => {
		try {
			setDownloadLoading((prev) => ({ ...prev, [datasetId]: true }));
			await downloadFreqTradeData({ dataset_id: datasetId });
			toast.success('Data download triggered successfully!');
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to trigger download');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setDownloadLoading((prev) => ({ ...prev, [datasetId]: false }));
		}
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteFreqTradeDataset(deleteTarget.id);
			toast.success('Dataset deleted successfully');
			setDeleteTarget(null);
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to delete dataset');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	return (
		<div className="p-4">
			<div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
				<div>
					<h1 className="text-3xl font-bold">FreqTrade Data</h1>
					<p className="text-muted-foreground">Manage cryptocurrency market data for FreqTrade backtesting</p>
				</div>
				<div className="flex items-center gap-4">
					<Button
						onClick={fetchDatasets}
						disabled={loading}
						variant="outline"
						className="gap-2 cursor-pointer"
					>
						<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
						Refresh
					</Button>
					<Button onClick={() => setDialogOpen(true)} className="gap-2 cursor-pointer">
						<Plus className="h-4 w-4" />
						Create
					</Button>
				</div>
			</div>
			{loading && datasets.length === 0 && (
				<div className="flex items-center justify-center">
					<Loading />
				</div>
			)}
			{!loading && datasets.length === 0 && (
				<EmptyData
					title="No FreqTrade datasets yet"
					buttonText="Create Your First Dataset"
					ButtonIcon={Database}
					buttonOnClick={() => setDialogOpen(true)}
				/>
			)}
			{!loading && datasets.length > 0 && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Exchange</TableHead>
							<TableHead>Pairs</TableHead>
							<TableHead>Timeframe</TableHead>
							<TableHead>Date Range</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{datasets.map((dataset) => (
							<TableRow key={dataset.id}>
								<TableCell>
									<div>
										<p className="font-medium">{dataset.name}</p>
										{dataset.description && (
											<p className="text-sm text-muted-foreground truncate max-w-xs">
												{dataset.description}
											</p>
										)}
									</div>
								</TableCell>
								<TableCell className="capitalize">{dataset.exchange}</TableCell>
								<TableCell>
									<div className="flex flex-wrap gap-1 max-w-xs">
										{dataset.pairs.slice(0, 3).map((pair) => (
											<Badge key={pair} variant="outline" className="text-xs">
												{pair}
											</Badge>
										))}
										{dataset.pairs.length > 3 && (
											<Badge variant="outline" className="text-xs">
												+{dataset.pairs.length - 3} more
											</Badge>
										)}
									</div>
								</TableCell>
								<TableCell>{dataset.timeframe}</TableCell>
								<TableCell>
									{dataset.start_date && dataset.end_date
										? `${dataset.start_date} - ${dataset.end_date}`
										: 'All available'}
								</TableCell>
								<TableCell>
									<Badge
										variant="outline"
										className={
											DOWNLOAD_STATUS_STYLES[dataset.download_status as DownloadStatus] || ''
										}
									>
										{dataset.download_status}
									</Badge>
								</TableCell>
								<TableCell>{formatDate(dataset.create_time)}</TableCell>
								<TableCell>
									<div className="flex items-center gap-1">
										{dataset.download_status !== 'Completed' && (
											<Button
												onClick={() => handleDownload(dataset.id)}
												className="gap-1 cursor-pointer"
												variant="secondary"
												size="sm"
												disabled={downloadLoading[dataset.id]}
											>
												<Download
													className={`h-4 w-4 ${downloadLoading[dataset.id] ? 'animate-spin' : ''}`}
												/>
												{downloadLoading[dataset.id] ? 'Downloading...' : 'Download'}
											</Button>
										)}
										<Tooltip>
											<TooltipTrigger asChild>
												<Trash
													className="h-4 w-4 text-destructive cursor-pointer"
													onClick={() => setDeleteTarget(dataset)}
												/>
											</TooltipTrigger>
											<TooltipContent>
												<p>Delete</p>
											</TooltipContent>
										</Tooltip>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableFooter>
						<TableRow>
							<TableCell colSpan={8}>
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
			)}
			{dialogOpen && (
				<NewFreqTradeDatasetDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					onCreateSuccess={() => setRefresh(Date.now())}
				/>
			)}
			{deleteTarget && (
				<ModalConfirm
					title="Are you sure?"
					description={`This will permanently delete the dataset "${deleteTarget.name}". This action cannot be undone.`}
					onConfirm={handleDelete}
					open={!!deleteTarget}
					onOpenChange={() => setDeleteTarget(null)}
				/>
			)}
		</div>
	);
};

export default FreqTradeDataset;
