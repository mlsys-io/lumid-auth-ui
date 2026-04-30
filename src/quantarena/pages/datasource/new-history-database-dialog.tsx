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
import { VENDOR_OPTIONS } from '../../lib/enum';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { CircleQuestionMark } from 'lucide-react';
import { validateCode } from '../../lib/utils';

interface NewHistoryDatabaseModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateSuccess: (data: { code: string; name: string; description: string; vendor: string }) => void;
}

const NewHistoryDatabaseDialog = (props: NewHistoryDatabaseModalProps) => {
	const { open, onOpenChange, onCreateSuccess } = props;
	const [vendor, setVendor] = useState<string>('');
	const [code, setCode] = useState<string>('');
	const [name, setName] = useState<string>('');
	const [description, setDescription] = useState<string>('');
	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!code || !name || !vendor) {
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
			vendor,
		});
		onOpenChange(false);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-visible">
				<DialogHeader>
					<DialogTitle>New History Database</DialogTitle>
					<DialogDescription>
						Configure parameters for your new history database, fields marked with * are required
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name flex items-center gap-1">
								<span>Code</span>
								<span className="text-red-500">*</span>
								<Tooltip>
									<TooltipTrigger className="cursor-pointer">
										<CircleQuestionMark className="w-4 h-4 text-gray-500 text-orange-500" />
									</TooltipTrigger>
									<TooltipContent>
										<p>Need to be consistent with the DB in the strategy code you upload</p>
									</TooltipContent>
								</Tooltip>
							</Label>
							<Input
								id="code"
								placeholder="Example: usstock-1d"
								value={code}
								onChange={(e) => setCode(e.target.value)}
							/>
							<span className="text-sm text-muted-foreground">
								DB unique identifier. Only lowercase letters, numbers, and hyphens are allowed. Must be
								globally unique and non-duplicated.
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
								Vendor<span className="text-red-500">*</span>
							</Label>
							<Select value={vendor} onValueChange={(value: string) => setVendor(value)}>
								<SelectTrigger id="vendor">
									<SelectValue placeholder="Select a vendor" />
								</SelectTrigger>
								<SelectContent>
									{VENDOR_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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
						<Button type="submit" className="cursor-pointer" disabled={!code || !name || !vendor}>
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default NewHistoryDatabaseDialog;
