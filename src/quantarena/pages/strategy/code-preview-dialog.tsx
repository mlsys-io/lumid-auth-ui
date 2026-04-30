import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { Save, X, Download } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { editStrategyCode, exportStrategyCode, ApiError } from '../../api';

interface CodePreviewDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	strategyId: number;
	strategyName: string;
	versionId?: number;
	code: string;
	onSuccess: () => void;
}

export function CodePreviewDialog({
	open,
	onOpenChange,
	strategyId,
	strategyName,
	versionId,
	code,
	onSuccess,
}: CodePreviewDialogProps) {
	const [editorCode, setEditorCode] = useState('');
	const [note, setNote] = useState('');
	const [loading, setLoading] = useState(false);
	const [exporting, setExporting] = useState(false);

	useEffect(() => {
		setEditorCode(code);
	}, [code]);

	const handleSave = async () => {
		if (!editorCode.trim()) {
			toast.error('Code cannot be empty');
			return;
		}

		setLoading(true);

		try {
			await editStrategyCode(strategyId, {
				code_content: editorCode,
				note: note || undefined,
			});

			toast.success('Code saved successfully!');
			onOpenChange(false);
			onSuccess();
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to save code');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
			setNote('');
		}
	};

	const handleExport = async () => {
		setExporting(true);

		try {
			const blob = await exportStrategyCode(strategyId, versionId);

			// Create download link
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${strategyName}_v${versionId || 'latest'}.py`;
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
			document.body.removeChild(a);

			toast.success('Strategy code exported successfully!');
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to export code');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setExporting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex flex-col p-8 gap-4"
				style={{ maxWidth: '70vw', width: '70vw', maxHeight: '95vh', height: '95vh' }}
			>
				<DialogHeader className="flex-shrink-0">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<DialogTitle>{strategyName}</DialogTitle>
							{versionId && <Badge variant="outline">Version {versionId}</Badge>}
						</div>
						<Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
							{exporting ? (
								<>
									<div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
									Exporting...
								</>
							) : (
								<>
									<Download className="w-4 h-4 mr-2" />
									Export
								</>
							)}
						</Button>
					</div>
				</DialogHeader>

				<div className="space-y-2 flex-shrink-0">
					<Label htmlFor="version-note">Version Note (optional)</Label>
					<Input
						id="version-note"
						placeholder="Describe what changed in this version..."
						value={note}
						onChange={(e) => setNote(e.target.value)}
						disabled={loading}
					/>
				</div>

				<div className="flex-1 min-h-0 border rounded-md overflow-hidden">
					<Editor
						height="100%"
						defaultLanguage="python"
						value={editorCode}
						onChange={(value) => setEditorCode(value || '')}
						theme="vs-dark"
						options={{
							readOnly: false,
							minimap: { enabled: true },
							fontSize: 14,
							lineNumbers: 'on',
							scrollBeyondLastLine: false,
							automaticLayout: true,
							tabSize: 4,
							wordWrap: 'on',
							renderWhitespace: 'selection',
							bracketPairColorization: {
								enabled: true,
							},
						}}
						loading={
							<div className="flex items-center justify-center h-full">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
							</div>
						}
					/>
				</div>

				<div className="flex justify-between items-center pt-4 border-t flex-shrink-0">
					<div className="text-sm text-muted-foreground">Editing will create a new version</div>
					<div className="flex gap-2">
						<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
							<X className="w-4 h-4 mr-2" />
							Cancel
						</Button>
						<Button onClick={handleSave} disabled={loading || !editorCode.trim()}>
							{loading ? (
								<>
									<div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
									Saving...
								</>
							) : (
								<>
									<Save className="w-4 h-4 mr-2" />
									Save Changes
								</>
							)}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
