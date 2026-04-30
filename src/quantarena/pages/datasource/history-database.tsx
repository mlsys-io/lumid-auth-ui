import React, { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { HistoryDatabaseInfo } from '../../api/types';
import { ApiError, getHistoryDatabases, createHistoryDatabase, ingestHistoryDatabase, deleteHistoryDatabase } from '../../api';
import { usePagination } from '../../hooks/usePagination';
import { PAGE_SIZE } from '../../lib/enum';
import { toast } from 'sonner';
import { Loading } from '../../components/ui/loading';
import { RefreshCw, Plus, Database, Download, Trash } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Button } from '../../components/ui/button';
import { Pagination } from '../../components/ui/pagination';
import EmptyData from '../../components/empty-data';
import NewHistoryDatabaseDialog from './new-history-database-dialog';
import ModalConfirm from '../../components/modal-confirm';
import { formatDate } from '../../lib/utils';

const HistoryDatabase = () => {
	const [historyDatabases, setHistoryDatabases] = useState<HistoryDatabaseInfo[]>([]);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [loading, setLoading] = useState(false);
	const [newHistoryDatabaseDialogOpen, setNewHistoryDatabaseDialogOpen] = useState(false);
	const [refresh, setRefresh] = useState<number>(Date.now());
	const [ingestLoading, setIngestLoading] = useState<Record<string, boolean>>({});
	const [deleteTarget, setDeleteTarget] = useState<HistoryDatabaseInfo | null>(null);

	useEffect(() => {
		fetchHistoryDatabases();
	}, [refresh, pagination.currentPage]);

	const fetchHistoryDatabases = async () => {
		setLoading(true);
		try {
			const response = await getHistoryDatabases({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			});
			setHistoryDatabases(response.data.history_databases);
			pagination.setTotal(response.total);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load strategies');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	const handleCreateSuccess = async (data: { code: string; name: string; description: string; vendor: string }) => {
		try {
			await createHistoryDatabase({
				code: data.code,
				name: data.name,
				description: data.description,
				vendor: data.vendor,
			});
			toast.success('History database created successfully!');
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to create history database');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteHistoryDatabase(deleteTarget.id);
			toast.success('History database deleted successfully');
			setDeleteTarget(null);
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to delete history database');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	const handleIngest = async (code: string) => {
		try {
			setIngestLoading((prev) => ({ ...prev, [code]: true }));
			await ingestHistoryDatabase(code);
			toast.success('History database ingested successfully!');
			setRefresh(Date.now());
		} catch (error) {
			setIngestLoading((prev) => ({ ...prev, [code]: false }));
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to ingest history database');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	return (
		<div className="p-4">
			<div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
				<div>
					<h1 className="text-3xl font-bold">History Database</h1>
					<p className="text-muted-foreground">Manage your history databases</p>
				</div>
				<div className="flex items-center gap-4">
					<Button
						onClick={fetchHistoryDatabases}
						disabled={loading}
						variant="outline"
						className="gap-2 cursor-pointer"
					>
						<RefreshCw
							className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
							onClick={() => setRefresh(Date.now())}
						/>
						Refresh
					</Button>
					<Button onClick={() => setNewHistoryDatabaseDialogOpen(true)} className="gap-2 cursor-pointer">
						<Plus className="h-4 w-4" />
						Create
					</Button>
				</div>
			</div>
			{loading && historyDatabases.length === 0 && (
				<div className="flex items-center justify-center">
					<Loading />
				</div>
			)}
			{!loading && historyDatabases.length === 0 && (
				<EmptyData
					title="No history databases yet"
					buttonText="Create Your First History Database"
					ButtonIcon={Database}
					buttonOnClick={() => setNewHistoryDatabaseDialogOpen(true)}
				/>
			)}
			{!loading && historyDatabases.length > 0 && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Description</TableHead>
							<TableHead>Vendor</TableHead>
							<TableHead>Ingest Status</TableHead>
							<TableHead>Create Time</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{historyDatabases.map((historyDatabase) => (
							<TableRow key={historyDatabase.id}>
								<TableCell>{historyDatabase.code}</TableCell>
								<TableCell>{historyDatabase.name}</TableCell>
								<TableCell>{historyDatabase.description}</TableCell>
								<TableCell>{historyDatabase.vendor}</TableCell>
								<TableCell>
									<Badge
										variant="outline"
										className={
											historyDatabase.ingest_status === 'Completed'
												? 'border-green-500 text-green-600 bg-green-50'
												: 'border-yellow-500 text-yellow-600 bg-yellow-50'
										}
									>
										{historyDatabase.ingest_status}
									</Badge>
								</TableCell>
								<TableCell>{formatDate(historyDatabase.create_time)}</TableCell>
								<TableCell>
									<div className="flex items-center gap-1">
										{historyDatabase.ingest_status !== 'Completed' && (
											<Button
												onClick={() => handleIngest(historyDatabase.code)}
												className="gap-1 cursor-pointer"
												variant="secondary"
												disabled={ingestLoading[historyDatabase.code]}
											>
												<Download
													className={`h-4 w-4 ${ingestLoading[historyDatabase.code] ? 'animate-spin' : ''}`}
												/>
												{ingestLoading[historyDatabase.code] ? 'Ingesting...' : 'Ingest'}
											</Button>
										)}
										<Tooltip>
											<TooltipTrigger asChild>
												<Trash
													className="h-4 w-4 text-destructive cursor-pointer"
													onClick={() => setDeleteTarget(historyDatabase)}
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
			)}
			{newHistoryDatabaseDialogOpen && (
				<NewHistoryDatabaseDialog
					open={newHistoryDatabaseDialogOpen}
					onOpenChange={setNewHistoryDatabaseDialogOpen}
					onCreateSuccess={handleCreateSuccess}
				/>
			)}
			{deleteTarget && (
				<ModalConfirm
					title="Are you sure?"
					description={`This will permanently delete the history database "${deleteTarget.name}" and remove all ingested data from QuantRocket. You will need to re-create and re-ingest if you want this data back. This action cannot be undone.`}
					onConfirm={handleDelete}
					open={!!deleteTarget}
					onOpenChange={() => setDeleteTarget(null)}
				/>
			)}
		</div>
	);
};

export default HistoryDatabase;
