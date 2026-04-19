import React, { useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { AlertCircle, Loader2 } from 'lucide-react';
import { updateInvitationCode, ApiError } from '../../api';
import { toast } from 'sonner';

interface InvitationCodeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: (token: string) => void;
}

export default function InvitationCodeDialog({ open, onOpenChange, onSuccess }: InvitationCodeDialogProps) {
	// Share-link support — a user arriving at /register?code=<X> then
	// Google-OAuth'ing back here should see the code prefilled instead
	// of being asked to paste it again. Same query is read by the email
	// registration form.
	const [invitationCode, setInvitationCode] = useState(() => {
		if (typeof window === 'undefined') return '';
		const q = new URLSearchParams(window.location.search);
		return (q.get('code') || q.get('invite') || '').trim();
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>('');

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!invitationCode.trim()) {
			setError('Please enter an invitation code');
			return;
		}

		setLoading(true);
		setError('');

		try {
			const response = await updateInvitationCode({
				invitation_code: invitationCode.trim(),
			});

			toast.success('Invitation code verified successfully!');
			onSuccess(response.token);
			setInvitationCode('');
			onOpenChange(false);
		} catch (err) {
			const errorMessage = err instanceof ApiError ? err.message : 'Invalid invitation code. Please try again.';
			if (err instanceof ApiError) {
				setError(errorMessage);
			} else {
				setError(errorMessage);
			}
			toast.error(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const handleOpenChange = (newOpen: boolean) => {
		if (!loading) {
			onOpenChange(newOpen);
			if (!newOpen) {
				setInvitationCode('');
				setError('');
			}
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className="sm:max-w-[460px] h-[300px] [&>button]:hidden"
				onPointerDownOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>Enter Invitation Code</DialogTitle>
					<DialogDescription>
						This is your first time logging in with Google. Please enter your invitation code to continue.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="invitation-code">Invitation Code</Label>
							<Input
								id="invitation-code"
								value={invitationCode}
								onChange={(e) => {
									setInvitationCode(e.target.value);
									setError('');
								}}
								placeholder="Enter your invitation code"
								disabled={loading}
								autoFocus
								aria-invalid={!!error}
								aria-describedby={error ? 'invitation-code-error' : undefined}
							/>
							{error && (
								<div
									id="invitation-code-error"
									className="flex items-center gap-2 text-sm text-destructive"
									role="alert"
								>
									<AlertCircle className="h-4 w-4" />
									<span>{error}</span>
								</div>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button
							type="submit"
							disabled={loading || !invitationCode.trim()}
							className="w-full sm:w-auto cursor-pointer"
						>
							{loading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Verifying...
								</>
							) : (
								'Submit'
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
