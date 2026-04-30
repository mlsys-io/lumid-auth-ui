import React from 'react';
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogCancel,
	AlertDialogAction,
} from './ui/alert-dialog';

interface ModalConfirmProps {
	title: string;
	description: string;
	onConfirm: () => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const ModalConfirm = ({ title, description, onConfirm, open, onOpenChange }: ModalConfirmProps) => {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title || 'Are you sure?'}</AlertDialogTitle>
					<AlertDialogDescription>{description || 'This action cannot be undone.'}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} className="bg-destructive hover:bg-destructive/90">
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

export default ModalConfirm;
