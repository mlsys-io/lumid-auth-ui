// FinData embed surface (lumid.data prerequisite Tier E).
//
// Renders FinData's existing Vue SPA inside lum.id's dashboard frame
// via the same-origin reverse proxy at /findata-embed/. The Tier-A
// SSO bridge in stock-boot/src/main/java/.../security/lumid/
// LumidIdentityService.java accepts the lumid session bearer that
// nginx forwards as Authorization: Bearer $cookie_lm_session, so the
// user is auto-authed inside the iframe without a separate login.
//
// `?embed=1` query param signals the FinData layout to hide its own
// chrome (top bar, login button) — see front/src/layout/index.vue.
//
// Why iframe vs native React port? See the lumid.data prerequisite
// plan: ~12K LOC of polished Vue analytics that lumid.data will pick
// pages from selectively. Premature porting now is throwaway. The
// iframe is ~30 lines of React and trivial to delete when lumid.data
// dictates the right surface.

export default function DatasetsFindataPage() {
	return (
		<div className="flex flex-col h-[calc(100vh-4rem)]">
			<div className="px-4 py-2 border-b text-xs text-muted-foreground bg-muted/30">
				FinData v0.1 — embedded via{' '}
				<code>/findata-embed/</code>. SSO via the lumid session
				bearer; no separate login. Native React port arrives with
				lumid.data.
			</div>
			<iframe
				src="/findata-embed/?embed=1"
				className="flex-1 w-full border-0"
				title="Financial data"
				sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
			/>
		</div>
	);
}
