import React, { useState, useEffect } from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../../components/ui/dialog';
import { TemplateInfo, MarketInfo } from '../../api/types';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import DatePicker from 'react-datepicker';
import { Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { getMarkets } from '../../api/template';

interface EditCustomTagDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: (data: TemplateInfo) => void;
	data?: TemplateInfo;
}
const calendarCss = 'absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none';
const datePickerCss =
	'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base bg-input-background transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
const EditCustomTagDialog = (props: EditCustomTagDialogProps) => {
	const { open, onOpenChange, onSuccess, data } = props;
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [startDate, setStartDate] = useState<Date | null>(null);
	const [endDate, setEndDate] = useState<Date | null>(null);
	const [markets, setMarkets] = useState<MarketInfo[]>([]);
	const [selectedMarket, setSelectedMarket] = useState<string>('');

	const resetForm = () => {
		setName('');
		setDescription('');
		setStartDate(null);
		setEndDate(null);
		setSelectedMarket('');
	};

	// 设置最大日期为当前年份 + 100 年的最后一天（与日历组件的默认最大年份一致）
	const maxDate = new Date();
	maxDate.setFullYear(maxDate.getFullYear() + 100);
	maxDate.setMonth(11, 31); // 12月31日
	maxDate.setHours(23, 59, 59, 999);

	useEffect(() => {
		// 弹窗打开时，根据是否有 data 来决定是编辑还是新建，并初始化/重置表单
		if (!open) return;

		if (data) {
			setName(data.name);
			setDescription(data.description);
			setStartDate(new Date(data.start_date * 1000));
			setEndDate(new Date(data.end_date * 1000));
			setSelectedMarket(data.market_id ? String(data.market_id) : '');
		} else {
			resetForm();
		}
	}, [open, data]);

	useEffect(() => {
		const fetchMarkets = async () => {
			try {
				const marketList = await getMarkets();
				setMarkets(marketList);
			} catch (error) {
				console.error('Failed to fetch markets:', error);
				toast.error('Failed to load markets');
			}
		};
		fetchMarkets();
	}, []);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!name.trim() || !startDate || !endDate) {
			toast.error('Please fill in all fields');
			return;
		}
		if (startDate >= endDate) {
			toast.error('Start date must be before end date');
			return;
		}
		onSuccess({
			id: data?.id || 0,
			name: name.trim(),
			description: description.trim(),
			start_date: Math.floor(startDate?.getTime() / 1000) || 0,
			end_date: Math.floor(endDate?.getTime() / 1000) || 0,
			market_id: selectedMarket ? Number(selectedMarket) : undefined,
		});
	};

	const handleStartDateChange = (date: Date | null) => {
		setStartDate(date);
	};

	const handleEndDateChange = (date: Date | null) => {
		setEndDate(date);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{`${data?.id ? 'Edit' : 'Create'} Template`}</DialogTitle>
					<DialogDescription>Create a new parameter template for backtest tasks</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">
								Name<span className="text-red-500">*</span>
							</Label>
							<Input
								placeholder="Enter template name"
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={50}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="market">Market</Label>
							<Select value={selectedMarket} onValueChange={setSelectedMarket}>
								<SelectTrigger id="market">
									<SelectValue placeholder="Select a market" />
								</SelectTrigger>
								<SelectContent>
									{markets.length > 0 ? (
										markets.map((market) => (
											<SelectItem key={market.id} value={String(market.id)}>
												{market.name}
											</SelectItem>
										))
									) : (
										<div className="text-gray-500 p-4">No markets found</div>
									)}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="startDate">
								Start Time<span className="text-red-500">*</span>
							</Label>
							<div className="relative">
								<DatePicker
									selected={startDate}
									onChange={handleStartDateChange}
									dateFormat="yyyy-MM-dd"
									placeholderText="Select start date"
									showMonthDropdown
									showYearDropdown
									dropdownMode="select"
									className={datePickerCss}
									wrapperClassName="w-full"
									maxDate={maxDate}
								/>
								<CalendarIcon className={calendarCss} />
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="endDate">
								End Time<span className="text-red-500">*</span>
							</Label>
							<div className="relative">
								<DatePicker
									selected={endDate}
									onChange={handleEndDateChange}
									dateFormat="yyyy-MM-dd"
									placeholderText="Select end date"
									minDate={startDate || undefined}
									showMonthDropdown
									showYearDropdown
									dropdownMode="select"
									className={datePickerCss}
									wrapperClassName="w-full"
									maxDate={maxDate}
								/>
								<CalendarIcon className={calendarCss} />
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								placeholder="Enter template description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								maxLength={250}
								className="whitespace-pre-wrap overflow-x-hidden min-w-0"
								style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
							/>
						</div>
					</div>
					<DialogFooter className="mt-4">
						<Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
							Cancel
						</Button>
						<Button type="submit" className="cursor-pointer" disabled={!name || !startDate || !endDate}>
							{data?.id ? 'Update' : 'Create'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default EditCustomTagDialog;
