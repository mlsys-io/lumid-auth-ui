import React, { useState, memo, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { createBacktestingTask, ApiError } from '../../api';
import type { CreateBacktestingTaskRequest, TemplateInfo } from '../../api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { formatDate } from '../../lib/utils';

interface BacktestDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	strategyId: number;
	strategyName: string;
	onSuccess: () => void;
	templateList?: TemplateInfo[];
}

export const CreateBacktestDialog = memo(function CreateBacktestDialog({
	open,
	onOpenChange,
	strategyId,
	strategyName,
	onSuccess,
	templateList,
}: BacktestDialogProps) {
	const [loading, setLoading] = useState(false);
	const [templateId, setTemplateId] = useState<number>(0);

	const handleSubmit = useCallback(async () => {
		if (!templateId) {
			toast.error('Please select a template');
			return;
		}
		setLoading(true);

		try {
			const request: CreateBacktestingTaskRequest = {
				strategy_id: strategyId,
				template_id: templateId,
			};

			const response = await createBacktestingTask(request);

			toast.success(`Backtest task created successfully! Task ID: ${response.id}`);
			onOpenChange(false);

			onSuccess();
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to create backtest task');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	}, [templateId, strategyId, onOpenChange, onSuccess]);

	const handleCancel = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-2xl max-h-[90vh] overflow-y-visible"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>Create New Backtest</DialogTitle>
					<DialogDescription>Configure parameters for backtesting your strategy</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Backtest Configuration</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label>Strategy</Label>
								<Input value={strategyName} disabled className="cursor-not-allowed" />
							</div>

							<div className="space-y-2">
								<Label>Template</Label>
								<Select
									value={templateId ? templateId.toString() : ''}
									onValueChange={(value) => setTemplateId(Number(value))}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select a template" />
									</SelectTrigger>
									<SelectContent>
										{templateList?.length === 0 ? (
											<SelectItem value="No tags found">No templates found</SelectItem>
										) : (
											templateList?.map((template) => (
												<SelectItem key={template.id} value={template.id.toString()}>
													{`${template.name} (${formatDate(template.start_date)}~${formatDate(template.end_date)})`}
												</SelectItem>
											))
										)}
									</SelectContent>
								</Select>
							</div>
						</CardContent>
					</Card>
				</div>

				<div className="flex justify-end gap-2 pt-4 border-t">
					<Button variant="outline" onClick={handleCancel} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={loading || !templateId}>
						{loading ? (
							<>
								<div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
								Creating...
							</>
						) : (
							<>
								<Play className="w-4 h-4 mr-2" />
								Submit Backtest
							</>
						)}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
});
