// "Have a login on our machines already? Claim it" — inside the "Your username" card. The person types the login,
// gets ONE command to run as that login on any of our machines, and the page asks every 10 s (for up to 30 min)
// whether a machine has seen it. Words from lib/username-claim.ts; the server decides.
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getUsernameClaim, startUsernameClaim, type StartedUsernameClaim, type UsernameClaim } from "../../api/username";
import {
	CLAIM_EXPLAIN, CLAIM_OFFER, CLAIM_POLL_MS, claimInstruction, claimLoginProblem, claimResumeNote, claimStartError, claimView,
	keepPolling, type ClaimViewKind,
} from "../../lib/username-claim";
import { TONES } from "../../lib/tones";
import { Button } from "../../components/ui/button";

const toneOf = (k: ClaimViewKind) =>
	k === "verified" ? TONES.ok : k === "waiting" ? TONES.running : k === "rejected" ? TONES.failing : TONES.attention;

export default function ClaimLogin({ onVerified }: { onVerified: (login: string) => void }) {
	const [open, setOpen] = useState(false);
	const [login, setLogin] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The command exists only in this page's memory: the server returns it once and keeps only a hash.
	const [started, setStarted] = useState<StartedUsernameClaim | null>(null);
	const [claim, setClaim] = useState<UsernameClaim | null>(null);
	const [pollSince, setPollSince] = useState<number | null>(null);
	const [now, setNow] = useState(() => new Date());
	const [copied, setCopied] = useState(false);
	const last = useRef<UsernameClaim | null>(null);
	const reported = useRef<number | null>(null);
	const onVerifiedRef = useRef(onVerified);
	onVerifiedRef.current = onVerified;

	// Reopen on a claim that is still waiting (e.g. after a reload), and keep asking about it.
	useEffect(() => {
		getUsernameClaim().then((c) => {
			if (c && keepPolling(c, new Date(), 0)) {
				last.current = c; setClaim(c); setLogin(c.login); setOpen(true); setPollSince(Date.now());
			}
		}).catch(() => { /* no claim to show */ });
	}, []);

	useEffect(() => {
		if (pollSince == null) return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = async () => {
			let c: UsernameClaim | null = last.current;
			try { c = await getUsernameClaim(); } catch { /* a blip: keep the last answer, ask again */ }
			if (stopped) return;
			const n = new Date();
			last.current = c; setClaim(c); setNow(n);
			if (c?.status === "verified" && reported.current !== c.id) {
				reported.current = c.id;
				onVerifiedRef.current(c.login);
			}
			if (keepPolling(c, n, n.getTime() - pollSince)) timer = setTimeout(tick, CLAIM_POLL_MS);
		};
		timer = setTimeout(tick, CLAIM_POLL_MS);
		return () => { stopped = true; if (timer) clearTimeout(timer); };
	}, [pollSince]);

	async function start(name: string) {
		setBusy(true); setError(null);
		try {
			const r = await startUsernameClaim(name.trim());
			const c: UsernameClaim = { id: r.id, login: r.login, status: "pending", expires_at: r.expires_at };
			last.current = c;
			setStarted(r); setClaim(c); setNow(new Date()); setPollSince(Date.now()); setCopied(false);
		} catch (e: any) {
			setError(claimStartError(e?.response?.status, e?.response?.data?.message));
		} finally { setBusy(false); }
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch { /* clipboard blocked: the command is selectable */ }
	}

	if (!open) {
		return (
			<Button variant="link" size="sm" className="mt-2 h-auto px-0" onClick={() => setOpen(true)} data-testid="claim-open">
				{CLAIM_OFFER}
			</Button>
		);
	}

	const view = claimView(claim, now, pollSince == null ? 0 : now.getTime() - pollSince);
	const problem = login ? claimLoginProblem(login) : null;
	const showCommand = started && claim?.id === started.id && (view?.kind === "waiting" || view?.kind === "gave-up");
	const T = view ? toneOf(view.kind) : null;
	const canStartAgain = view && view.kind !== "verified";

	return (
		<div className="mt-3 space-y-2 rounded-md border border-ink-200 bg-muted/40 p-3" data-testid="claim-login">
			{!claim && (
				<>
					<p className="max-w-3xl text-caption text-ink-600">{CLAIM_EXPLAIN}</p>
					<div className="flex flex-wrap items-center gap-2">
						<input autoFocus value={login} onChange={(e) => setLogin(e.target.value.toLowerCase())}
							aria-label="login on our machines" placeholder="your login"
							className="w-56 rounded-md border border-ink-300 px-2 py-1 font-mono text-sm" />
						<Button size="sm" onClick={() => start(login)} disabled={busy || !login || !!problem}>
							{busy ? "Starting…" : "Get the command"}
						</Button>
						<Button variant="ghost" size="sm" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
					</div>
					{problem && <p className="text-caption text-ink-600">{problem}</p>}
				</>
			)}
			{showCommand && started && (
				<div className="space-y-1">
					<p className="text-caption text-ink-700">{claimInstruction(started.login)}</p>
					<div className="flex items-center gap-2">
						<code className="select-all break-all rounded-md border border-ink-200 bg-card px-2 py-1 font-mono text-caption text-ink-900"
							data-testid="claim-command">{started.command}</code>
						<Button variant="ghost" size="icon-sm" onClick={() => copy(started.command)}
							aria-label={copied ? "Copied" : "Copy the command"} title={copied ? "Copied" : "Copy the command"}>
							{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
						</Button>
					</div>
				</div>
			)}
			{claim && !showCommand && view?.kind === "waiting" && (
				<p className="text-caption text-ink-700">{claimResumeNote(claim.login)}</p>
			)}
			{view && T && (
				<p className="flex items-start gap-2 text-caption" data-testid="claim-status" data-kind={view.kind}>
					<T.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${T.icon} ${view.kind === "waiting" ? "animate-spin" : ""}`} aria-hidden />
					<span className={view.kind === "verified" ? `font-medium ${T.text}` : view.kind === "rejected" ? T.text : "text-ink-700"}>{view.text}</span>
				</p>
			)}
			{claim && (
				<div className="flex flex-wrap gap-2">
					{view?.kind === "gave-up" && (
						<Button variant="secondary" size="sm" onClick={() => { setNow(new Date()); setPollSince(Date.now()); }}>Check again</Button>
					)}
					{canStartAgain && (
						<Button variant={view?.kind === "waiting" ? "ghost" : "secondary"} size="sm" disabled={busy} onClick={() => start(claim.login)}>
							{busy ? "Starting…" : "Start again"}
						</Button>
					)}
					<Button variant="ghost" size="sm" onClick={() => {
						setOpen(false); setStarted(null); setClaim(null); setPollSince(null); last.current = null; setError(null);
					}}>{view?.kind === "verified" ? "Done" : "Close"}</Button>
				</div>
			)}
			{error && <p className={`text-caption ${TONES.failing.text}`} role="alert">{error}</p>}
		</div>
	);
}
