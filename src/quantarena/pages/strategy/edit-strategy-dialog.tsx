import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { updateStrategy, ApiError } from '../../api';
import type { StrategyInfo, TemplateInfo } from '../../api';

interface EditStrategyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	strategy: StrategyInfo | null;
	onSuccess: () => void;
	templateList: TemplateInfo[];
}

export function EditStrategyDialog({ open, onOpenChange, strategy, onSuccess }: EditStrategyDialogProps) {
	const [loading, setLoading] = useState(false);
	const [editForm, setEditForm] = useState({
		name: '',
		description: '',
		template_ids: [] as number[],
		visibility: 'Private' as 'Private' | 'Public',
	});

	useEffect(() => {
		if (strategy) {
			setEditForm({
				name: strategy.name,
				description: strategy.description,
				template_ids: strategy.templates?.map((template) => template.id) || [],
				visibility: strategy.visibility,
			});
		}
	}, [strategy]);

	const handleSubmit = async () => {
		if (!strategy) return;

		setLoading(true);
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { templates, id, ...tempStrategyInfo } = strategy;
		try {
			await updateStrategy(strategy.id, {
				...tempStrategyInfo,
				name: editForm.name,
				description: editForm.description,
				// template_ids: editForm.template_ids,
				visibility: editForm.visibility,
			});

			toast.success('Strategy updated successfully!');
			onOpenChange(false);
			onSuccess();
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to update strategy');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Edit Strategy Info</DialogTitle>
					<DialogDescription>Update your strategy's basic information</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="edit-name">Name</Label>
						<Input
							id="edit-name"
							value={editForm.name}
							onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
							disabled={loading}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="edit-description">Description</Label>
						<Textarea
							id="edit-description"
							value={editForm.description}
							onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
							disabled={loading}
						/>
					</div>

					{/* <div className="space-y-2">
						<Label htmlFor="edit-tags">Templates</Label>
						<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
							<PopoverTrigger asChild>
								<div
									id="template_ids"
									className={cn(
										selectHeaderCss,
										editForm.template_ids.length === 0 && 'text-muted-foreground'
									)}
								>
									<div className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
										{editForm.template_ids.length === 0 ? (
											<span className="text-muted-foreground">Select Templates</span>
										) : (
											editForm.template_ids.map((template_id) => {
												const option = templateList.find((opt) => opt.id === template_id);
												return (
													<span
														key={template_id}
														className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs font-medium"
													>
														{option?.name || template_id}
														<div
															onClick={(e) => removeTag(template_id, e)}
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
								<div className="max-h-[300px] overflow-y-auto">
									{templateList.length === 0 ? (
										<div className="text-muted-foreground p-2">No templates found</div>
									) : (
										templateList.map((option) => (
											<div
												key={option.id}
												className={selectItemCss}
												onClick={() => toggleTag(option.id)}
											>
												<span>{`${option.name} (${option.type})`}</span>
												{editForm.template_ids.includes(option.id) && (
													<Check className="size-4 text-indigo-500" />
												)}
											</div>
										))
									)}
								</div>
							</PopoverContent>
						</Popover>
					</div> */}

					<div className="space-y-2">
						<Label htmlFor="edit-visibility">Visibility</Label>
						<Select
							value={editForm.visibility}
							onValueChange={(value: 'Private' | 'Public') =>
								setEditForm({ ...editForm, visibility: value })
							}
							disabled={loading}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="Private">Private</SelectItem>
								<SelectItem value="Public">Public</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="flex justify-end gap-2 pt-4 border-t">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={loading}>
						{loading ? (
							<>
								<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
								Saving...
							</>
						) : (
							'Save Changes'
						)}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
