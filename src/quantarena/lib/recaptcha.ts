import { RECAPTCHA_SITE_KEY } from '../config/env';

// Declare grecaptcha type for TypeScript
declare global {
	interface Window {
		grecaptcha: {
			ready: (callback: () => void) => void;
			execute: (siteKey: string, options: { action: string }) => Promise<string>;
		};
	}
}

// Track if script is loaded or loading
let scriptLoaded = false;
let scriptLoading = false;
let loadPromise: Promise<void> | null = null;

/**
 * Dynamically load reCAPTCHA v3 script
 * @returns Promise that resolves when script is loaded
 */
function loadRecaptchaScript(): Promise<void> {
	if (scriptLoaded) {
		return Promise.resolve();
	}

	if (scriptLoading && loadPromise) {
		return loadPromise;
	}

	if (!RECAPTCHA_SITE_KEY) {
		return Promise.reject(new Error('reCAPTCHA site key is not configured'));
	}

	scriptLoading = true;
	loadPromise = new Promise((resolve, reject) => {
		// Check if script already exists
		const existingScript = document.querySelector(`script[src*="recaptcha.net"]`);
		if (existingScript) {
			scriptLoaded = true;
			scriptLoading = false;
			resolve();
			return;
		}

		// Create script element
		const script = document.createElement('script');
		script.src = `https://www.recaptcha.net/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
		script.async = true;
		script.defer = true;

		script.onload = () => {
			scriptLoaded = true;
			scriptLoading = false;
			resolve();
		};

		script.onerror = () => {
			scriptLoading = false;
			loadPromise = null;
			reject(new Error('Failed to load reCAPTCHA script'));
		};

		document.head.appendChild(script);
	});

	return loadPromise;
}

/**
 * Execute reCAPTCHA v3 and get token
 * @param action - The action name (e.g., 'login', 'register')
 * @returns Promise with reCAPTCHA token
 */
export async function executeRecaptcha(action: string): Promise<string> {
	if (!RECAPTCHA_SITE_KEY) {
		console.warn('reCAPTCHA site key is not configured');
		return '';
	}

	// Ensure script is loaded
	await loadRecaptchaScript();

	return new Promise((resolve, reject) => {
		if (typeof window.grecaptcha === 'undefined') {
			reject(new Error('reCAPTCHA not loaded'));
			return;
		}

		window.grecaptcha.ready(() => {
			window.grecaptcha
				.execute(RECAPTCHA_SITE_KEY, { action })
				.then((token) => {
					resolve(token);
				})
				.catch((error) => {
					console.error('reCAPTCHA execution failed:', error);
					reject(error);
				});
		});
	});
}

/**
 * Check if reCAPTCHA is available
 */
export function isRecaptchaAvailable(): boolean {
	return !!RECAPTCHA_SITE_KEY;
}
