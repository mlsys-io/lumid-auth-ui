// Launch a browser that exists on THIS machine.
//
// Every suite here hardcoded `channel: 'chrome'`, which requires Google Chrome
// to be INSTALLED. It is not on the dev box, so all of them threw before their
// first assertion -- indistinguishable from nobody having run them. Prefer real
// Chrome when present (closest to what a user runs), fall back to Playwright's
// bundled chromium, which is already cached under ~/.cache/ms-playwright.
// CHROME=<path> overrides both.
export async function launchBrowser(chromium, opts = {}) {
	const base = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], ...opts };
	if (process.env.CHROME) return chromium.launch({ ...base, executablePath: process.env.CHROME });
	return chromium.launch({ ...base, channel: 'chrome' }).catch(() => chromium.launch(base));
}
