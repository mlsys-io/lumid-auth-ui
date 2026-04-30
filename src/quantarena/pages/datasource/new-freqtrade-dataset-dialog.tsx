import React, { useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectValue, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { FREQTRADE_EXCHANGE_OPTIONS, FREQTRADE_TIMEFRAME_OPTIONS } from '../../lib/enum';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { ApiError, createFreqTradeDataset } from '../../api';

interface NewFreqTradeDatasetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateSuccess: () => void;
}

const NewFreqTradeDatasetDialog = (props: NewFreqTradeDatasetDialogProps) => {
	const { open, onOpenChange, onCreateSuccess } = props;
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [exchange, setExchange] = useState('binance');
	const [pairs, setPairs] = useState('BTC/USDT, ETH/USDT');
	const [timeframe, setTimeframe] = useState('1h');
	const [startDate, setStartDate] = useState('');
	const [endDate, setEndDate] = useState('');
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async () => {
		if (!name.trim()) {
			toast.error('Name is required');
			return;
		}
		if (!exchange) {
			toast.error('Exchange is required');
			return;
		}
		if (!pairs.trim()) {
			toast.error('At least one trading pair is required');
			return;
		}

		const pairList = pairs.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
		if (pairList.length === 0) {
			toast.error('At least one valid trading pair is required');
			return;
		}

		setSubmitting(true);
		try {
			await createFreqTradeDataset({
				name: name.trim(),
				description: description.trim(),
				exchange,
				pairs: pairList,
				timeframe,
				start_date: startDate || undefined,
				end_date: endDate || undefined,
			});
			toast.success('Dataset created successfully!');
			onOpenChange(false);
			onCreateSuccess();
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to create dataset');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Create FreqTrade Dataset</DialogTitle>
					<DialogDescription>
						Configure market data to download for FreqTrade backtesting.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<Label htmlFor="name">Name *</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g., BTC-ETH Hourly Data"
						/>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Optional description"
							rows={2}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label>Exchange *</Label>
							<Select value={exchange} onValueChange={setExchange}>
								<SelectTrigger>
									<SelectValue placeholder="Select exchange" />
								</SelectTrigger>
								<SelectContent>
									{FREQTRADE_EXCHANGE_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-2">
							<Label>Timeframe *</Label>
							<Select value={timeframe} onValueChange={setTimeframe}>
								<SelectTrigger>
									<SelectValue placeholder="Select timeframe" />
								</SelectTrigger>
								<SelectContent>
									{FREQTRADE_TIMEFRAME_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="pairs">Trading Pairs * (comma-separated)</Label>
						<Textarea
							id="pairs"
							value={pairs}
							onChange={(e) => setPairs(e.target.value)}
							placeholder="BTC/USDT, ETH/USDT, SOL/USDT"
							rows={2}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="start_date">Start Date (YYYYMMDD)</Label>
							<Input
								id="start_date"
								value={startDate}
								onChange={(e) => setStartDate(e.target.value)}
								placeholder="e.g., 20230101"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="end_date">End Date (YYYYMMDD)</Label>
							<Input
								id="end_date"
								value={endDate}
								onChange={(e) => setEndDate(e.target.value)}
								placeholder="e.g., 20240101"
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={submitting}>
						{submitting ? 'Creating...' : 'Create Dataset'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default NewFreqTradeDatasetDialog;
