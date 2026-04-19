import React, { useState, useRef, useCallback, memo, useEffect } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Progress } from '../../components/ui/progress';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { toast } from 'sonner';
import {
	Eye,
	EyeOff,
	Mail,
	Lock,
	User,
	Shield,
	CheckCircle,
	AlertCircle,
	RefreshCw,
	Upload,
	Ticket,
} from 'lucide-react';
import { register as apiRegister, sendVerificationCode, ApiError } from '../../api';
import { useEmailValidation, useUsernameValidation, usePasswordValidation } from '../../hooks/useFormValidation';

interface RegisterProps {
	onSwitchToLogin: () => void;
	onRegisterSuccess: (email: string) => void;
}

export const Register = memo(function Register({ onSwitchToLogin, onRegisterSuccess }: RegisterProps) {
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const [loading, setLoading] = useState(false);

	// Form states
	const [email, setEmail] = useState('');
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [avatarBase64, setAvatarBase64] = useState<string>('');
	const [avatarPreview, setAvatarPreview] = useState<string>('');
	const [verificationCode, setVerificationCode] = useState('');
	// Share-link support — `https://lumid.market/register?code=<code>`
	// pre-fills the invitation code so the user doesn't need to paste
	// anything. Works for both the standalone /register route and any
	// future flows that embed Register in a modal.
	const [invitationCode, setInvitationCode] = useState(() => {
		if (typeof window === 'undefined') return '';
		const q = new URLSearchParams(window.location.search);
		return (q.get('code') || q.get('invite') || '').trim();
	});

	// Verification code states
	const [sendingCode, setSendingCode] = useState(false);
	const [countdown, setCountdown] = useState(0);
	const [codeSent, setCodeSent] = useState(false);

	// Validation hooks
	const emailValidation = useEmailValidation();
	const usernameValidation = useUsernameValidation();
	const passwordValidation = usePasswordValidation();

	// Refs
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Countdown timer effect
	useEffect(() => {
		if (countdown > 0) {
			const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
			return () => clearTimeout(timer);
		}
	}, [countdown]);

	// Send verification code handler
	const handleSendCode = useCallback(async () => {
		if (!emailValidation.validate(email)) {
			toast.error('Please enter a valid email address');
			return;
		}

		setSendingCode(true);

		try {
			await sendVerificationCode({ email });
			setCodeSent(true);
			setCountdown(60); // 60 seconds countdown
			toast.success('Verification code sent to your email');
		} catch (error) {
			if (error instanceof ApiError) {
				toast.error(error.message || 'Failed to send verification code');
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setSendingCode(false);
		}
	}, [email, emailValidation]);

	// Toggle handlers
	const toggleShowPassword = useCallback(() => setShowPassword((prev) => !prev), []);
	const toggleShowConfirmPassword = useCallback(() => setShowConfirmPassword((prev) => !prev), []);

	// Handle avatar upload
	const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			toast.error('Please select an image file');
			return;
		}

		if (file.size > 5 * 1024 * 1024) {
			toast.error('Image size must be less than 5MB');
			return;
		}

		const reader = new FileReader();
		reader.onloadend = () => {
			const base64String = reader.result as string;
			setAvatarBase64(base64String);
			setAvatarPreview(base64String);
		};
		reader.onerror = () => {
			toast.error('Failed to read image file');
		};
		reader.readAsDataURL(file);
	}, []);

	// Form field change handlers
	const handleUsernameChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = e.target.value;
			setUsername(value);
			if (usernameValidation.error) usernameValidation.validate(value);
		},
		[usernameValidation]
	);

	const handleEmailChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = e.target.value;
			setEmail(value);
			if (emailValidation.error) emailValidation.validate(value);
		},
		[emailValidation]
	);

	const handlePasswordChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = e.target.value;
			setPassword(value);
			passwordValidation.updateStrength(value);
			
			// Real-time validation for allowed characters
			if (value) {
				const validation = passwordValidation.validate(value);
				if (!validation.valid) {
					passwordValidation.setError(validation.message);
				} else {
					passwordValidation.clearError();
				}
			} else {
				passwordValidation.clearError();
			}
		},
		[passwordValidation]
	);

	const handleConfirmPasswordChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			setConfirmPassword(e.target.value);
			if (passwordValidation.error) passwordValidation.clearError();
		},
		[passwordValidation]
	);

	const handleAvatarClick = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	// Handle registration
	const handleRegister = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();

			if (!usernameValidation.validate(username)) return;
			if (!emailValidation.validate(email)) return;

			const validation = passwordValidation.validate(password);
			if (!validation.valid) {
				passwordValidation.setError(validation.message);
				return;
			}

			if (password !== confirmPassword) {
				passwordValidation.setError('Passwords do not match');
				return;
			}

			if (!verificationCode) {
				toast.error('Please enter the verification code');
				return;
			}

			setLoading(true);
			passwordValidation.clearError();

			try {
				await apiRegister({
					username,
					email,
					password,
					verification_code: verificationCode,
					avatar: avatarBase64 || undefined,
					invitation_code: invitationCode.trim() || undefined,
				});

				toast.success('Registration successful! Please log in.');
				onRegisterSuccess(email);
			} catch (error) {
				if (error instanceof ApiError) {
					if (error.message.includes('already exists') || error.message.includes('Username')) {
						usernameValidation.setError('Username already exists');
					} else if (error.message.includes('email')) {
						emailValidation.setError('Email already exists');
					} else {
						toast.error(error.message || 'Registration failed. Please try again.');
					}
				} else {
					toast.error('Network error. Please check your connection.');
				}
			} finally {
				setLoading(false);
			}
		},
		[
			username,
			email,
			password,
			confirmPassword,
			verificationCode,
			invitationCode,
			avatarBase64,
			usernameValidation,
			emailValidation,
			passwordValidation,
			onRegisterSuccess,
		]
	);

	const { categories } = passwordValidation.getCategories(password);
	const isPasswordValid = passwordValidation.validate(password).valid;
	const isFormValid =
		username && email && password && confirmPassword && verificationCode && isPasswordValid && invitationCode;

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
			<div className="container mx-auto px-4 py-8">
				<Card className="w-full max-w-2xl mx-auto shadow-lg border border-gray-200 bg-white">
					<CardHeader className="pt-6">
						<div className="text-center space-y-2">
							<h1 className="text-3xl font-bold">Create Account</h1>
							<p className="text-muted-foreground">Join Lumid QuantArena to start trading</p>
						</div>
					</CardHeader>

					<CardContent className="pb-8 px-8">
						<form onSubmit={handleRegister} className="space-y-4">
							{/* Avatar Upload */}
							<div className="flex flex-col items-center gap-2 pb-1">
								<Avatar className="w-16 h-16 border-2 border-primary/20">
									<AvatarImage src={avatarPreview} alt="Avatar preview" />
									<AvatarFallback className="text-base bg-primary/5">
										{username ? username[0]?.toUpperCase() : <User className="w-6 h-6" />}
									</AvatarFallback>
								</Avatar>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleAvatarClick}
									disabled={loading}
									className="text-xs h-7"
								>
									<Upload className="w-3 h-3 mr-1" />
									Upload Avatar
								</Button>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={handleAvatarChange}
									disabled={loading}
								/>
							</div>

							{/* Form Fields in Single Column Layout */}
							<div className="space-y-4">
								{/* Username */}
								<div className="space-y-1.5">
									<div className="flex items-center gap-3">
										<Label htmlFor="username" className="w-32 text-sm font-medium text-right">
											Username
										</Label>
										<div className="relative flex-1">
											<User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
											<Input
												id="username"
												type="text"
												placeholder="Choose a username"
												value={username}
												onChange={handleUsernameChange}
												className="pl-10 h-9"
												disabled={loading}
												autoComplete="username"
											/>
										</div>
									</div>
									{usernameValidation.error && (
										<p className="text-xs text-destructive flex items-center gap-1 ml-[calc(8rem+0.75rem)]">
											<AlertCircle className="w-3 h-3" />
											{usernameValidation.error}
										</p>
									)}
									{!usernameValidation.error && (
										<p className="text-xs text-muted-foreground ml-[calc(8rem+0.75rem)]">
											3-64 characters
										</p>
									)}
								</div>

								{/* Email */}
								<div className="space-y-1.5">
									<div className="flex items-center gap-3">
										<Label htmlFor="register-email" className="w-32 text-sm font-medium text-right">
											Email
										</Label>
										<div className="relative flex-1">
											<Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
											<Input
												id="register-email"
												type="email"
												placeholder="Enter your email"
												value={email}
												onChange={handleEmailChange}
												className="pl-10 h-9"
												disabled={loading}
												autoComplete="email"
											/>
										</div>
									</div>
									{emailValidation.error && (
										<p className="text-xs text-destructive flex items-center gap-1 ml-[calc(8rem+0.75rem)]">
											<AlertCircle className="w-3 h-3" />
											{emailValidation.error}
										</p>
									)}
								</div>

								{/* Verification Code */}
								<div className="space-y-1.5">
									<div className="flex items-center gap-3">
										<Label
											htmlFor="verification-code"
											className="w-32 text-sm font-medium text-right"
										>
											Verification Code
										</Label>
										<div className="flex gap-2 flex-1">
											<div className="relative flex-1">
												<Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
												<Input
													id="verification-code"
													type="text"
													placeholder="Enter 6-digit code"
													value={verificationCode}
													onChange={(e) => setVerificationCode(e.target.value)}
													className="pl-10 h-9"
													disabled={loading}
													maxLength={6}
													autoComplete="off"
												/>
											</div>
											<Button
												type="button"
												variant="outline"
												onClick={handleSendCode}
												disabled={!email || sendingCode || countdown > 0 || loading}
												className="whitespace-nowrap h-9 px-6"
											>
												{sendingCode ? (
													<RefreshCw className="w-4 h-4 animate-spin" />
												) : countdown > 0 ? (
													`Resend (${countdown}s)`
												) : codeSent ? (
													'Resend'
												) : (
													'Send'
												)}
											</Button>
										</div>
									</div>
									<p className="text-xs text-muted-foreground ml-[calc(8rem+0.75rem)]">
										A 6-digit code will be sent to your email
									</p>
								</div>

								{/* Invitation Code */}
								<div className="space-y-1.5">
									<div className="flex items-center gap-3">
										<Label
											htmlFor="invitation-code"
											className="w-32 text-sm font-medium text-right"
										>
											Invitation Code
										</Label>
										<div className="relative flex-1">
											<Ticket className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
											<Input
												id="invitation-code"
												type="text"
												placeholder="Enter invitation code"
												value={invitationCode}
												onChange={(e) => setInvitationCode(e.target.value)}
												className="pl-10 h-9"
												disabled={loading}
												autoComplete="off"
											/>
										</div>
									</div>
								</div>

								{/* Password */}
								<div className="space-y-1.5">
									<div className="flex items-center gap-3">
										<Label htmlFor="new-password" className="w-32 text-sm font-medium text-right">
											Password
										</Label>
										<div className="relative flex-1">
											<Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
											<Input
												id="new-password"
												type={showPassword ? 'text' : 'password'}
												placeholder="Create a password"
												value={password}
												onChange={handlePasswordChange}
												className="pl-10 pr-10 h-9"
												disabled={loading}
												autoComplete="new-password"
											/>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
												onClick={toggleShowPassword}
												disabled={loading}
												tabIndex={-1}
											>
												{showPassword ? (
													<EyeOff className="h-4 w-4 text-muted-foreground" />
												) : (
													<Eye className="h-4 w-4 text-muted-foreground" />
												)}
											</Button>
										</div>
									</div>
									{password && (
										<div className="ml-[calc(8rem+0.75rem)] space-y-1">
											<div className="flex items-center justify-between text-xs">
												<span className="text-muted-foreground">Strength:</span>
												<span className={`font-medium ${passwordValidation.strengthTextColor}`}>
													{passwordValidation.strengthText}
												</span>
											</div>
											<Progress
												value={passwordValidation.strength}
												className={`h-1.5 ${passwordValidation.strengthColor}`}
											/>
										</div>
									)}
								</div>

								{/* Confirm Password */}
								<div className="space-y-1.5">
									<div className="flex items-center gap-3">
										<Label
											htmlFor="confirm-password"
											className="w-32 text-sm font-medium text-right"
										>
											Confirm Password
										</Label>
										<div className="relative flex-1">
											<Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
											<Input
												id="confirm-password"
												type={showConfirmPassword ? 'text' : 'password'}
												placeholder="Confirm your password"
												value={confirmPassword}
												onChange={handleConfirmPasswordChange}
												className="pl-10 pr-10 h-9"
												disabled={loading}
												autoComplete="new-password"
											/>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
												onClick={toggleShowConfirmPassword}
												disabled={loading}
												tabIndex={-1}
											>
												{showConfirmPassword ? (
													<EyeOff className="h-4 w-4 text-muted-foreground" />
												) : (
													<Eye className="h-4 w-4 text-muted-foreground" />
												)}
											</Button>
										</div>
									</div>
								</div>
							</div>

							{passwordValidation.error && (
								<p className="text-sm text-destructive flex items-center gap-1 ml-[calc(8rem+0.75rem)]">
									<AlertCircle className="w-3 h-3" />
									{passwordValidation.error}
								</p>
							)}

							{/* Password Requirements - Compact Grid Layout */}
							<div className="bg-muted/30 p-3 rounded-lg">
								<div className="flex items-center gap-2 text-xs font-medium mb-2">
									<Shield className="w-3.5 h-3.5 text-muted-foreground" />
									<span>Password Requirements:</span>
								</div>
								<div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
									<div className="flex items-center gap-1.5">
										{password.length >= 8 && password.length <= 128 ? (
											<CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
										) : (
											<div className="w-3 h-3 rounded-full border border-muted-foreground flex-shrink-0" />
										)}
										<span>8-128 chars</span>
									</div>
									<div className="flex items-center gap-1.5">
										{categories.uppercase ? (
											<CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
										) : (
											<div className="w-3 h-3 rounded-full border border-muted-foreground flex-shrink-0" />
										)}
										<span>Uppercase (A-Z)</span>
									</div>
									<div className="flex items-center gap-1.5">
										{categories.lowercase ? (
											<CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
										) : (
											<div className="w-3 h-3 rounded-full border border-muted-foreground flex-shrink-0" />
										)}
										<span>Lowercase (a-z)</span>
									</div>
									<div className="flex items-center gap-1.5">
										{categories.numbers ? (
											<CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
										) : (
											<div className="w-3 h-3 rounded-full border border-muted-foreground flex-shrink-0" />
										)}
										<span>Numbers (0-9)</span>
									</div>
									<div className="flex items-center gap-1.5 col-span-2 md:col-span-1">
										{categories.special ? (
											<CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
										) : (
											<div className="w-3 h-3 rounded-full border border-muted-foreground flex-shrink-0" />
										)}
										<span>Special chars</span>
									</div>
									<div className="flex items-center gap-1.5">
										{passwordValidation.getCategories(password).count >= 3 ? (
											<CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
										) : (
											<div className="w-3 h-3 rounded-full border border-muted-foreground flex-shrink-0" />
										)}
										<span>At least 3 types</span>
									</div>
								</div>
							</div>

							<div className="flex flex-col items-center gap-3 pt-2">
								<Button
									type="submit"
									className="w-full max-w-md cursor-pointer"
									disabled={loading || !isFormValid}
								>
									{loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
									Create Account
								</Button>

								<div className="text-center text-sm">
									<span className="text-muted-foreground">Already have an account? </span>
									<Button
										type="button"
										variant="link"
										className="p-0 h-auto font-semibold cursor-pointer"
										onClick={onSwitchToLogin}
										disabled={loading}
									>
										Sign In
									</Button>
								</div>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
});
