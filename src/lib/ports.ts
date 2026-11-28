// Words for the Sandboxes page "Public ports" control: what each site's shared pool has free, and what to do next.
import type { PortPool } from "../api/sandboxes";

/** One site's pool in words: "home: 10 of 16 free", "nus: not available". */
export function poolLine(site: string, pool: PortPool): string {
	if (!pool.enabled) return `${site}: not available`;
	const free = pool.free ?? 0;
	return free === 0 ? `${site}: full (${pool.pool_size ?? 0} in use)` : `${site}: ${free} of ${pool.pool_size ?? 0} free`;
}

/** Button label: free ports at the site the page is on, or why there are none. */
export function portsButtonLabel(site: string, pool: PortPool): string {
	if (!pool.enabled) return "Public ports";
	const free = pool.free ?? 0;
	return free === 0 ? "Public ports · full" : `Public ports · ${free} free`;
}

/** The next action for someone with `running` live sandboxes at sites that publish ports. */
export function portsNextStep(running: number): string {
	return running === 0
		? "You have no running sandbox at a site with public ports. Start one and type the port in the form — or add it here once it is running."
		: "Pick a running sandbox below, type the port your service listens on inside it (Jupyter 8888, a web app 8000…) and an optional label.";
}
