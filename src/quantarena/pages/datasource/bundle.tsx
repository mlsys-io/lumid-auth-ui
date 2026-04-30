import React, { useState, useEffect } from 'react';
import { BundleInfo } from '../../api/types';
import { PAGE_SIZE } from '../../lib/enum';
import { usePagination } from '../../hooks/usePagination';
import { toast } from 'sonner';
import { ApiError } from '../../api';
import { createBundle, getBundles, ingestBundle, deleteBundle } from '../../api/datasource';
import { Button } from '../../components/ui/button';
import { Download, Plus, RefreshCw, Package, Trash } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Loading } from '../../components/ui/loading';
import EmptyData from '../../components/empty-data';
import { TableBody, TableCell, TableHead, TableHeader, Table, TableRow, TableFooter } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Pagination } from '../../components/ui/pagination';
import { INGEST_TYPE_OPTIONS } from '../../lib/enum';
import NewBundleDialog from './new-bundle-dialog';
import ModalConfirm from '../../components/modal-confirm';
import { formatDate } from '../../lib/utils';

const Bundle = () => {
	const [bundlesList, setBundlesList] = useState<BundleInfo[]>([]);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [loading, setLoading] = useState(false);
	const [refresh, setRefresh] = useState<number>(Date.now());
	const [newBundleDialogOpen, setNewBundleDialogOpen] = useState(false);
	const [ingestLoading, setIngestLoading] = useState<Record<string, boolean>>({});
	const [deleteBundleTarget, setDeleteBundleTarget] = useState<BundleInfo | null>(null);
	// const [universesList, setUniversesList] = useState<UniverseInfo[]>([]);

	useEffect(() => {
		fetchBundles();
	}, [refresh, pagination.currentPage]);

	// useEffect(() => {
	// 	fetchUniverses();
	// }, []);

	// const fetchUniverses = async () => {
	// 	const response = await getUniverses({
	// 		page: 1,
	// 		page_size: 9999,
	// 	});
	// 	setUniversesList(response.data.universes as unknown as UniverseInfo[]);
	// };

	const fetchBundles = async () => {
		setLoading(true);
		try {
			const response = await getBundles({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			});
			setBundlesList(response.data.bundles as unknown as BundleInfo[]);
			pagination.setTotal(response.total);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load bundles');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	const handleIngest = async (code: string) => {
		try {
			setIngestLoading((prev) => ({ ...prev, [code]: true }));
			await ingestBundle(code);
			toast.success('Ingested bundle successfully');
			setRefresh(Date.now());
		} catch {
			setIngestLoading((prev) => ({ ...prev, [code]: false }));
			toast.error('Failed to ingest bundle');
		}
	};

	const handleDeleteBundle = async () => {
		if (!deleteBundleTarget) return;
		try {
			await deleteBundle(deleteBundleTarget.id);
			toast.success('Bundle deleted successfully');
			setDeleteBundleTarget(null);
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to delete bundle');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	const handleCreateBundleSuccess = async (data: {
		code: string;
		name: string;
		description: string;
		ingest_type: string;
		//	universe_code: string;
	}) => {
		try {
			await createBundle(data);
			toast.success('Bundle created successfully');
			fetchBundles();
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to create bundle');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	return (
		<div className="p-4">
			<div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
				<div>
					<h1 className="text-3xl font-bold">Bundle</h1>
					<p className="text-muted-foreground">Data Package Configuration</p>
				</div>
				<div className="flex items-center gap-4">
					<Button onClick={fetchBundles} disabled={loading} variant="outline" className="gap-2">
						<RefreshCw
							className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
							onClick={() => setRefresh(Date.now())}
						/>
						Refresh
					</Button>
					<Button onClick={() => setNewBundleDialogOpen(true)} className="gap-2 cursor-pointer">
						<Plus className="h-4 w-4" />
						Create
					</Button>
				</div>
			</div>
			{loading && bundlesList.length === 0 && (
				<div className="flex items-center justify-center">
					<Loading />
				</div>
			)}
			{!loading && bundlesList.length === 0 && (
				<EmptyData
					title="No bundle yet"
					buttonText="Create Your First Bundle"
					ButtonIcon={Package}
					buttonOnClick={() => setNewBundleDialogOpen(true)}
				/>
			)}
			{!loading && bundlesList.length > 0 && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Description</TableHead>
							<TableHead>Ingest Type</TableHead>
							{/* <TableHead>Universe</TableHead> */}
							<TableHead>Ingest Status</TableHead>
							<TableHead>Create Time</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{bundlesList.map((bundle) => {
							return (
								<TableRow key={bundle.id}>
									<TableCell>{bundle.code}</TableCell>
									<TableCell>{bundle.name}</TableCell>
									<TableCell>{bundle.description}</TableCell>
									<TableCell>
										{INGEST_TYPE_OPTIONS.find((option) => option.value === bundle.ingest_type)
											?.label || '-'}
									</TableCell>
									{/* <TableCell>
										{universesList.find((universe) => universe.code === bundle.universe_code)
											?.name ||
											bundle.universe_code ||
											'-'}
									</TableCell> */}
									<TableCell>
										<Badge
											variant="outline"
											className={
												bundle.ingest_status === 'Completed'
													? 'border-green-500 text-green-600 bg-green-50'
													: 'border-yellow-500 text-yellow-600 bg-yellow-50'
											}
										>
											{bundle.ingest_status}
										</Badge>
									</TableCell>
									<TableCell>{formatDate(bundle.create_time)}</TableCell>
									<TableCell>
										<div className="flex items-center gap-1">
											{bundle.ingest_status !== 'Completed' && (
												<Button
													onClick={() => handleIngest(bundle.code)}
													className="gap-1 cursor-pointer"
													variant="secondary"
													disabled={ingestLoading[bundle.code]}
												>
													<Download
														className={`h-4 w-4 ${ingestLoading[bundle.code] ? 'animate-spin' : ''}`}
													/>
													{ingestLoading[bundle.code] ? 'Ingesting...' : 'Ingest'}
												</Button>
											)}
											<Tooltip>
												<TooltipTrigger asChild>
													<Trash
														className="h-4 w-4 text-destructive cursor-pointer"
														onClick={() => setDeleteBundleTarget(bundle)}
													/>
												</TooltipTrigger>
												<TooltipContent>
													<p>Delete</p>
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
			)}
			{newBundleDialogOpen && (
				<NewBundleDialog
					open={newBundleDialogOpen}
					onOpenChange={setNewBundleDialogOpen}
					onCreateSuccess={handleCreateBundleSuccess}
					// universesList={universesList}
				/>
			)}
			{deleteBundleTarget && (
				<ModalConfirm
					title="Are you sure?"
					description={`This will permanently delete the bundle "${deleteBundleTarget.name}" and remove all ingested data from QuantRocket. You will need to re-create and re-ingest if you want this data back. This action cannot be undone.`}
					onConfirm={handleDeleteBundle}
					open={!!deleteBundleTarget}
					onOpenChange={() => setDeleteBundleTarget(null)}
				/>
			)}
		</div>
	);
};

export default Bundle;
