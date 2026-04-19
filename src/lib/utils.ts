import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Date formatting utilities
/**
 * Format Unix timestamp to date string: 2024-09-15
 */
export const formatDate = (timestamp: number): string => {
	const date = new Date(timestamp * 1000);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

/**
 * Format Unix timestamp to datetime string: 2024-09-15 14:30
 */
export const formatDateTime = (timestamp: number): string => {
	const date = new Date(timestamp * 1000);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}`;
};

/**
 * Format Unix timestamp to date string: MM/DD
 */
export const formatTimestampToMMDD = (timestamp: number): string => {
	const date = new Date(timestamp * 1000);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${month}/${day}`;
};

export const formatTimestampToMMSS = (timestamp: number): string => {
	const date = new Date(timestamp * 1000);
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
};
export const formatTimestampToDeatailDate = (timestamp: number): string => {
	const date = new Date(timestamp * 1000);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${month}/${day} ${hours}:${minutes}`;
};
export const formatTimestampToDateHour = (timestamp: number): string => {
	const date = new Date(timestamp * 1000);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	return `${year}/${month}/${day} ${hours}:00`;
};
/**
 * Format timestamp to two-line format: MM/DD on first line, HH:mm on second line
 * Returns string with newline character for chart display
 */
export const formatTimestampToTwoLines = (timestamp: number): string => {
	const date = new Date(timestamp * 1000);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${month}/${day}\n${hours}:${minutes}`;
};
/**
 * Format number to thousands (K) format
 * - If number >= 1000, convert to "XK" format
 * - If number < 1000, return original number
 * - If K value >= 1000, add thousand separators
 */
export const formatNumberToThousands = (number: number): string => {
	// If number is less than 1000, return as is
	if (number < 1000) {
		return number.toString();
	}

	// Convert to K format
	const kValue = number / 1000;

	// Format with thousand separators (automatically added when needed) and keep 1 decimal place if needed
	const formatted = kValue.toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 1,
	});
	return `${formatted}K`;
};

export const formatCurrency = (amount: number) => {
	return new Intl.NumberFormat('en-US', {
		useGrouping: true,
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	}).format(amount);
};

export const formatPercentage = (value: number) => {
	return `${(value * 100).toFixed(2)}%`;
};
export const getUserInitials = (username: string) => {
	return username
		.split(' ')
		.map((n) => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
};
/**
 * Validate code
 * - Only lowercase letters, numbers, and hyphens are allowed
 * - Maximum length is 255 characters
 */
export const validateCode = (code: string) => {
	return /^[a-z0-9-]+$/.test(code) && code.length <= 255;
};

// Helper function to round timestamp to hour boundary
export const roundToHour = (timestamp: number): number => {
	const date = new Date(timestamp * 1000);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return Math.floor(date.getTime() / 1000);
};

// Helper function to round timestamp to day boundary
export const roundToDay = (timestamp: number): number => {
	const date = new Date(timestamp * 1000);
	date.setHours(0);
	date.setMinutes(0);
	date.setSeconds(0);
	date.setMilliseconds(0);
	return Math.floor(date.getTime() / 1000);
};
