import React, { useEffect, useState } from 'react';
import { usePagination } from '../../hooks/usePagination';
import { PAGE_SIZE } from '../../lib/enum';
import { toast } from 'sonner';
import { ApiError } from '../../api';
import { getUniverses, getSymbols, createUniverse, deleteUniverse } from '../../api/datasource';
import { UniverseInfo } from '../../api/types';
import { Table, TableBody, TableCell, TableFooter, TableRow, TableHead, TableHeader } from '../../components/ui/table';
import { Pagination } from '../../components/ui/pagination';
import { Plus, RefreshCw, Earth, Eye, Trash } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/ui/loading';
import EmptyData from '../../components/empty-data';
import NewUniverseDialog from './new-universe-dialog';
import ModalConfirm from '../../components/modal-confirm';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { formatDate } from '../../lib/utils';

const Universe = () => {
	const [universesList, setUniversesList] = useState<UniverseInfo[]>([]);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [loading, setLoading] = useState(false);
	const [refresh, setRefresh] = useState<number>(Date.now());
	const [newUniverseDialogOpen, setNewUniverseDialogOpen] = useState(false);
	const [symbolsList, setSymbolsList] = useState<{ symbol: string; sid: string; name: string }[]>([]);
	const [selectedUniverse, setSelectedUniverse] = useState<UniverseInfo | null>(null);
	const [symbolsDialogOpen, setSymbolsDialogOpen] = useState(false);
	const [deleteUniverseTarget, setDeleteUniverseTarget] = useState<UniverseInfo | null>(null);

	useEffect(() => {
		fetchSymbols();
	}, []);

	const fetchSymbols = async () => {
		const response = await getSymbols();
		setSymbolsList(response.securities);
	};
	useEffect(() => {
		fetchUniverses();
	}, [refresh, pagination.currentPage]);

	const fetchUniverses = async () => {
		setLoading(true);
		try {
			const response = await getUniverses({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			});
			setUniversesList(response.data.universes);
			pagination.setTotal(response.total);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load universes');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	const handleCreateUniverseSuccess = async (data: {
		code: string;
		name: string;
		description: string;
		sids: string[];
	}) => {
		try {
			await createUniverse(data);
			setRefresh(Date.now());
			toast.success('Universe created successfully!');
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to create universe');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	const handleDeleteUniverse = async () => {
		if (!deleteUniverseTarget) return;
		try {
			await deleteUniverse(deleteUniverseTarget.id);
			toast.success('Universe deleted successfully');
			setDeleteUniverseTarget(null);
			setRefresh(Date.now());
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to delete universe');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		}
	};

	// 根据 sids 查找对应的 symbols
	const getSymbolsBySids = (sids: string[]) => {
		return sids.map((sid) => {
			const symbolInfo = symbolsList.find((s) => s.sid === sid);
			return {
				id: sid,
				symbol: symbolInfo?.symbol || sid,
			};
		});
	};

	const getFirstSymbolName = (sids: string[]) => {
		if (sids.length === 0) return '';
		const symbols = getSymbolsBySids(sids);
		return symbols[0]?.symbol || sids[0];
	};

	const handleSymbolsClick = (universe: UniverseInfo) => {
		setSelectedUniverse(universe);
		setSymbolsDialogOpen(true);
	};

	return (
		<div className="p-4">
			<div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
				<div>
					<h1 className="text-3xl font-bold">Universe</h1>
					<p className="text-muted-foreground">Manage Stock Universe</p>
				</div>
				<div className="flex items-center gap-4">
					<Button onClick={fetchUniverses} disabled={loading} variant="outline" className="gap-2">
						<RefreshCw
							className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
							onClick={() => setRefresh(Date.now())}
						/>
						Refresh
					</Button>
					<Button onClick={() => setNewUniverseDialogOpen(true)} className="gap-2 cursor-pointer">
						<Plus className="h-4 w-4" />
						Create
					</Button>
				</div>
			</div>
			{loading && universesList.length === 0 && (
				<div className="flex items-center justify-center">
					<Loading />
				</div>
			)}
			{!loading && universesList.length === 0 && (
				<EmptyData
					title="No universes yet"
					buttonText="Create Your First Universe"
					ButtonIcon={Earth}
					buttonOnClick={() => setNewUniverseDialogOpen(true)}
				/>
			)}
			{!loading && universesList.length > 0 && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Code</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Description</TableHead>
							<TableHead>Symbols</TableHead>
							<TableHead>Create Time</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{universesList.map((universe) => {
							const firstSymbol = getFirstSymbolName(universe.sids);
							const hasMore = universe.sids.length > 1;
							return (
								<TableRow key={universe.id}>
									<TableCell>{universe.code}</TableCell>
									<TableCell>{universe.name}</TableCell>
									<TableCell>{universe.description}</TableCell>
									<TableCell>
										{universe.sids.length === 0 ? (
											<span className="text-muted-foreground">-</span>
										) : (
											<div
												onClick={() => handleSymbolsClick(universe)}
												className="text-left hover:underline cursor-pointer flex items-center gap-1"
											>
												{hasMore && <Eye className="w-4 h-4 text-muted-foreground" />}
												{firstSymbol}
												{hasMore && <span className="text-muted-foreground">...</span>}
											</div>
										)}
									</TableCell>
									<TableCell>{formatDate(universe.create_time)}</TableCell>
									<TableCell>
										<Tooltip>
											<TooltipTrigger asChild>
												<Trash
													className="h-4 w-4 text-destructive cursor-pointer"
													onClick={() => setDeleteUniverseTarget(universe)}
												/>
											</TooltipTrigger>
											<TooltipContent>
												<p>Delete</p>
											</TooltipContent>
										</Tooltip>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
					<TableFooter>
						<TableRow>
							<TableCell colSpan={6}>
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
			{newUniverseDialogOpen && (
				<NewUniverseDialog
					open={newUniverseDialogOpen}
					onOpenChange={setNewUniverseDialogOpen}
					symbolsList={symbolsList}
					onCreateSuccess={handleCreateUniverseSuccess}
				/>
			)}
			{deleteUniverseTarget && (
				<ModalConfirm
					title="Are you sure?"
					description={`This will permanently delete the universe "${deleteUniverseTarget.name}" and remove it from QuantRocket. You will need to re-create if you want this data back. This action cannot be undone.`}
					onConfirm={handleDeleteUniverse}
					open={!!deleteUniverseTarget}
					onOpenChange={() => setDeleteUniverseTarget(null)}
				/>
			)}
			{selectedUniverse && (
				<Dialog open={symbolsDialogOpen} onOpenChange={setSymbolsDialogOpen}>
					<DialogContent className="max-w-2xl">
						<DialogHeader>
							<DialogTitle>Symbols - {selectedUniverse.name}</DialogTitle>
							<DialogDescription>
								Code: {selectedUniverse.code} | Total: {selectedUniverse.sids.length} symbols
							</DialogDescription>
						</DialogHeader>
						<div className="max-h-[60vh] overflow-y-auto">
							<div className="space-y-2">
								{getSymbolsBySids(selectedUniverse.sids).map((item) => (
									<div
										key={item.id}
										className="flex items-center justify-between p-3 rounded-md border bg-card"
									>
										<div className="flex flex-col gap-1">
											<span className="font-medium">{item.symbol}</span>
											<span className="text-sm text-muted-foreground">ID: {item.id}</span>
										</div>
									</div>
								))}
							</div>
						</div>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
};

export default Universe;
