// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { isOAuthContinuation, isSafeReturnTo } from "./return-to";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const AUTHZ = "/oauth/authorize?client_id=runmesh-broker&redirect_uri=https%3A%2F%2Frunmesh.ai%2Fapi%2Fauth%2Fcallback&state=x";
check("OIDC authorize continuation is a safe return_to (logged-out sign-in for every OAuth client)", () => {
	eq(isSafeReturnTo(AUTHZ), true, "safe");
	eq(isOAuthContinuation(AUTHZ), true, "continuation");
	eq(isOAuthContinuation("/oauth/authorize"), true, "bare");
});
check("open redirects and other server paths stay refused", () => {
	for (const bad of ["https://evil.example/", "//evil.example", "/oauth/token", "/oauth/authorizeX", "/api/v1/me", "javascript:alert(1)", ""]) {
		eq(isSafeReturnTo(bad), false, bad);
		eq(isOAuthContinuation(bad), false, bad);
	}
});
check("SPA prefixes unchanged, and they are not server navigations", () => {
	for (const ok of ["/studio", "/studio/apps/x", "/app", "/account", "/dashboard", "/onboarding/ready", "/"]) {
		eq(isSafeReturnTo(ok), true, ok);
		eq(isOAuthContinuation(ok), false, ok);
	}
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try {
			c.run();
		} catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;
