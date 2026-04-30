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
import { toast } from 'sonner';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { INGEST_TYPE_OPTIONS } from '../../lib/enum';
import { validateCode } from '../../lib/utils';

interface NewBundleModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// universesList: UniverseInfo[];
	onCreateSuccess: (data: {
		code: string;
		name: string;
		description: string;
		ingest_type: string;
		//	universe_code: string;
	}) => void;
}

const NewBundleDialog = (props: NewBundleModalProps) => {
	const { open, onOpenChange, onCreateSuccess } = props;
	const [code, setCode] = useState<string>('');
	const [name, setName] = useState<string>('');
	const [description, setDescription] = useState<string>('');
	const [ingestType, setIngestType] = useState<string>('');
	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!code || !name || !ingestType) {
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
			ingest_type: ingestType,
			//universe_code: universeCode,
		});
		onOpenChange(false);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-visible">
				<DialogHeader>
					<DialogTitle>New Bundle</DialogTitle>
					<DialogDescription>
						Configure parameters for your new bundle, fields marked with * are required
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
								unique identifier. Only lowercase letters, numbers, and hyphens are allowed. Must be
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
							<Label htmlFor="ingestType">
								Ingest Type<span className="text-red-500">*</span>
							</Label>
							<Select value={ingestType} onValueChange={(value) => setIngestType(value)}>
								<SelectTrigger>
									<SelectValue placeholder="Select an ingest type" />
								</SelectTrigger>
								<SelectContent>
									{INGEST_TYPE_OPTIONS.map((option) => (
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
						{/* <div className="space-y-2">
							<Label htmlFor="universeCode">Universe</Label>
							<Select value={universeCode} onValueChange={(value) => setUniverseCode(value)}>
								<SelectTrigger>
									<SelectValue placeholder="Select a universe" />
								</SelectTrigger>
								<SelectContent>
									{universesList.map((universe) => (
										<SelectItem key={universe.code} value={universe.code}>
											{universe.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div> */}
					</div>
					<DialogFooter className="mt-4">
						<Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
							Cancel
						</Button>
						<Button type="submit" className="cursor-pointer" disabled={!code || !name || !ingestType}>
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};

export default NewBundleDialog;
