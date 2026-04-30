import React, { useState } from 'react';
import { toast } from 'sonner';
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
import { Textarea } from '../../components/ui/textarea';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { X, ChevronDownIcon, Check, ChevronUpIcon } from 'lucide-react';
import { validateCode } from '../../lib/utils';

const selectItemCss =
	'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground';
const selectHeaderCss =
	"cursor-pointer border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-full items-center justify-between gap-2 rounded-md border bg-input-background px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 h-9 min-h-9";
interface NewUniverseDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateSuccess: (data: { code: string; name: string; description: string; sids: string[] }) => void;
	symbolsList: { symbol: string; sid: string; name: string }[];
}
const NewUniverseDialog = (props: NewUniverseDialogProps) => {
	const { open, onOpenChange, onCreateSuccess, symbolsList } = props;
	const [sids, setSids] = useState<string[]>([]);
	const [code, setCode] = useState<string>('');
	const [name, setName] = useState<string>('');
	const [description, setDescription] = useState<string>('');
	const [popoverOpen, setPopoverOpen] = useState(false);

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!code || !name || !sids.length) {
			toast.error('Please fill in all required fields marked with *');
			return;
		}
		if (!validateCode(code)) {
			toast.error('Invalid code');
			return;
		}
		onCreateSuccess({
			code,
			name,
			description,
			sids,
		});
		onOpenChange(false);
	};

	const toggleSid = (value: string) => {
		setSids((prev) => {
			if (prev.includes(value)) {
				return prev.filter((sid) => sid !== value);
			} else {
				return [...prev, value];
			}
		});
	};

	const removeSid = (value: string, e: React.MouseEvent) => {
		e.stopPropagation();
		setSids((prev) => prev.filter((sid) => sid !== value));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-visible">
				<DialogHeader>
					<DialogTitle>New Universe</DialogTitle>
					<DialogDescription>
						Configure parameters for your new universe, fields marked with * are required
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">
								Code<span className="text-red-500">*</span>
							</Label>
							<Input
								id="code"
								placeholder="Example: usstock-free"
								value={code}
								onChange={(e) => setCode(e.target.value)}
							/>
							<span className="text-sm text-muted-foreground">
								universe unique identifier. Only lowercase letters, numbers, and hyphens are allowed.
								Must be globally unique and non-duplicated.
							</span>
						</div>
						<div className="space-y-2">
							<Label htmlFor="name">
								Name<span className="text-red-500">*</span>
							</Label>
							<Input
								id="name"
								placeholder="Name"
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="vendor">
								Sids<span className="text-red-500">*</span>
							</Label>
							<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
								<PopoverTrigger asChild>
									<div
										id="sids"
										className={cn(selectHeaderCss, sids.length === 0 && 'text-muted-foreground')}
									>
										<div className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
											{sids.length === 0 ? (
												<span className="text-muted-foreground">Select symbols</span>
											) : (
												sids.map((sid) => {
													const option = symbolsList.find((opt) => opt.sid === sid);
													return (
														<span
															key={sid}
															className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs font-medium"
														>
															{option?.symbol || sid}
															<div
																onClick={(e) => removeSid(sid, e)}
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
										{symbolsList.map((option) => (
											<div
												key={option.sid}
												className={selectItemCss}
												onClick={() => toggleSid(option.sid)}
											>
												<span>{`${option.symbol} (${option.name})`}</span>
												{sids.includes(option.sid) && (
													<Check className="size-4 text-indigo-500" />
												)}
											</div>
										))}
									</div>
								</PopoverContent>
							</Popover>
						</div>
						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								placeholder="Description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter className="mt-4">
						<Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
							Cancel
						</Button>
						<Button type="submit" className="cursor-pointer" disabled={!code || !name || !sids.length}>
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default NewUniverseDialog;
