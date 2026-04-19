import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock, AlertCircle, RefreshCw, BrainCircuit, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { ApiError } from '../../api';
import { confirmPasswordReset } from '../../api/password-reset';

// /reset-password — reads ?token= from the emailed link. User sets a
// new password; backend revokes every live session on success so the
// next screen walks the user back to /login for a fresh sign-in.
export default function ResetPassword() {
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const token = params.get('token') || '';

	const [pw, setPw] = useState('');
	const [confirm, setConfirm] = useState('');
	const [showPw, setShowPw] = useState(false);
	const [err, setErr] = useState('');
	const [loading, setLoading] = useState(false);
	const [done, setDone] = useState(false);

	useEffect(() => {
		if (!token) setErr('This link is missing a reset token.');
	}, [token]);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setErr('');
		if (pw.length < 8) {
			setErr('Password must be at least 8 characters');
			return;
		}
		if (pw !== confirm) {
			setErr('Passwords do not match');
			return;
		}
		setLoading(true);
		try {
			await confirmPasswordReset({ token, new_password: pw });
			setDone(true);
			toast.success('Password updated');
			// Redirect after a short dwell so the user reads the
			// confirmation before the page flips.
			setTimeout(() => navigate('/login'), 2000);
		} catch (e) {
			const msg = e instanceof ApiError ? e.message : 'Reset failed';
			setErr(msg);
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 px-4">
			<Card className="w-full max-w-md shadow-xl border-0 bg-white/80 backdrop-blur-sm">
				<CardHeader className="space-y-1 pb-6">
					<div className="flex justify-center mb-2">
						<div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-md">
							<BrainCircuit className="w-7 h-7 text-white" />
						</div>
					</div>
					<div className="text-center space-y-2">
						<h1 className="text-2xl font-bold">
							{done ? 'Password updated' : 'Choose a new password'}
						</h1>
						<p className="text-sm text-muted-foreground">
							{done
								? 'Every active session has been signed out. Redirecting you to sign in…'
								: 'Pick something you haven’t used on this account before.'}
						</p>
					</div>
				</CardHeader>

				<CardContent className="pb-8">
					{done ? (
						<div className="flex flex-col items-center gap-4 py-4">
							<CheckCircle2 className="w-12 h-12 text-emerald-500" />
							<Link
								to="/login"
								className="text-sm font-medium text-indigo-600 hover:underline"
							>
								Go to sign in now
							</Link>
						</div>
					) : (
						<form onSubmit={onSubmit} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="new-pw">New password</Label>
								<div className="relative">
									<Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
									<Input
										id="new-pw"
										type={showPw ? 'text' : 'password'}
										value={pw}
										onChange={(e) => setPw(e.target.value)}
										className="pl-10 pr-10"
										disabled={loading || !token}
										autoComplete="new-password"
										autoFocus
									/>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
										onClick={() => setShowPw(!showPw)}
										tabIndex={-1}
									>
										{showPw ? (
											<EyeOff className="h-4 w-4 text-muted-foreground" />
										) : (
											<Eye className="h-4 w-4 text-muted-foreground" />
										)}
									</Button>
								</div>
								<p className="text-xs text-muted-foreground">At least 8 characters.</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="confirm-pw">Confirm new password</Label>
								<div className="relative">
									<Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
									<Input
										id="confirm-pw"
										type={showPw ? 'text' : 'password'}
										value={confirm}
										onChange={(e) => setConfirm(e.target.value)}
										className="pl-10"
										disabled={loading || !token}
										autoComplete="new-password"
									/>
								</div>
							</div>

							{err && (
								<p className="text-sm text-destructive flex items-center gap-1">
									<AlertCircle className="w-3 h-3" />
									{err}
								</p>
							)}

							<Button
								type="submit"
								className="w-full h-12"
								disabled={loading || !token || !pw || !confirm}
							>
								{loading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
								Update password
							</Button>
						</form>
					)}

					<div className="mt-6 text-center">
						<Link
							to="/login"
							className="text-sm text-muted-foreground hover:text-indigo-600"
						>
							Back to sign in
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
