import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { ApiError, createCompetition } from '../../api';
import { getMarkets } from '../../api/template';
import { MarketInfo } from '../../api/types';

interface Props {
	open: boolean;
	onClose: () => void;
	onCreated: () => void;
}

const CreateCompetitionDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
	const [markets, setMarkets] = useState<MarketInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [form, setForm] = useState({
		name: '',
		market_id: 0,
		initial_funding: 100000,
		trading_fees: 0,
		start_time: '',
		end_time: '',
	});

	useEffect(() => {
		if (!open) return;
		getMarkets()
			.then((list) => {
				setMarkets(list);
				if (list.length > 0 && form.market_id === 0) {
					setForm((f) => ({ ...f, market_id: list[0].id }));
				}
			})
			.catch(() => toast.error('Failed to load markets'));
	}, [open]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!form.name.trim()) return toast.error('Name is required');
		if (!form.market_id) return toast.error('Please select a market');
		if (!form.start_time || !form.end_time) return toast.error('Start and end time are required');

		const startTs = Math.floor(new Date(form.start_time).getTime() / 1000);
		const endTs = Math.floor(new Date(form.end_time).getTime() / 1000);
		if (startTs >= endTs) return toast.error('Start time must be before end time');

		setLoading(true);
		try {
			await createCompetition({
				name: form.name.trim(),
				market_id: form.market_id,
				initial_funding: form.initial_funding,
				trading_fees: form.trading_fees,
				start_time: startTs,
				end_time: endTs,
			});
			toast.success('Competition created — only you can see and join it.');
			onCreated();
			onClose();
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : 'Failed to create competition');
		} finally {
			setLoading(false);
		}
	};

	const toLocalDatetimeValue = (offsetDays: number) => {
		const d = new Date();
		d.setDate(d.getDate() + offsetDays);
		d.setMinutes(0, 0, 0);
		return d.toISOString().slice(0, 16);
	};

	useEffect(() => {
		if (open) {
			setForm((f) => ({
				...f,
				name: '',
				trading_fees: 0,
				initial_funding: 100000,
				start_time: toLocalDatetimeValue(0),
				end_time: toLocalDatetimeValue(30),
			}));
		}
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Create My Competition</DialogTitle>
				</DialogHeader>
				<p className="text-sm text-muted-foreground -mt-2">
					Private — only visible and joinable by you.
				</p>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="comp-name">Name</Label>
						<Input
							id="comp-name"
							placeholder="My Trading Competition"
							value={form.name}
							onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
							required
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="comp-market">Market</Label>
						<select
							id="comp-market"
							className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
							value={form.market_id}
							onChange={(e) => setForm((f) => ({ ...f, market_id: Number(e.target.value) }))}
						>
							{markets.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
								</option>
							))}
						</select>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="comp-funding">Initial Funding ($)</Label>
							<Input
								id="comp-funding"
								type="number"
								min={1}
								value={form.initial_funding}
								onChange={(e) =>
									setForm((f) => ({ ...f, initial_funding: Number(e.target.value) }))
								}
								required
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="comp-fees">Trading Fees (%)</Label>
							<Input
								id="comp-fees"
								type="number"
								min={0}
								max={100}
								step={0.01}
								value={form.trading_fees}
								onChange={(e) =>
									setForm((f) => ({ ...f, trading_fees: Number(e.target.value) }))
								}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="comp-start">Start Time</Label>
							<Input
								id="comp-start"
								type="datetime-local"
								value={form.start_time}
								onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
								required
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="comp-end">End Time</Label>
							<Input
								id="comp-end"
								type="datetime-local"
								value={form.end_time}
								onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
								required
							/>
						</div>
					</div>

					<div className="flex justify-end gap-2 pt-2">
						<Button type="button" variant="outline" onClick={onClose} disabled={loading}>
							Cancel
						</Button>
						<Button type="submit" disabled={loading}>
							{loading ? 'Creating…' : 'Create'}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default CreateCompetitionDialog;
