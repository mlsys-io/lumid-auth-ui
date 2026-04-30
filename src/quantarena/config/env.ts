// Quant-arena env constants for the lumid_ui port.
//
// `API_BASE_URL` is unused in this port — the api/client.ts now
// derives BASE_URL from VITE_LQA_API_URL with a `https://lumid.market`
// default. Kept here only because lib/recaptcha.ts still imports
// RECAPTCHA_SITE_KEY from this module. Other constants (Google client
// id, etc.) are also unused: lumid_ui ports don't show login forms,
// auth happens at lum.id.

export const API_BASE_URL: string =
	(import.meta.env.VITE_LQA_API_URL as string | undefined) ??
	'https://lumid.market';

export const RECAPTCHA_SITE_KEY: string =
	(import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined) ?? '';

// Unused in the lumid_ui port; kept for compile compat with any QA
// page that imports it before we trim the migrated tree down.
export const GOOGLE_CLIENT_ID: string = '';
