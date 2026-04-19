import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, AlertCircle, RefreshCw, BrainCircuit } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { requestPasswordReset } from '../../api/password-reset';

// /forgot-password — public page. Email goes in, a neutral confirmation
// comes back regardless of whether the address exists. The *content*
// of the acknowledgement is intentionally vague so this page can't be
// used as an email-enumeration oracle.
export default function ForgotPassword() {
	const [email, setEmail] = useState('');
	const [emailError, setEmailError] = useState('');
	const [loading, setLoading] = useState(false);
	const [sent, setSent] = useState(false);

	const validate = () => {
		const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
		setEmailError(ok ? '' : 'Enter a valid email address');
		return ok;
	};

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!validate()) return;
		setLoading(true);
		try {
			await requestPasswordReset(email.trim().toLowerCase());
			setSent(true);
		} catch {
			// Backend always 200s — only a network error lands here.
			// Still show the neutral success state; retry button sits
			// on the confirmation panel anyway.
			setSent(true);
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
						<h1 className="text-2xl font-bold">Reset your password</h1>
						<p className="text-sm text-muted-foreground">
							{sent
								? 'Check your inbox — if there’s a lum.id account for that address, a reset link is on its way.'
								: 'Enter the email on your lum.id account and we’ll send you a link to set a new password.'}
						</p>
					</div>
				</CardHeader>

				<CardContent className="pb-8">
					{!sent ? (
						<form onSubmit={onSubmit} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<div className="relative">
									<Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
									<Input
										id="email"
										type="email"
										placeholder="you@lum.id"
										value={email}
										onChange={(e) => {
											setEmail(e.target.value);
											if (emailError) setEmailError('');
										}}
										className="pl-10"
										disabled={loading}
										autoComplete="email"
										autoFocus
									/>
								</div>
								{emailError && (
									<p className="text-sm text-destructive flex items-center gap-1">
										<AlertCircle className="w-3 h-3" />
										{emailError}
									</p>
								)}
							</div>

							<Button
								type="submit"
								className="w-full h-12"
								disabled={loading || !email}
							>
								{loading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
								Send reset link
							</Button>
						</form>
					) : (
						<div className="space-y-4">
							<div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
								If an account exists for <strong>{email}</strong>, you’ll get a link
								within a minute. The link is single-use and expires in 30 minutes.
							</div>
							<Button
								variant="outline"
								className="w-full"
								onClick={() => {
									setSent(false);
									setEmail('');
								}}
							>
								Use a different email
							</Button>
						</div>
					)}

					<div className="mt-6 text-center">
						<Link
							to="/login"
							className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-indigo-600"
						>
							<ArrowLeft className="w-3 h-3" />
							Back to sign in
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
