import { memo } from 'react';
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
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { BacktestingTaskInfo } from '../../api';

interface BacktestErrorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	task: BacktestingTaskInfo | null;
	errMsg: string | undefined;
	loading: boolean;
	onRetry: (strategyId?: number, strategyName?: string) => void;
}

export const BacktestErrorDialog = memo(function BacktestErrorDialog({
	open,
	onOpenChange,
	task,
	errMsg,
	loading,
	onRetry,
}: BacktestErrorDialogProps) {
	const renderFormattedError = (msg?: string) => {
		if (!msg) return 'Unknown error occurred';

		try {
			const firstBrace = msg.indexOf('{');
			const lastBrace = msg.lastIndexOf('}');

			// 如果没有明显的 JSON 段，直接原样展示
			if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
				return <div className="whitespace-pre-wrap break-words">{msg}</div>;
			}

			const prefix = msg.slice(0, firstBrace).trim();
			const jsonPart = msg.slice(firstBrace, lastBrace + 1).trim();
			const suffix = msg.slice(lastBrace + 1).trim();

			let parsed: unknown;
			try {
				parsed = JSON.parse(jsonPart);
			} catch {
				// 解析失败就退回原文展示
				return <div className="whitespace-pre-wrap break-words">{msg}</div>;
			}

			return (
				<div className="space-y-2 text-xs md:text-sm text-left">
					{prefix && <div className="whitespace-pre-wrap break-words">{prefix}</div>}
					<pre className="bg-background/50 rounded px-2 py-1 whitespace-pre-wrap break-words font-mono">
						{JSON.stringify(parsed, null, 2)}
					</pre>
					{suffix && <div className="whitespace-pre-wrap break-words">{suffix}</div>}
				</div>
			);
		} catch {
			return <div className="whitespace-pre-wrap break-words">{msg}</div>;
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<AlertCircle className="h-5 w-5 text-red-600" />
						Backtest Failed
					</AlertDialogTitle>
					<AlertDialogDescription>
						<div className="space-y-2 mt-2 text-left">
							<p>
								<strong>Strategy:</strong> {task?.strategy_name} v{task?.strategy_version}
							</p>
							<p>
								<strong>Error Message:</strong>
							</p>
							<div className="bg-muted p-3 rounded text-sm">
								{loading ? (
									<RefreshCw className="h-4 w-4 animate-spin" />
								) : (
									renderFormattedError(errMsg)
								)}
							</div>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Close</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							onRetry(task?.strategy_id, task?.strategy_name);
						}}
					>
						Retry
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
});
