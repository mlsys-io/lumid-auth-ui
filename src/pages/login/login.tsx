import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import { toast } from 'sonner';
import { Eye, EyeOff, Mail, Lock, AlertCircle, RefreshCw } from 'lucide-react';
import { login as apiLogin, ApiError } from '../../api';
import type { LoginResponse } from '../../api';
import { GOOGLE_CLIENT_ID } from '../../config/env';
import { executeRecaptcha, isRecaptchaAvailable } from '../../lib/recaptcha';

interface LoginProps {
	onLogin: (token: string, userData: { id: number; username: string; email: string; avatar?: string }) => void;
}

const OAUTH_REDIRECT_URI = `${window.location.origin}/auth/callback`;

// Generate random state for CSRF protection
function generateRandomState(): string {
	const array = new Uint8Array(32);
	window.crypto.getRandomValues(array);
	return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Initiate Google OAuth flow
function initiateGoogleLogin() {
	const state = generateRandomState();

	// Store state in sessionStorage for verification
	sessionStorage.setItem('oauth_state', state);

	const params = new URLSearchParams({
		client_id: GOOGLE_CLIENT_ID,
		redirect_uri: OAUTH_REDIRECT_URI,
		response_type: 'code',
		scope: 'email profile',
		access_type: 'offline',
		prompt: 'consent',
		state: state,
	});
	// Redirect to Google OAuth
	window.location.href = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
}

export function Login({ onLogin }: LoginProps) {
	const navigate = useNavigate();
	const [showPassword, setShowPassword] = useState(false);
	const [loading, setLoading] = useState(false);

	// Form states
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');

	// Validation states
	const [emailError, setEmailError] = useState('');
	const [passwordError, setPasswordError] = useState('');

	// Email validation
	const validateEmail = (email: string) => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			setEmailError('Please enter a valid email address');
			return false;
		}
		if (email.length > 128) {
			setEmailError('Email must be less than 128 characters');
			return false;
		}
		setEmailError('');
		return true;
	};

	// Handle email login
	const handleEmailLogin = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateEmail(email)) return;
		if (!password) {
			setPasswordError('Password is required');
			return;
		}

		setLoading(true);
		setPasswordError('');

		try {
			// Execute reCAPTCHA v3
			let recaptchaToken = '';
			if (isRecaptchaAvailable()) {
				try {
					recaptchaToken = await executeRecaptcha('login');
				} catch (recaptchaError) {
					console.error('reCAPTCHA execution failed:', recaptchaError);
					toast.error('Security verification failed. Please try again.');
					setLoading(false);
					return;
				}
			}

			const response: LoginResponse = await apiLogin({
				email: email,
				password: password,
				recaptcha_token: recaptchaToken,
			});

			// Call parent onLogin with token and user info
			onLogin(response.token, response.user_info);
			toast.success(`Welcome back!`);
			// AuthGuard will automatically redirect to /strategy
		} catch (error) {
			if (error instanceof ApiError) {
				// API returned an error
				if (error.ret_code === 401 || error.message.includes('Invalid credentials')) {
					setPasswordError('Invalid email or password');
				} else {
					toast.error(error.message || 'Login failed. Please try again.');
				}
			} else {
				toast.error('Network error. Please check your connection.');
			}
		} finally {
			setLoading(false);
		}
	};

	// Handle Google login button click
	const handleGoogleLogin = () => {
		if (!GOOGLE_CLIENT_ID) {
			toast.error('Google OAuth is not configured. Please contact the administrator.');
			return;
		}
		initiateGoogleLogin();
	};

	const renderLoginForm = () => (
		<div className="space-y-6">
			{/* Google Login Button */}
			{GOOGLE_CLIENT_ID && (
				<>
					<Button
						variant="outline"
						className="w-full h-12"
						onClick={handleGoogleLogin}
						disabled={loading}
						type="button"
					>
						<svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
							<path
								fill="#4285F4"
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
							/>
							<path
								fill="#34A853"
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
							/>
							<path
								fill="#FBBC05"
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
							/>
							<path
								fill="#EA4335"
								d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
							/>
						</svg>
						Continue with Google
					</Button>

					<div className="relative">
						<div className="absolute inset-0 flex items-center">
							<Separator className="w-full" />
						</div>
						<div className="relative flex justify-center text-xs uppercase">
							<span className="bg-background px-2 text-muted-foreground">Or continue with email</span>
						</div>
					</div>
				</>
			)}

			{/* Email Login Form */}
			<form onSubmit={handleEmailLogin} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<div className="relative">
						<Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
						<Input
							id="email"
							type="email"
							placeholder="Enter your email"
							value={email}
							onChange={(e) => {
								setEmail(e.target.value);
								if (emailError) validateEmail(e.target.value);
							}}
							className="pl-10"
							disabled={loading}
							autoComplete="email"
						/>
					</div>
					{emailError && (
						<p className="text-sm text-destructive flex items-center gap-1">
							<AlertCircle className="w-3 h-3" />
							{emailError}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="password">Password</Label>
					<div className="relative">
						<Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
						<Input
							id="password"
							type={showPassword ? 'text' : 'password'}
							placeholder="Enter your password"
							value={password}
							onChange={(e) => {
								setPassword(e.target.value);
								if (passwordError) setPasswordError('');
							}}
							className="pl-10 pr-10"
							disabled={loading}
							autoComplete="current-password"
						/>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
							onClick={() => setShowPassword(!showPassword)}
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
					{passwordError && (
						<p className="text-sm text-destructive flex items-center gap-1">
							<AlertCircle className="w-3 h-3" />
							{passwordError}
						</p>
					)}
				</div>

				<Button type="submit" className="w-full h-12 cursor-pointer" disabled={loading || !email || !password}>
					{loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
					Sign In
				</Button>

				<div className="text-center text-sm">
					<span className="text-muted-foreground">Don't have an account? </span>
					<Button
						type="button"
						variant="link"
						className="p-0 h-auto font-semibold cursor-pointer"
						onClick={() => navigate('/register')}
						disabled={loading}
					>
						Sign Up
					</Button>
				</div>

				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<Separator className="w-full" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground">Or</span>
					</div>
				</div>

			</form>
		</div>
	);

	return (
		<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
			<div className="absolute inset-0 bg-grid-pattern opacity-5" />

			<Card className="w-full max-w-md mx-4 shadow-xl border-0 bg-white/80 backdrop-blur-sm">
				<CardHeader className="space-y-1 pb-6">
					<div className="text-center space-y-2">
						<h1 className="text-3xl font-bold">Welcome Back</h1>
						<p className="text-muted-foreground">Sign in to your Lumid QuantArena account</p>
					</div>
				</CardHeader>

				<CardContent className="pb-8">{renderLoginForm()}</CardContent>
			</Card>
		</div>
	);
}
