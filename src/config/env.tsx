const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9988';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '';

export { API_BASE_URL, GOOGLE_CLIENT_ID, RECAPTCHA_SITE_KEY };
