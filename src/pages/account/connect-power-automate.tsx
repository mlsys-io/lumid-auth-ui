// /dashboard/account/connect/power-automate — Outlook bridge via
// Power Automate.
//
// Workaround for users whose org blocks Microsoft Graph OAuth: instead
// of registering an Azure AD app, the user builds two simple Power
// Automate flows that bridge Outlook ↔ Lumid via webhooks.
//
//   Inbound (Outlook → Lumid): user pastes our minted URL into a
//   "When a new email arrives" → HTTP POST flow. We persist only
//   SHA-256(token); the raw URL is shown ONCE at mint.
//
//   Outbound (Lumid → Outlook): user creates an "HTTP request received"
//   trigger → "Send email (V2)" flow; pastes its URL into our secret
//   POWER_AUTOMATE_SEND_URL. (Outbound wiring lands with the
//   outlook-pa-mcp skill in the next PR; this page already accepts
//   the URL so users can set it now.)

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import apiClient from '../../api/client';

interface TokenStatus {
	configured: boolean;
	issued_at?: string;
	last_used_at?: string | null;
	use_count?: number;
}

interface SecretRow {
	key: string;
	updated_at?: string;
	is_set?: boolean;
}

const OUTLOOK_PA_APP = 'lumid-outlook-pa';
const SEND_URL_KEY = 'POWER_AUTOMATE_SEND_URL';

export default function ConnectPowerAutomatePage() {
	const [status, setStatus] = useState<TokenStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [freshUrl, setFreshUrl] = useState<string | null>(null); // raw URL shown ONCE after mint
	const [copied, setCopied] = useState(false);

	// Outbound — POWER_AUTOMATE_SEND_URL stored as app_secret on
	// lumid-outlook-pa. We only know whether it's set + when, not the
	// value (the value endpoint is server-to-service only; browser
	// shouldn't surface plaintext URLs that carry SAS tokens).
	const [sendUrlSet, setSendUrlSet] = useState<SecretRow | null>(null);
	const [sendUrlInput, setSendUrlInput] = useState('');
	const [savingSendUrl, setSavingSendUrl] = useState(false);

	// Test-send state — result of the most recent live POST through
	// the user's Power Automate flow. The endpoint never exposes the
	// URL itself, just the upstream status code + a short response
	// snippet so the user can tell apart 202 (queued) from a 4xx
	// (schema mismatch / disabled flow).
	const [testResult, setTestResult] = useState<{
		ok: boolean; status?: number; preview?: string; sent_to?: string;
	} | null>(null);
	const [testing, setTesting] = useState(false);

	const loadSendUrlStatus = async () => {
		try {
			const r = await apiClient.get(`/api/v1/me/apps/${OUTLOOK_PA_APP}/secrets`);
			const rows = ((r.data?.data?.secrets) || []) as SecretRow[];
			const match = rows.find((s) => s.key === SEND_URL_KEY) || null;
			setSendUrlSet(match);
		} catch {
			setSendUrlSet(null);
		}
	};

	const saveSendUrl = async () => {
		const v = sendUrlInput.trim();
		if (!v) {
			toast.error('Paste a URL first');
			return;
		}
		// Power Automate trigger URLs are always https + start with
		// https://prod-XX.<region>.logic.azure.com:443/workflows/…
		if (!/^https:\/\//i.test(v)) {
			toast.error('URL must start with https://');
			return;
		}
		setSavingSendUrl(true);
		try {
			await apiClient.put(
				`/api/v1/me/apps/${OUTLOOK_PA_APP}/secrets/${SEND_URL_KEY}`,
				{ value: v },
			);
			toast.success('Send URL saved');
			setSendUrlInput('');
			await loadSendUrlStatus();
		} catch (e) {
			toast.error((e as Error)?.message || 'Save failed');
		} finally {
			setSavingSendUrl(false);
		}
	};

	const deleteSendUrl = async () => {
		setSavingSendUrl(true);
		try {
			await apiClient.delete(`/api/v1/me/apps/${OUTLOOK_PA_APP}/secrets/${SEND_URL_KEY}`);
			toast.success('Send URL removed');
			await loadSendUrlStatus();
		} catch (e) {
			toast.error((e as Error)?.message || 'Delete failed');
		} finally {
			setSavingSendUrl(false);
		}
	};

	const downloadFlowTemplate = async () => {
		// Use apiClient with responseType=blob so the bearer header is
		// applied. We can't use a plain <a href> because the endpoint
		// is bearer-gated, not session-cookie-gated.
		try {
			const r = await apiClient.get(
				'/api/v1/me/power-automate-tokens/flow-template',
				{ responseType: 'blob' },
			);
			const blob = new Blob([r.data], { type: 'application/zip' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'lumid-outlook-bridge.zip';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			toast.success('Template downloaded — webhook URL is baked in.');
			await loadStatus();
		} catch (e: any) {
			toast.error(e?.response?.data?.message || e?.message || 'Download failed');
		}
	};

	const runTestSend = async () => {
		setTesting(true);
		setTestResult(null);
		try {
			const r = await apiClient.post(
				`/api/v1/me/apps/${OUTLOOK_PA_APP}/test-send`,
				{}, // empty body — backend defaults to caller's email + standard subject/body
			);
			const data = r.data?.data || {};
			const result = {
				ok: Boolean(data.flow_ok),
				status: data.flow_status as number | undefined,
				preview: String(data.flow_response_preview || ''),
				sent_to: String(data.sent_to || ''),
			};
			setTestResult(result);
			if (result.ok) toast.success(`Test queued — check ${result.sent_to}`);
			else toast.error(`Flow returned ${result.status} — see details below`);
		} catch (e: any) {
			const msg = e?.response?.data?.message || e?.message || 'Test failed';
			setTestResult({ ok: false, preview: msg });
			toast.error(msg);
		} finally {
			setTesting(false);
		}
	};

	const loadStatus = async () => {
		try {
			const r = await apiClient.get('/api/v1/me/power-automate-tokens');
			setStatus(r.data?.data || { configured: false });
		} catch {
			setStatus({ configured: false });
		}
	};
	useEffect(() => { loadStatus(); loadSendUrlStatus(); }, []);

	const mint = async () => {
		setBusy(true);
		try {
			const r = await apiClient.post('/api/v1/me/power-automate-tokens', {});
			const data = r.data?.data as { webhook_url?: string } | undefined;
			if (!data?.webhook_url) throw new Error('No webhook URL returned');
			setFreshUrl(data.webhook_url);
			toast.success(status?.configured ? 'Rotated — paste the new URL into Power Automate' : 'Webhook URL minted');
			await loadStatus();
		} catch (e) {
			toast.error((e as Error)?.message || 'Failed to mint webhook URL');
		} finally {
			setBusy(false);
		}
	};

	const revoke = async () => {
		setBusy(true);
		try {
			await apiClient.delete('/api/v1/me/power-automate-tokens');
			setFreshUrl(null);
			toast.success('Webhook revoked');
			await loadStatus();
		} catch (e) {
			toast.error((e as Error)?.message || 'Failed to revoke');
		} finally {
			setBusy(false);
		}
	};

	const copyUrl = async () => {
		if (!freshUrl) return;
		try {
			await navigator.clipboard.writeText(freshUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error('Copy failed — select the URL manually');
		}
	};

	return (
		<div className="max-w-2xl mx-auto p-6 space-y-6">
			<div>
				<div className="text-xs font-medium text-indigo-500 uppercase tracking-widest">
					Outlook · Power Automate Bridge
				</div>
				<h1 className="text-3xl font-bold mt-1">Connect Outlook</h1>
				<p className="text-sm text-muted-foreground mt-2">
					Workaround for orgs that block direct Microsoft Graph OAuth.
					Build two Power Automate flows — one that forwards new email to
					Lumid via webhook, one that sends mail back through Outlook on
					Lumid's behalf. No Azure app registration needed; uses your
					existing tenant-level approval of Power Automate.
				</p>
			</div>

			{/* ── Inbound webhook ─────────────────────────────────── */}
			<section className="rounded-lg border bg-card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">Inbound — Outlook → Lumid</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Mint a per-user webhook URL and paste it into a Power
						Automate flow's HTTP action. The URL is your only secret;
						anyone who has it can post fake email into your Lumid inbox.
					</p>
				</div>

				{status === null ? (
					<div className="text-sm text-muted-foreground italic">Loading…</div>
				) : status.configured ? (
					<div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm space-y-1">
						<div className="font-medium text-emerald-700">✓ Webhook configured</div>
						<div className="text-xs text-muted-foreground">
							Issued {fmtAbs(status.issued_at)}
							{status.last_used_at
								? <> · last received {fmtRel(status.last_used_at)} · {status.use_count ?? 0} email{(status.use_count ?? 0) === 1 ? '' : 's'} forwarded</>
								: <> · not yet used</>}
						</div>
					</div>
				) : (
					<div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
						No webhook yet — mint one to begin.
					</div>
				)}

				{freshUrl && (
					<div className="rounded-md border border-amber-300 bg-amber-50 p-4 space-y-2">
						<div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
							Save this URL — it won't be shown again
						</div>
						<div className="flex gap-2 items-center">
							<code className="flex-1 text-[11px] font-mono break-all bg-white border border-amber-200 rounded px-2 py-1.5">
								{freshUrl}
							</code>
							<Button size="sm" variant="outline" onClick={copyUrl}>
								{copied ? '✓ Copied' : 'Copy'}
							</Button>
						</div>
						<div className="text-xs text-amber-800">
							Paste into your Power Automate flow's <strong>HTTP</strong> action URI field.
						</div>
					</div>
				)}

				<div className="flex gap-3 flex-wrap">
					<Button onClick={mint} disabled={busy}>
						{status?.configured ? 'Rotate webhook' : 'Mint webhook URL'}
					</Button>
					<Button variant="outline" onClick={downloadFlowTemplate} disabled={busy}>
						⬇ Download Power Automate flow (.zip)
					</Button>
					{status?.configured && (
						<Button variant="outline" onClick={revoke} disabled={busy}>
							Revoke
						</Button>
					)}
				</div>

				<p className="text-[11px] text-muted-foreground leading-relaxed">
					The .zip download <strong>rotates the webhook</strong> and bakes the new
					URL straight into a ready-to-import flow. At make.powerautomate.com →
					My flows → Import → upload, you confirm the Outlook connection and
					save — no URL editing needed. Any existing flow using a prior webhook
					stops working when you download.
				</p>
			</section>

			{/* ── Setup instructions ─────────────────────────────── */}
			<section className="rounded-lg border bg-card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">Power Automate setup</h2>
					<p className="text-sm text-muted-foreground mt-1">
						In <a className="text-emerald-700 hover:underline" href="https://make.powerautomate.com" target="_blank" rel="noreferrer">make.powerautomate.com</a>:
					</p>
				</div>

				<ol className="text-sm space-y-3 list-decimal pl-5">
					<li>
						<strong>Create → Automated cloud flow.</strong>
					</li>
					<li>
						<strong>Trigger:</strong> <code>When a new email arrives (V3)</code> (Office 365 Outlook).
						Sign into Outlook on first use; leave folder as <code>Inbox</code>.
					</li>
					<li>
						<strong>+ New step → HTTP:</strong>
						<ul className="mt-1.5 ml-4 space-y-1 list-disc text-xs text-muted-foreground">
							<li>Method: <code>POST</code></li>
							<li>URI: paste your webhook URL above</li>
							<li>Headers: <code>Content-Type: application/json</code></li>
							<li>Body: see template below</li>
						</ul>
					</li>
					<li><strong>Save</strong> — flow is auto-enabled.</li>
				</ol>

				<details className="text-xs">
					<summary className="cursor-pointer text-emerald-700 hover:underline font-medium">
						Show body template (copy + paste)
					</summary>
					<pre className="mt-2 bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto leading-relaxed">{
`{
  "id":          "@{triggerOutputs()?['body/id']}",
  "from":        "@{triggerOutputs()?['body/from']}",
  "to":          "@{triggerOutputs()?['body/to']}",
  "subject":     "@{triggerOutputs()?['body/subject']}",
  "body":        "@{triggerOutputs()?['body/bodyPreview']}",
  "html":        "@{triggerOutputs()?['body/body']}",
  "received_at": "@{triggerOutputs()?['body/receivedDateTime']}"
}`
}</pre>
				</details>
			</section>

			{/* ── Outbound — Lumid → Outlook ─────────────────────── */}
			<section className="rounded-lg border bg-card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">Outbound — Lumid → Outlook</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Build a second Power Automate flow that receives HTTP POSTs from Lumid and sends mail through
						your Outlook on your behalf. The flow's generated URL is stored as the per-app secret
						<code className="mx-1">POWER_AUTOMATE_SEND_URL</code>.
					</p>
				</div>

				<ol className="text-sm space-y-3 list-decimal pl-5">
					<li>
						<strong>Create → Instant cloud flow.</strong>
					</li>
					<li>
						<strong>Trigger:</strong> <code>When an HTTP request is received</code>. After saving once
						Power Automate generates a POST URL with an embedded SAS token — copy it.
					</li>
					<li>
						<strong>Request body schema</strong> — paste this so the next step can reference fields:
						<details className="mt-1.5 text-xs">
							<summary className="cursor-pointer text-emerald-700 hover:underline font-medium">
								Show schema
							</summary>
							<pre className="mt-2 bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto leading-relaxed">{
`{
  "type": "object",
  "properties": {
    "to":          { "type": "string" },
    "cc":          { "type": "string" },
    "subject":     { "type": "string" },
    "body":        { "type": "string" },
    "is_html":     { "type": "boolean" },
    "reply_to_id": { "type": "string" }
  }
}`
}</pre>
						</details>
					</li>
					<li>
						<strong>+ New step → Send an email (V2)</strong> (Office 365 Outlook). Map:
						<ul className="mt-1 ml-4 space-y-0.5 list-disc text-xs text-muted-foreground">
							<li>To: <code>@&#123;triggerBody()?[&apos;to&apos;]&#125;</code></li>
							<li>Subject: <code>@&#123;triggerBody()?[&apos;subject&apos;]&#125;</code></li>
							<li>Body: <code>@&#123;triggerBody()?[&apos;body&apos;]&#125;</code></li>
						</ul>
					</li>
					<li>
						<strong>Paste the flow URL</strong> from step 2 below.
					</li>
				</ol>

				{/* The save input. Same UX as the mint button above. */}
				<div className="rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
					{sendUrlSet?.is_set ? (
						<div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm space-y-1">
							<div className="font-medium text-emerald-700">✓ Send URL saved</div>
							{sendUrlSet.updated_at && (
								<div className="text-xs text-muted-foreground">
									Last updated {fmtAbs(sendUrlSet.updated_at)} · the URL is encrypted at rest and never shown back to the browser.
								</div>
							)}
						</div>
					) : (
						<div className="text-xs text-muted-foreground">
							Not yet configured. Without this, the outlook-pa skill can&apos;t send mail.
						</div>
					)}

					<div className="flex gap-2 items-start">
						<input
							type="url"
							value={sendUrlInput}
							onChange={(e) => setSendUrlInput(e.target.value)}
							placeholder="https://prod-XX.region.logic.azure.com:443/workflows/…/triggers/manual/paths/invoke?…"
							className="flex-1 text-xs font-mono px-3 py-2 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400"
							autoComplete="off"
							spellCheck={false}
						/>
						<Button onClick={saveSendUrl} disabled={savingSendUrl || !sendUrlInput.trim()}>
							{sendUrlSet?.is_set ? 'Update' : 'Save'}
						</Button>
						{sendUrlSet?.is_set && (
							<Button variant="outline" onClick={deleteSendUrl} disabled={savingSendUrl}>
								Clear
							</Button>
						)}
					</div>

					<p className="text-[11px] text-muted-foreground leading-relaxed">
						Paste the full <em>HTTP POST URL</em> shown after saving your Power Automate flow — it
						includes a SAS token after <code>?sv=</code>. Stored encrypted as the per-app secret
						<code className="mx-1">POWER_AUTOMATE_SEND_URL</code> for the <code>lumid-outlook-pa</code> app.
					</p>
				</div>

				{/* Live end-to-end test. Calls /me/apps/lumid-outlook-pa/test-send
				    which fetches the stored URL server-side and POSTs through it. */}
				<div className="rounded-md border border-slate-200 bg-white p-4 space-y-3">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<div className="text-sm font-medium">Send a test email</div>
							<div className="text-[11px] text-muted-foreground mt-0.5">
								Posts a real message through your flow — to your own account by default. Check your
								Outlook inbox + Sent folder.
							</div>
						</div>
						<Button onClick={runTestSend} disabled={testing || !sendUrlSet?.is_set}>
							{testing ? 'Sending…' : 'Test send'}
						</Button>
					</div>

					{testResult && (
						<div className={[
							'rounded-md border px-3 py-2 text-xs space-y-1',
							testResult.ok
								? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900'
								: 'border-rose-500/30 bg-rose-500/10 text-rose-900',
						].join(' ')}>
							<div className="font-medium">
								{testResult.ok
									? `✓ Flow accepted the request${testResult.status ? ` (HTTP ${testResult.status})` : ''}`
									: `✗ Flow rejected${testResult.status ? ` (HTTP ${testResult.status})` : ''}`}
								{testResult.sent_to && <span className="ml-1 opacity-80">→ {testResult.sent_to}</span>}
							</div>
							{testResult.preview && (
								<pre className="font-mono text-[10px] bg-white/60 border border-current/10 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
									{testResult.preview}
								</pre>
							)}
							{testResult.ok && (
								<div className="text-[11px] opacity-80">
									Power Automate accepted the message; delivery is async. If nothing arrives in
									~30 sec, check the flow's run history in <code>make.powerautomate.com</code> for
									the actual error.
								</div>
							)}
						</div>
					)}
				</div>
			</section>

			{/* ── Wiring into a workflow ─────────────────────────── */}
			<section className="rounded-lg border bg-card p-6 space-y-3">
				<div>
					<h2 className="font-semibold">Use it in a workflow</h2>
					<p className="text-sm text-muted-foreground mt-1">
						The <code>lumid-outlook-pa</code> skill is now in the marketplace. Two paths:
					</p>
				</div>
				<ul className="text-sm space-y-2 list-disc pl-5">
					<li>
						<strong>Fork personal-agent and swap the email transport</strong> — edit your fork's
						<code className="mx-1">xpcloud.yaml</code> to add <code>lumid-outlook-pa</code> to
						<code className="mx-1">skill_imports</code>, then change the email loop steps from
						<code className="mx-1">email.observe</code> / <code>email.send</code> to
						<code className="mx-1">lumid-outlook-pa.observe</code> / <code>lumid-outlook-pa.send</code>.
					</li>
					<li>
						<strong>Or ask the AI</strong> in the chat sidebar:{' '}
						<em>&ldquo;Build me a workflow that reads my Outlook every hour and drafts replies&rdquo;</em>
						— the agent composes a fresh xpio app using the outlook-pa skill directly.
					</li>
				</ul>
			</section>
		</div>
	);
}

function fmtAbs(s?: string): string {
	if (!s) return '?';
	try { return new Date(s).toLocaleString(); } catch { return s; }
}

function fmtRel(s?: string | null): string {
	if (!s) return 'never';
	try {
		const ts = new Date(s).getTime();
		const diff = Date.now() - ts;
		const sec = Math.floor(diff / 1000);
		if (sec < 60) return `${sec}s ago`;
		if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
		if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
		return `${Math.floor(sec / 86400)}d ago`;
	} catch { return s || ''; }
}
