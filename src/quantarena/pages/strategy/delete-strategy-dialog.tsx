import React, { useState } from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { deleteStrategy, ApiError } from '../../api';
import type { StrategyInfo } from '../../api';

interface DeleteStrategyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	strategy: StrategyInfo | null;
	onSuccess: () => void;
}

export function DeleteStrategyDialog({ open, onOpenChange, strategy, onSuccess }: DeleteStrategyDialogProps) {
	const [loading, setLoading] = useState(false);

	const handleDelete = async () => {
		if (!strategy) return;

		setLoading(true);

		try {
			await deleteStrategy(strategy.id);
			toast.success('Strategy deleted successfully!');
			onOpenChange(false);
			onSuccess();
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to delete strategy');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Are you sure?</AlertDialogTitle>
					<AlertDialogDescription>
						This will permanently delete the strategy "{strategy?.name}" and all its versions. This action
						cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleDelete}
						disabled={loading}
						className="bg-destructive hover:bg-destructive/90"
					>
						{loading ? (
							<>
								<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
								Deleting...
							</>
						) : (
							'Delete'
						)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
