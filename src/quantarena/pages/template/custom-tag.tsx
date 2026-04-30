import React, { useEffect, useState } from 'react';
import { getTemplateList, getMarkets } from '../../api/template';
import { usePagination } from '../../hooks/usePagination';
import { TemplateInfo, MarketInfo } from '../../api/types';
import { PAGE_SIZE } from '../../lib/enum';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { formatDate } from '../../lib/utils';
import { Loading } from '../../components/ui/loading';
import EmptyData from '../../components/empty-data';
import { LayoutTemplate, Plus, RefreshCw, Trash, SquarePen } from 'lucide-react';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { createCustomTag, updateCustomTag, deleteCustomTag } from '../../api/template';
import { toast } from 'sonner';
import EditCustomTagDialog from './edit-custom-tag-dialog';
import ModalConfirm from '../../components/modal-confirm';

const CustomTag = () => {
	const [customTagsList, setCustomTagsList] = useState<TemplateInfo[]>([]);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [loading, setLoading] = useState(false);
	const [refresh, setRefresh] = useState<number>(Date.now());
	const [newCustomTagDialogOpen, setNewCustomTagDialogOpen] = useState(false);
	const [newCustomTagDialogData, setNewCustomTagDialogData] = useState<TemplateInfo | undefined>(undefined);
	const [deleteCustomTagDialogOpen, setDeleteCustomTagDialogOpen] = useState<number>(0);
	const [markets, setMarkets] = useState<MarketInfo[]>([]);

	useEffect(() => {
		fetchCustomTags();
	}, [refresh, pagination.currentPage]);

	useEffect(() => {
		fetchMarkets();
	}, []);

	const fetchMarkets = async () => {
		try {
			const marketList = await getMarkets();
			setMarkets(marketList);
		} catch (error) {
			console.error('Failed to fetch markets:', error);
		}
	};

	const getMarketName = (marketId?: number) => {
		if (!marketId) return '-';
		const market = markets.find((m) => m.id === marketId);
		return market?.name || '-';
	};

	const fetchCustomTags = async () => {
		try {
			setLoading(true);
			const response = await getTemplateList({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
				type: 'custom',
			});
			setCustomTagsList(response.data.templates || []);
			pagination.setTotal(response.total);
		} catch (error) {
			console.error('Failed to fetch custom tags:', error);
		} finally {
			setLoading(false);
		}
	};

	const handleDeleteCustomTag = async () => {
		try {
			await deleteCustomTag(deleteCustomTagDialogOpen);
			toast.success('Custom tag deleted successfully!');
			setRefresh(Date.now());
			setDeleteCustomTagDialogOpen(0);
		} catch (error) {
			console.error('Failed to delete custom tag:', error);
			toast.error('Failed to delete custom tag');
		}
	};

	const handleEditCustomTag = async (data: TemplateInfo) => {
		setNewCustomTagDialogData(data);
		setNewCustomTagDialogOpen(true);
	};

	const handleOpenCreateDialog = () => {
		// 新建时清空之前编辑时保留的 data，避免表单回显旧数据
		setNewCustomTagDialogData(undefined);
		setNewCustomTagDialogOpen(true);
	};

	const handleCreateCustomTag = async (data: TemplateInfo) => {
		const { id, ...rest } = data;
		try {
			if (id) {
				await updateCustomTag(id, rest);
			} else {
				await createCustomTag(rest);
			}
			setRefresh(Date.now());
			setNewCustomTagDialogOpen(false);
			setNewCustomTagDialogData(undefined);
			toast.success(`Custom tag ${id ? 'updated' : 'created'} successfully`);
		} catch (error) {
			console.error('Failed to create custom tag:', error);
			toast.error('Failed to create custom tag');
		}
	};

	return (
		<div>
			<div className="flex items-center justify-end mb-6">
				<div className="flex items-center gap-4">
					<Button
						onClick={() => setRefresh(Date.now())}
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
					<Button onClick={handleOpenCreateDialog} className="gap-2 cursor-pointer">
						<Plus className="h-4 w-4" />
						Create
					</Button>
				</div>
			</div>
			{loading && <Loading />}
			{!loading && !customTagsList.length && (
				<EmptyData
					title="No custom template yet"
					description="Create your first custom template to get started"
					buttonText="Create Custom Template"
					ButtonIcon={LayoutTemplate}
					buttonOnClick={handleOpenCreateDialog}
				/>
			)}
			{customTagsList.length > 0 && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Description</TableHead>
							<TableHead>Market</TableHead>
							<TableHead>Start Time</TableHead>
							<TableHead>End Time</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{customTagsList.map((tag) => (
							<TableRow key={tag.id}>
								<TableCell>
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="text-ellipsis overflow-hidden max-w-[100px]">
												{tag.name}
											</div>
										</TooltipTrigger>
										<TooltipContent>
											<p>{tag.name}</p>
										</TooltipContent>
									</Tooltip>
								</TableCell>
								<TableCell>
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="text-ellipsis overflow-hidden max-w-[200px]">
												{tag.description}
											</div>
										</TooltipTrigger>
										<TooltipContent>
											<p>{tag.description}</p>
										</TooltipContent>
									</Tooltip>
								</TableCell>
								<TableCell>{getMarketName(tag.market_id)}</TableCell>
								<TableCell>{formatDate(tag.start_date)}</TableCell>
								<TableCell>{formatDate(tag.end_date)}</TableCell>
								<TableCell className="flex items-center">
									<Tooltip>
										<TooltipTrigger asChild>
											<Trash
												className="h-4 w-4 text-destructive cursor-pointer mr-2"
												onClick={() => setDeleteCustomTagDialogOpen(tag.id)}
											/>
										</TooltipTrigger>
										<TooltipContent>
											<p>Delete</p>
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<SquarePen
												className="h-4 w-4 text-indigo-500 cursor-pointer"
												onClick={() => handleEditCustomTag(tag)}
											/>
										</TooltipTrigger>
										<TooltipContent>
											<p>Edit</p>
										</TooltipContent>
									</Tooltip>
								</TableCell>
							</TableRow>
						))}
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
			{newCustomTagDialogOpen && (
				<EditCustomTagDialog
					open={newCustomTagDialogOpen}
					onOpenChange={(open) => {
						setNewCustomTagDialogOpen(open);
						if (!open) {
							// 关闭弹窗时清空 data，防止下一次新建时仍然带入旧数据
							setNewCustomTagDialogData(undefined);
						}
					}}
					onSuccess={handleCreateCustomTag}
					data={newCustomTagDialogData}
				/>
			)}
			{!!deleteCustomTagDialogOpen && (
				<ModalConfirm
					title="Are you sure?"
					description={`This will permanently delete the custom template "${customTagsList.find((tag) => tag.id === deleteCustomTagDialogOpen)?.name}". This action cannot be undone.`}
					onConfirm={handleDeleteCustomTag}
					open={!!deleteCustomTagDialogOpen}
					onOpenChange={() => setDeleteCustomTagDialogOpen(0)}
				/>
			)}
		</div>
	);
};

export default CustomTag;
