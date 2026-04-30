import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { Pagination } from '../../components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { CodePreviewDialog } from './code-preview-dialog';
import { UploadStrategyDialog } from './upload-strategy-dialog';
import { EditStrategyDialog } from './edit-strategy-dialog';
import { VersionHistoryDialog } from './version-history-dialog';
import { DeleteStrategyDialog } from './delete-strategy-dialog';
import { CreateBacktestDialog } from '../backtesting/create-backtest-dialog';
import { toast } from 'sonner';
import { Upload, MoreVertical, ListTree, Edit, Code, Trash2, FileDown, PlayCircle, RefreshCw, X } from 'lucide-react';
import { Loading } from '../../components/ui/loading';
import { getStrategies, getStrategyVersions, exportStrategyCode, ApiError, getBundles } from '../../api';
import type { BundleInfo, StrategyInfo, StrategyVersionInfo } from '../../api';
import { PAGE_SIZE, FILTER_ALL, FRAMEWORK_OPTIONS, VISIBILITY_OPTIONS } from '../../lib/enum';
import { usePagination } from '../../hooks/usePagination';
import { useFileDownload } from '../../hooks/useFileDownload';
import EmptyData from '../../components/empty-data';
import { getTemplateList } from '../../api/template';
import { TemplateInfo } from '../../api/types';
import { getFrameworkColor } from '../../lib/tag-colors';
import { formatDate } from '../../lib/utils';

// Memoized table row component
const StrategyTableRow = memo(function StrategyTableRow({
	strategy,
	onViewCode,
	onBacktest,
	onViewVersions,
	onEdit,
	onExport,
	onDelete,
	bundleList,
}: {
	strategy: StrategyInfo;
	onViewCode: (strategy: StrategyInfo) => void;
	onBacktest: (strategy: StrategyInfo) => void;
	onViewVersions: (strategy: StrategyInfo) => void;
	onEdit: (strategy: StrategyInfo) => void;
	onExport: (strategy: StrategyInfo) => void;
	onDelete: (strategy: StrategyInfo) => void;
	bundleList: BundleInfo[];
}) {
	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{strategy.name}</span>
				</div>
			</TableCell>
			<TableCell>
				<Tooltip>
					<TooltipTrigger asChild>
						<p className="text-sm text-muted-foreground truncate cursor-default text-ellipsis overflow-hidden max-w-[150px]">
							{strategy.description}
						</p>
					</TooltipTrigger>
					<TooltipContent side="top" className="max-w-xs whitespace-pre-line" sideOffset={5}>
						{strategy.description}
					</TooltipContent>
				</Tooltip>
			</TableCell>
			{/* <TableCell>
				<div className="flex flex-wrap gap-1">
					{strategy.templates.map((template) => {
						return (
							<span
								key={template.id}
								className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors ${getTagColor(template.name)}`}
							>
								{template.name}
							</span>
						);
					})}
				</div>
			</TableCell> */}
			<TableCell>
				<span
					className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors ${getFrameworkColor(strategy.framework)}`}
				>
					{strategy.framework}
				</span>
			</TableCell>
			<TableCell>
				<span className="text-sm">
					{bundleList.find((bundle) => bundle.code === strategy.bundle_code)?.name}
				</span>
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-1">
					<span className="text-sm">{strategy.visibility}</span>
				</div>
			</TableCell>
			<TableCell>
				<span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium">
					v{strategy.current_version}
				</span>
			</TableCell>
			<TableCell>
				<span className="text-sm">{formatDate(strategy.create_time)}</span>
			</TableCell>
			<TableCell className="text-right">
				<div className="inline-flex rounded-md shadow-sm" role="group">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								onClick={() => onViewCode(strategy)}
								className="rounded-none border-r-0"
							>
								<Code className="w-4 h-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Edit Code</p>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								onClick={() => onBacktest(strategy)}
								className="rounded-none"
							>
								<PlayCircle className="w-4 h-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Create Backtest</p>
						</TooltipContent>
					</Tooltip>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="sm" className="rounded-none">
								<MoreVertical className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48">
							<DropdownMenuItem onClick={() => onViewVersions(strategy)}>
								<ListTree className="mr-2 h-4 w-4" />
								Versions
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => onEdit(strategy)}>
								<Edit className="mr-2 h-4 w-4" />
								Edit
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => onExport(strategy)}>
								<FileDown className="mr-2 h-4 w-4" />
								Export
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => onDelete(strategy)} className="text-destructive">
								<Trash2 className="mr-2 h-4 w-4 text-destructive" />
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</TableCell>
		</TableRow>
	);
});

export const BacktestingStrategy = memo(function BacktestingStrategy() {
	const navigate = useNavigate();
	const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [frameworkFilter, setFrameworkFilter] = useState<string>(FILTER_ALL);
	const [visibilityFilter, setVisibilityFilter] = useState<string>(FILTER_ALL);
	const [templateList, setTemplateList] = useState<TemplateInfo[]>([]);
	const [bundleList, setBundleList] = useState<BundleInfo[]>([]);

	// Use pagination hook
	const pagination = usePagination({ pageSize: PAGE_SIZE });

	// Use file download hook
	const { download } = useFileDownload();

	// Dialog states
	const [showUploadDialog, setShowUploadDialog] = useState(false);
	const [showEditDialog, setShowEditDialog] = useState(false);
	const [showVersionDialog, setShowVersionDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [showCodePreview, setShowCodePreview] = useState(false);
	const [showBacktestDialog, setShowBacktestDialog] = useState(false);

	// Selected strategy
	const [selectedStrategy, setSelectedStrategy] = useState<StrategyInfo | null>(null);
	const [selectedVersions, setSelectedVersions] = useState<StrategyVersionInfo[]>([]);

	const [codePreviewData, setCodePreviewData] = useState({
		strategyId: 0,
		strategyName: '',
		versionId: 0,
		code: '',
	});

	useEffect(() => {
		fetchTemplateList();
		fetchBundleList();
	}, []);

	const fetchTemplateList = useCallback(async () => {
		const response = await getTemplateList({ type: 'all', page: 1, page_size: 9999 });
		setTemplateList(response.data.templates);
	}, []);
	const fetchBundleList = async () => {
		try {
			const response = await getBundles({ page: 1, page_size: 9999 });
			setBundleList(response.data.bundles);
		} catch {
			toast.error('Failed to fetch bundle list');
		}
	};
	// Check if any filter is active
	const hasActiveFilters = useMemo(
		() => frameworkFilter !== FILTER_ALL || visibilityFilter !== FILTER_ALL,
		[frameworkFilter, visibilityFilter]
	);

	const fetchStrategies = useCallback(async () => {
		setLoading(true);
		try {
			const response = await getStrategies({
				page: pagination.currentPage,
				page_size: PAGE_SIZE,
				framework: frameworkFilter !== FILTER_ALL ? [frameworkFilter] : undefined,
				visibility: visibilityFilter !== FILTER_ALL ? [visibilityFilter] : undefined,
			});
			setStrategies(response.data.strategies);
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
	}, [frameworkFilter, visibilityFilter, pagination.currentPage, pagination.setTotal]);

	// Fetch strategies when filters change
	useEffect(() => {
		fetchStrategies();
	}, [fetchStrategies]);

	const handleViewVersions = useCallback(async (strategy: StrategyInfo) => {
		setSelectedStrategy(strategy);
		setLoading(true);

		try {
			const response = await getStrategyVersions(strategy.id);
			setSelectedVersions(response.versions);
			setShowVersionDialog(true);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load versions');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	}, []);

	const handleEditStrategy = useCallback((strategy: StrategyInfo) => {
		setSelectedStrategy(strategy);
		setShowEditDialog(true);
	}, []);

	const handleViewCode = useCallback(async (strategy: StrategyInfo, version?: StrategyVersionInfo) => {
		setLoading(true);
		try {
			if (version) {
				setCodePreviewData({
					strategyId: strategy.id,
					strategyName: strategy.name,
					versionId: version.version,
					code: version.code_text,
				});
			} else {
				const versionsData = await getStrategyVersions(strategy.id);
				const latestVersion = versionsData.versions.find((v) => v.version === strategy.current_version);
				setCodePreviewData({
					strategyId: strategy.id,
					strategyName: strategy.name,
					versionId: strategy.current_version,
					code: latestVersion?.code_text || '',
				});
			}
			setShowCodePreview(true);
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to load code');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	}, []);

	const handleExport = useCallback(
		(strategy: StrategyInfo) => {
			download(() => exportStrategyCode(strategy.id), `${strategy.name}_v${strategy.current_version}.py`, {
				successMessage: 'Strategy exported successfully!',
			});
		},
		[download]
	);

	const handleBacktestClick = useCallback((strategy: StrategyInfo) => {
		setSelectedStrategy(strategy);
		setShowBacktestDialog(true);
	}, []);

	const handleDeleteClick = useCallback((strategy: StrategyInfo) => {
		setSelectedStrategy(strategy);
		setShowDeleteDialog(true);
	}, []);

	const handleFrameworkChange = useCallback(
		(value: string) => {
			setFrameworkFilter(value);
			pagination.resetPage();
		},
		[pagination.resetPage]
	);

	const handleVisibilityChange = useCallback(
		(value: string) => {
			setVisibilityFilter(value);
			pagination.resetPage();
		},
		[pagination.resetPage]
	);

	const handleClearFilters = useCallback(() => {
		setFrameworkFilter(FILTER_ALL);
		setVisibilityFilter(FILTER_ALL);
	}, []);

	const handleOpenUploadDialog = useCallback(() => setShowUploadDialog(true), []);

	const handleBacktestSuccess = useCallback(() => {
		toast.success('Backtest created successfully');
		navigate('/dashboard/quant/backtesting');
	}, [navigate]);

	return (
		<TooltipProvider>
			<div className="space-y-8">
				{/* Header */}
				<div className="flex items-center justify-end">
					<div className="flex items-center gap-2">
						<Button
							onClick={fetchStrategies}
							disabled={loading}
							variant="outline"
							className="gap-2 cursor-pointer"
						>
							<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
							Refresh
						</Button>
						<Button onClick={handleOpenUploadDialog} className="gap-2 cursor-pointer">
							<Upload className="h-4 w-4" />
							Create Strategy
						</Button>
					</div>
				</div>

				{/* Main Content */}
				<div className="space-y-6">
					{/* Filters */}
					<div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 p-3 rounded-lg border">
						<div className="flex items-center gap-2 w-full md:w-auto">
							<label className="text-sm font-medium text-muted-foreground shrink-0">Framework:</label>
							<Select value={frameworkFilter} onValueChange={handleFrameworkChange}>
								<SelectTrigger className="w-full md:w-[180px]">
									<SelectValue placeholder="Select framework" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={FILTER_ALL}>All Frameworks</SelectItem>
									{FRAMEWORK_OPTIONS.map((framework) => (
										<SelectItem key={framework} value={framework}>
											{framework}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="h-px w-full md:h-6 md:w-px md:bg-border bg-border" />

						<div className="flex items-center gap-2 w-full md:w-auto">
							<label className="text-sm font-medium text-muted-foreground shrink-0">Visibility:</label>
							<Select value={visibilityFilter} onValueChange={handleVisibilityChange}>
								<SelectTrigger className="w-full md:w-[180px]">
									<SelectValue placeholder="Select visibility" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={FILTER_ALL}>All Visibility</SelectItem>
									{VISIBILITY_OPTIONS.map((visibility) => (
										<SelectItem key={visibility} value={visibility}>
											{visibility}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{hasActiveFilters && (
							<>
								<div className="h-px w-full md:h-6 md:w-px md:bg-border bg-border" />
								<Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-7 text-xs w-full md:w-auto justify-center md:justify-start">
									<X className="w-3 h-3 mr-1" />
									Clear All
								</Button>
							</>
						)}
					</div>

					{/* Loading State */}
					{loading && strategies.length === 0 && <Loading text="Loading strategies..." />}

					{/* Strategy Table */}
					{!loading && strategies.length === 0 ? (
						<EmptyData
							title="No strategies yet"
							description="Get started by uploading your first trading strategy. You can create strategies using Moonshot or Zipline framework."
							buttonText="Create Your First Strategy"
							ButtonIcon={Upload}
							buttonOnClick={handleOpenUploadDialog}
						/>
					) : (
						<div className="border rounded-lg overflow-hidden">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="w-[150px]">Name</TableHead>
											<TableHead className="w-[150px]">Description</TableHead>
											{/* <TableHead className="w-[200px]">Templates</TableHead> */}
											<TableHead className="w-[120px]">Framework</TableHead>
											<TableHead className="w-[120px]">Bundle</TableHead>
											<TableHead className="w-[100px]">Visibility</TableHead>
											<TableHead className="w-[100px]">Version</TableHead>
											<TableHead className="w-[100px]">Create Time</TableHead>
											<TableHead className="w-[120px] text-right">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{strategies.map((strategy) => (
											<StrategyTableRow
												key={strategy.id}
												strategy={strategy}
												onViewCode={handleViewCode}
												onBacktest={handleBacktestClick}
												onViewVersions={handleViewVersions}
												onEdit={handleEditStrategy}
												onExport={handleExport}
												onDelete={handleDeleteClick}
												bundleList={bundleList}
											/>
										))}
									</TableBody>
								</Table>
							</div>

							{/* Pagination */}
							{strategies.length > 0 && (
								<div className="p-4 border-t">
									<Pagination
										currentPage={pagination.currentPage}
										totalPages={pagination.totalPages}
										total={pagination.total}
										onPageChange={pagination.goToPage}
									/>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Dialogs */}
				<UploadStrategyDialog
					open={showUploadDialog}
					onOpenChange={setShowUploadDialog}
					onSuccess={fetchStrategies}
					templateList={templateList}
					bundleList={bundleList}
				/>

				<EditStrategyDialog
					open={showEditDialog}
					onOpenChange={setShowEditDialog}
					strategy={selectedStrategy}
					onSuccess={fetchStrategies}
					templateList={templateList}
				/>

				<VersionHistoryDialog
					open={showVersionDialog}
					onOpenChange={setShowVersionDialog}
					strategy={selectedStrategy}
					versions={selectedVersions}
					onViewCode={handleViewCode}
				/>

				<DeleteStrategyDialog
					open={showDeleteDialog}
					onOpenChange={setShowDeleteDialog}
					strategy={selectedStrategy}
					onSuccess={fetchStrategies}
				/>

				<CodePreviewDialog
					open={showCodePreview}
					onOpenChange={setShowCodePreview}
					strategyId={codePreviewData.strategyId}
					versionId={codePreviewData.versionId}
					strategyName={codePreviewData.strategyName}
					code={codePreviewData.code}
					onSuccess={fetchStrategies}
				/>

				<CreateBacktestDialog
					open={showBacktestDialog}
					onOpenChange={setShowBacktestDialog}
					strategyId={selectedStrategy?.id || 0}
					strategyName={selectedStrategy?.name || ''}
					onSuccess={handleBacktestSuccess}
					templateList={templateList}
				/>
			</div>
		</TooltipProvider>
	);
});
