import { useState, useCallback, useMemo } from 'react';

// Email validation
export function useEmailValidation() {
	const [error, setError] = useState('');

	const validate = useCallback((email: string): boolean => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			setError('Please enter a valid email address');
			return false;
		}
		if (email.length > 128) {
			setError('Email must be less than 128 characters');
			return false;
		}
		setError('');
		return true;
	}, []);

	const clearError = useCallback(() => setError(''), []);

	return { error, validate, clearError, setError };
}

// Username validation
export function useUsernameValidation() {
	const [error, setError] = useState('');

	const validate = useCallback((username: string): boolean => {
		if (username.length < 3) {
			setError('Username must be at least 3 characters');
			return false;
		}
		if (username.length > 64) {
			setError('Username must be less than 64 characters');
			return false;
		}
		setError('');
		return true;
	}, []);

	const clearError = useCallback(() => setError(''), []);

	return { error, validate, clearError, setError };
}

// Password validation with strength calculation
export function usePasswordValidation() {
	const [error, setError] = useState('');
	const [strength, setStrength] = useState(0);

	const getCategories = useCallback((password: string) => {
		const categories = {
			uppercase: /[A-Z]/.test(password),
			lowercase: /[a-z]/.test(password),
			numbers: /[0-9]/.test(password),
			special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password),
		};
		const count = Object.values(categories).filter(Boolean).length;
		return { categories, count };
	}, []);

	const calculateStrength = useCallback(
		(password: string): number => {
			let str = 0;
			if (password.length >= 8 && password.length <= 128) str += 25;
			const { count } = getCategories(password);
			str += (count / 4) * 75;
			return Math.min(str, 100);
		},
		[getCategories]
	);

	const validate = useCallback(
		(password: string): { valid: boolean; message: string } => {
			if (password.length < 8) {
				return { valid: false, message: 'Password must be at least 8 characters' };
			}
			if (password.length > 128) {
				return { valid: false, message: 'Password must be at most 128 characters' };
			}

			// Check if password contains only allowed characters (A-Z, a-z, 0-9, and special characters)
			const allowedCharsRegex = /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]*$/;
			if (!allowedCharsRegex.test(password)) {
				return {
					valid: false,
					message: 'Password can only contain letters, numbers, and special characters',
				};
			}

			const { count } = getCategories(password);
			if (count < 3) {
				return {
					valid: false,
					message: 'Password must contain at least 3 of: uppercase, lowercase, numbers, special characters',
				};
			}

			return { valid: true, message: '' };
		},
		[getCategories]
	);

	const updateStrength = useCallback(
		(password: string) => {
			setStrength(calculateStrength(password));
		},
		[calculateStrength]
	);

	const strengthColor = useMemo(() => {
		if (strength < 30) return 'bg-indigo-200';
		if (strength < 60) return 'bg-indigo-500';
		if (strength < 80) return 'bg-indigo-700';
		return 'bg-indigo-900';
	}, [strength]);

	const strengthText = useMemo(() => {
		if (strength < 30) return 'Weak';
		if (strength < 60) return 'Fair';
		if (strength < 80) return 'Good';
		return 'Strong';
	}, [strength]);

	const strengthTextColor = useMemo(() => {
		if (strength < 30) return 'text-indigo-400';
		if (strength < 60) return 'text-indigo-600';
		if (strength < 80) return 'text-indigo-700';
		return 'text-indigo-800';
	}, [strength]);

	const clearError = useCallback(() => setError(''), []);

	return {
		error,
		strength,
		strengthColor,
		strengthText,
		strengthTextColor,
		validate,
		updateStrength,
		getCategories,
		clearError,
		setError,
	};
}
