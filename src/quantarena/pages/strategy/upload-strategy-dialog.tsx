import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { Upload, RefreshCw } from 'lucide-react';
import { createStrategy, ApiError, TemplateInfo, BundleInfo } from '../../api';

interface UploadStrategyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
	templateList: TemplateInfo[];
	bundleList: BundleInfo[];
}

export const selectItemCss =
	'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground';
export const selectHeaderCss =
	"cursor-pointer border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-full items-center justify-between gap-2 rounded-md border bg-input-background px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 h-9 min-h-9";

export function UploadStrategyDialog({
	open,
	onOpenChange,
	onSuccess,
	bundleList,
}: UploadStrategyDialogProps) {
	const [loading, setLoading] = useState(false);
	const [uploadForm, setUploadForm] = useState({
		name: '',
		description: '',
		framework: 'Moonshot' as 'Moonshot' | 'Zipline' | 'FreqTrade',
		visibility: 'Private' as 'Private' | 'Public',
		file: null as File | null,
		bundle_code: undefined as string | undefined,
		freqtrade_config: '' as string,
	});

	const handleSubmit = async () => {
		if (!uploadForm.name || !uploadForm.file) {
			toast.error('Please fill in all required fields');
			return;
		}

		setLoading(true);

		try {
			await createStrategy({
				name: uploadForm.name,
				description: uploadForm.description,
				framework: uploadForm.framework,
				visibility: uploadForm.visibility,
				file: uploadForm.file,
				// template_ids: templateIds,
				bundle_code: uploadForm.bundle_code,
				freqtrade_config: uploadForm.freqtrade_config || undefined,
			});

			toast.success('Strategy uploaded successfully!');
			onOpenChange(false);
			setUploadForm({
				name: '',
				description: '',
				framework: 'Moonshot',
				visibility: 'Private',
				file: null,
				bundle_code: undefined,
				freqtrade_config: '',
			});
			onSuccess();
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to upload strategy');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	const getDisabled = () => {
		if (uploadForm.framework === 'Zipline') {
			return loading || !uploadForm.name || !uploadForm.file || !uploadForm.bundle_code;
		} else {
			return loading || !uploadForm.name || !uploadForm.file;
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Create New Strategy</DialogTitle>
					<DialogDescription>Upload a Python file containing your trading strategy</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">
							Name <span className="text-red-500">*</span>
						</Label>
						<Input
							id="name"
							placeholder="Strategy name"
							value={uploadForm.name}
							onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
							disabled={loading}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							placeholder="Describe your strategy..."
							value={uploadForm.description}
							onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
							disabled={loading}
						/>
					</div>

					{/* <div className="space-y-2">
						<Label htmlFor="template">Templates</Label>
						<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
							<PopoverTrigger asChild>
								<div
									id="template_ids"
									className={cn(selectHeaderCss, templateIds.length === 0 && 'text-muted-foreground')}
								>
									<div className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
										{templateIds.length === 0 ? (
											<span className="text-muted-foreground">Select templates</span>
										) : (
											templateIds.map((template_id) => {
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
										<div className="text-muted-foreground p-2">No template found</div>
									) : (
										templateList.map((option) => (
											<div
												key={option.id}
												className={selectItemCss}
												onClick={() => toggleTag(option.id)}
											>
												<span>{`${option.name} (${option.type})`}</span>
												{templateIds.includes(option.id) && (
													<Check className="size-4 text-indigo-500" />
												)}
											</div>
										))
									)}
								</div>
							</PopoverContent>
						</Popover>
					</div> */}

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="framework">
								Framework <span className="text-red-500">*</span>
							</Label>
							<Select
								value={uploadForm.framework}
								onValueChange={(value: 'Moonshot' | 'Zipline' | 'FreqTrade') =>
									setUploadForm({ ...uploadForm, framework: value })
								}
								disabled={loading}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="Moonshot">Moonshot</SelectItem>
									<SelectItem value="Zipline">Zipline</SelectItem>
									<SelectItem value="FreqTrade">FreqTrade</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{uploadForm.framework === 'Zipline' && (
							<div className="space-y-2">
								<Label htmlFor="bundle">
									Bundle <span className="text-red-500">*</span>
								</Label>
								<Select
									value={uploadForm.bundle_code}
									onValueChange={(value) => setUploadForm({ ...uploadForm, bundle_code: value })}
									disabled={loading}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select a bundle" />
									</SelectTrigger>
									<SelectContent>
										{bundleList.map((bundle) => (
											<SelectItem key={bundle.id} value={bundle.code.toString()}>
												{`${bundle.code}-${bundle.name}`}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						{uploadForm.framework === 'FreqTrade' && (
							<div className="space-y-2">
								<Label htmlFor="freqtrade_config">
									FreqTrade Config (JSON)
								</Label>
								<textarea
									id="freqtrade_config"
									className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									rows={3}
									placeholder='{"exchange": "binance", "pairs": ["BTC/USDT"], "timeframe": "1h"}'
									value={uploadForm.freqtrade_config}
									onChange={(e) =>
										setUploadForm({ ...uploadForm, freqtrade_config: e.target.value })
									}
								/>
							</div>
						)}
					</div>
					<div className="space-y-2">
						<Label htmlFor="visibility">
							Visibility <span className="text-red-500">*</span>
						</Label>
						<Select
							value={uploadForm.visibility}
							onValueChange={(value: 'Private' | 'Public') =>
								setUploadForm({ ...uploadForm, visibility: value })
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

					<div className="space-y-2">
						<Label htmlFor="file">
							Python File <span className="text-red-500">*</span>
						</Label>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => document.getElementById('file-upload')?.click()}
								disabled={loading}
								className="flex-shrink-0"
							>
								<Upload className="w-4 h-4 mr-2" />
								Choose File
							</Button>
							<span className="text-sm text-muted-foreground truncate">
								{uploadForm.file ? uploadForm.file.name : 'No file chosen'}
							</span>
							<input
								id="file-upload"
								type="file"
								accept=".py"
								className="hidden"
								onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] || null })}
								disabled={loading}
							/>
						</div>
						<p className="text-xs text-muted-foreground">Upload a Python (.py) file</p>
					</div>
				</div>

				<div className="flex justify-end gap-2 pt-4 border-t">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={getDisabled()}>
						{loading ? (
							<>
								<RefreshCw className="w-4 h-4 mr-2 animate-spin" />
								Creating...
							</>
						) : (
							<>Create</>
						)}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
