import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Button } from '../../components/ui/button';
import { getCompetitionsList } from '../../api';
import { CompetitionInfo } from '../../api/types';
interface NewSimulationStrategyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: (data: { name: string; description: string; competition_id: number }) => void;
}

const NewSimulationStrategyDialog = (props: NewSimulationStrategyDialogProps) => {
	const { open, onOpenChange, onSuccess } = props;
	const [formData, setFormData] = useState({
		name: '',
		description: '',
		competition_id: '' as string | undefined,
	});
	const [competitionList, setCompetitionList] = useState<CompetitionInfo[]>([]);

	useEffect(() => {
		fetchCompetitions();
	}, []);

	const fetchCompetitions = async () => {
		const response = await getCompetitionsList({ status: ['Upcoming'], page: 1, page_size: 9999 });
		setCompetitionList(response.data.competitions);
	};

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		onSuccess({
			name: formData.name,
			description: formData.description,
			competition_id: Number(formData.competition_id),
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>New Forward Testing Strategy</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<form onSubmit={handleSubmit}>
						<div className="space-y-2 mb-4">
							<Label htmlFor="name">
								Name <span className="text-red-500">*</span>
							</Label>
							<Input
								id="name"
								value={formData.name}
								placeholder="Enter name"
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
							/>
						</div>
						<div className="space-y-2 mb-4">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								value={formData.description}
								placeholder="Enter description"
								maxLength={200}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="competition_id">Competition</Label>
							<Select
								value={formData.competition_id}
								onValueChange={(value) => setFormData({ ...formData, competition_id: value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a competition" />
								</SelectTrigger>
								<SelectContent>
									{competitionList.length === 0 ? (
										<div className="px-2 py-1.5 text-sm text-muted-foreground text-left">
											No upcoming competitions found
										</div>
									) : (
										competitionList.map((competition) => (
											<SelectItem key={competition.id} value={competition.id.toString()}>
												{competition.name}
											</SelectItem>
										))
									)}
								</SelectContent>
							</Select>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={!formData.name}>
								Create
							</Button>
						</DialogFooter>
					</form>
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default NewSimulationStrategyDialog;
