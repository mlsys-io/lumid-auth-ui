import React, { useEffect, useState } from 'react';
import { Checkbox } from '../../components/ui/checkbox';
import { COMPETITION_STATUS_OPTIONS, PAGE_SIZE } from '../../lib/enum';
import { Label } from '../../components/ui/label';
import { CompetitionInfo, CompetitionListParams } from '../../api/types';
import { usePagination } from '../../hooks/usePagination';
import CompetitionCard from './competition-card';
import { Loading } from '../../components/ui/loading';
import EmptyData from '../../components/empty-data';
import RegisterCompetitionDialog from './register-competition-dialog';
import { registerStrategyForCompetition, getCompetitionsList, ApiError, getMyCompetitionsList } from '../../api';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { cn } from '../../lib/utils';
import { selectHeaderCss, selectItemCss } from '../strategy/upload-strategy-dialog';
import { X, ChevronUpIcon, ChevronDownIcon, Check } from 'lucide-react';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { AdminManageLink } from '../../components/admin-manage-link';

const CompetitionLobby = () => {
	const [status, setStatus] = useState<string[]>([]);
	const [competitionsList, setCompetitionsList] = useState<CompetitionInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const pagination = usePagination({ pageSize: PAGE_SIZE });
	const [registerCompetition, setRegisterCompetition] = useState<CompetitionInfo | null>(null);
	const [refresh, setRefresh] = useState(Date.now());
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [showMyCompetitions, setShowMyCompetitions] = useState(false);

	useEffect(() => {
		fetchCompetitionsList();
	}, [status, refresh, showMyCompetitions, pagination.currentPage]);

	const fetchCompetitionsList = async () => {
		setLoading(true);
		try {
			const params: CompetitionListParams = {
				page: pagination.currentPage,
				page_size: pagination.pageSize,
			};
			if (status.length > 0) {
				params.status = status;
			}
			if (showMyCompetitions) {
				const response = await getMyCompetitionsList(params);
				setCompetitionsList(response.data.competitions);
				pagination.setTotal(response.total);
			} else {
				const response = await getCompetitionsList(params);
				pagination.setTotal(response.total);
				setCompetitionsList(response.data.competitions);
			}
		} catch (error) {
			console.error('Failed to fetch competitions list:', error);
		} finally {
			setLoading(false);
		}
	};

	const handleRegisterCompetition = (competition: CompetitionInfo) => {
		setRegisterCompetition(competition);
	};

	const handleConfrimRegister = async (competitionId: number, strategyId: number) => {
		try {
			await registerStrategyForCompetition(competitionId, strategyId);
			setRegisterCompetition(null);
			setRefresh(Date.now());
			toast.success('Competition registered successfully');
		} catch (error) {
			const errorMessage = error instanceof ApiError ? error.message : 'Failed to register for competition';
			toast.error(errorMessage);
			console.error('Failed to register for competition:', error);
		}
	};

	const removeStatus = (value: string, e: React.MouseEvent) => {
		e.stopPropagation();
		setStatus(status.filter((s) => s !== value));
	};

	const toggleStatus = (value: string) => {
		if (status.includes(value)) {
			setStatus(status.filter((s) => s !== value));
		} else {
			setStatus([...status, value]);
		}
	};

	const handleClearStatus = () => {
		setStatus([]);
		pagination.resetPage();
	};

	return (
		<div className="mt-4">
			{loading && (
				<div className="flex items-center justify-center">
					<Loading text="Loading competitions..." />
				</div>
			)}
			<div className="flex flex-col gap-4 mb-4 md:flex-row md:items-center md:gap-10">
				<div className="flex items-center gap-2 w-full md:w-auto">
					<Label className="shrink-0">Status:</Label>
					<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
						<PopoverTrigger asChild disabled={status.length === 0}>
							<div
								id="template_ids"
								className={cn(
									selectHeaderCss,
									status.length === 0 && 'text-muted-foreground',
									'w-full md:w-60'
								)}
							>
								<div className="flex flex-1 flex-wrap items-center gap-1 overflow-y-auto max-h-[32px]">
									{status.length === 0 ? (
										<span className="text-muted-foreground">Select Status</span>
									) : (
										status.map((s) => {
											const option = COMPETITION_STATUS_OPTIONS.find((opt) => opt.value === s);
											return (
												<span
													key={s}
													className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs font-medium"
												>
													{option?.label || s}
													<div
														onClick={(e) => removeStatus(s, e)}
														className="ml-1 rounded-full hover:bg-secondary-foreground/20"
													>
														<X className="h-3 w-3 text-red-500" />
													</div>
												</span>
											);
										})
									)}
								</div>
								{popoverOpen ? (
									<ChevronUpIcon className="size-4 opacity-50 shrink-0" />
								) : (
									<ChevronDownIcon className="size-4 opacity-50 shrink-0" />
								)}
							</div>
						</PopoverTrigger>
						<PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
							<div className="py-1 border-b">
								<Button
									variant="ghost"
									size="sm"
									className="w-full justify-start text-muted-foreground"
									onClick={handleClearStatus}
									disabled={status.length === 0}
								>
									Clear all
								</Button>
							</div>
							<div className="max-h-[300px] overflow-y-auto">
								{COMPETITION_STATUS_OPTIONS.length === 0 ? (
									<div className="text-muted-foreground p-2">No tags found</div>
								) : (
									COMPETITION_STATUS_OPTIONS.map((option) => (
										<div
											key={option.value}
											className={selectItemCss}
											onClick={() => toggleStatus(option.value)}
										>
											<span>{option.label}</span>
											{status.includes(option.value) && (
												<Check className="size-4 text-indigo-500" />
											)}
										</div>
									))
								)}
							</div>
						</PopoverContent>
					</Popover>
				</div>
				<div className="flex items-center gap-3 w-full md:w-auto justify-end">
					<Checkbox
						checked={showMyCompetitions}
						className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-400 data-[state=checked]:text-white data-[state=unchecked]:border-gray-400"
						onCheckedChange={(checked) => {
							setShowMyCompetitions(checked === 'indeterminate' ? false : checked);
							pagination.resetPage();
						}}
					/>
					<Label>Show My Competitions</Label>
					<AdminManageLink to="/dashboard/admin/competitions" />
				</div>
			</div>
			{!loading && !competitionsList?.length && (
				<EmptyData
					title="No competitions found"
					description={
						showMyCompetitions
							? 'Hurry up and choose a competition to join in !'
							: 'Please look forward to upcoming competitions. New competitions will be announced soon.'
					}
				/>
			)}
			{competitionsList?.length > 0 && (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{competitionsList.map((competition) => (
						<CompetitionCard
							key={competition.id}
							competition={competition as CompetitionInfo}
							onRegister={handleRegisterCompetition}
						/>
					))}
				</div>
			)}
			{pagination.totalPages > 1 && (
				<div className="flex justify-center">
					<Pagination
						currentPage={pagination.currentPage}
						totalPages={pagination.totalPages}
						total={pagination.total}
						onPageChange={pagination.goToPage}
					/>
				</div>
			)}
			{registerCompetition && (
				<RegisterCompetitionDialog
					open={!!registerCompetition}
					competitionInfo={registerCompetition as CompetitionInfo}
					onClose={() => setRegisterCompetition(null)}
					onConfirmRegister={handleConfrimRegister}
				/>
			)}
		</div>
	);
};

export default CompetitionLobby;
