import React, { useEffect, useState } from 'react';
import { getTemplateList } from '../../api/template';
import type { TemplateInfo } from '../../api/types';
import { usePagination } from '../../hooks/usePagination';
import { PAGE_SIZE } from '../../lib/enum';
import { Table, TableCell, TableBody, TableHead, TableHeader, TableRow, TableFooter } from '../../components/ui/table';
import { formatDate } from '../../lib/utils';
import { Loading } from '../../components/ui/loading';
import EmptyData from '../../components/empty-data';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

const SystemTag = () => {
	const [systemTagsList, setSystemTagsList] = useState<TemplateInfo[]>([]);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [loading, setLoading] = useState(false);
	const [refresh, setRefresh] = useState<number>(Date.now());

	useEffect(() => {
		fetchSystemTags();
	}, [pagination.currentPage, refresh]);

	const fetchSystemTags = async () => {
		try {
			setLoading(true);
			const response = await getTemplateList({
				page: pagination.currentPage,
				page_size: pagination.pageSize,
				type: 'system',
			});
			setSystemTagsList(response.data.templates);
			pagination.setTotal(response.total);
		} catch (error) {
			console.error('Failed to fetch system tags:', error);
		} finally {
			setLoading(false);
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
				</div>
			</div>
			{loading && <Loading />}
			{!loading && !systemTagsList.length && <EmptyData title="No system templates yet" />}
			{systemTagsList.length > 0 && (
				<Table className="mt-4">
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Description</TableHead>
							<TableHead>Start Time</TableHead>
							<TableHead>End Time</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{systemTagsList.map((tag) => (
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
								<TableCell>{formatDate(tag.start_date)}</TableCell>
								<TableCell>{formatDate(tag.end_date)}</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableFooter>
						<TableRow>
							<TableCell colSpan={4}>
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
		</div>
	);
};

export default SystemTag;
