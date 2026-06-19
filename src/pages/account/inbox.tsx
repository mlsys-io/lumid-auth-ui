import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "sonner";
import {
	Inbox as InboxIcon,
	Bot,
	User,
	Sparkles,
	Brain,
	ShieldAlert,
	CheckCircle2,
	XCircle,
	MessageSquare,
	RefreshCw,
} from "lucide-react";
import {
	listInboxMessages,
	markSeen,
	postReply,
	postStepInstructions,
	type InboxMessage,
	type StepRecap,
} from "../../api/inbox";

/**
 * /account/inbox — real two-way message store between autoresearch
 * loops and the human reviewer.
 *
 * Phase 1 (read-only display):  the loop posts a structured message
 * via xpcloud's POST /inbox/message after each cycle. This page polls
 * GET /inbox/messages and shows them.
 *
 * Phase 2 (replies flow back):  for `cycle_summary` and `draft_pending`
 * messages, the user can Approve / Reject each draft inline. For
 * `question` messages, a textarea lets the user reply with prose.
 * Replies POST to /inbox/{id}/reply; the local cycle pulls them on
 * its next entry via _pull_inbox_replies and dispatches accordingly:
 *   approve → skill_apply / memory_apply
 *   reject  → discard_skill_draft / discard_memory_draft
 *   text    → xp_ingest into the role agent
 *
 * Auth is the lm_session cookie — nginx proxies /inbox-api/* to
 * xpcloud and forwards the cookie value as a Bearer token, so
 * xpcloud's resolve_user introspects via lum.id.
 */
export default function InboxPage() {
	const [appFilter, setAppFilter] = useState("");
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [messages, setMessages] = useState<InboxMessage[]>([]);
	// "Needs you" — attention-needed kinds fetched SEPARATELY (kind filter) so
	// questions/flags/drafts surface above the routine cycle_summary flood
	// (the recent-100 feed is ~all digests; an escalation would never appear).
	const [attention, setAttention] = useState<InboxMessage[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [unread, setUnread] = useState(0);
	const ATTENTION_KINDS = "question,flag,draft_pending";

	const refresh = async () => {
		try {
			const [resp, att] = await Promise.all([
				listInboxMessages({ app: appFilter || undefined, unread_only: unreadOnly, limit: 100 }),
				listInboxMessages({ app: appFilter || undefined, kind: ATTENTION_KINDS, limit: 50 }),
			]);
			setMessages(resp.messages);
			setUnread(resp.unread);
			setAttention(att.messages);
			setError(null);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setError(msg);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		setLoading(true);
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		// Adaptive poll: 30s on success, exponential backoff up to 5min on
		// error so a flapping xpcloud doesn't get hammered.
		let delay = 30_000;
		const tick = async () => {
			let ok = true;
			try {
				const [resp, att] = await Promise.all([
					listInboxMessages({ app: appFilter || undefined, unread_only: unreadOnly, limit: 100 }),
					listInboxMessages({ app: appFilter || undefined, kind: ATTENTION_KINDS, limit: 50 }),
				]);
				if (cancelled) return;
				setMessages(resp.messages);
				setUnread(resp.unread);
				setAttention(att.messages);
				setError(null);
			} catch (e: unknown) {
				ok = false;
				if (cancelled) return;
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
			delay = ok ? 30_000 : Math.min(delay * 2, 300_000);
			if (!cancelled) timer = setTimeout(tick, delay);
		};
		tick();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [appFilter, unreadOnly]);

	const apps = useMemo(
		() => Array.from(new Set(messages.map((m) => m.app))).sort(),
		[messages],
	);

	const onSeen = async (id: string) => {
		try {
			await markSeen(id);
			setMessages((prev) =>
				prev.map((m) => (m.id === id ? { ...m, seen_at: Date.now() / 1000 } : m)),
			);
		} catch (e) {
			toast.error(`Mark seen failed: ${String(e)}`);
		}
	};

	return (
		<div className="max-w-4xl mx-auto p-6">
			<header className="mb-6">
				<div className="flex items-center justify-between mb-2">
					<h1 className="text-2xl font-bold flex items-center gap-2">
						<InboxIcon className="w-6 h-6" /> Inbox
						{unread > 0 && (
							<span className="text-sm font-normal bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
								{unread} unread
							</span>
						)}
					</h1>
					<Button variant="ghost" size="sm" onClick={refresh}>
						<RefreshCw className="w-4 h-4 mr-1" /> Refresh
					</Button>
				</div>
				<p className="text-sm text-muted-foreground">
					Messages from your autoresearch loops. Approve/Reject drafts inline; the next cycle picks up your reply.
				</p>
			</header>

			<div className="flex items-center gap-3 mb-4 text-sm">
				<Label htmlFor="app-filter" className="text-muted-foreground">App:</Label>
				<select
					id="app-filter"
					value={appFilter}
					onChange={(e) => setAppFilter(e.target.value)}
					className="border rounded px-2 py-1 text-sm"
				>
					<option value="">All apps</option>
					{apps.map((a) => (
						<option key={a} value={a}>{a}</option>
					))}
				</select>
				<label className="flex items-center gap-1 text-muted-foreground">
					<input
						type="checkbox"
						checked={unreadOnly}
						onChange={(e) => setUnreadOnly(e.target.checked)}
					/>
					Unread only
				</label>
			</div>

			{loading && messages.length === 0 && (
				<div className="text-center py-12 text-muted-foreground">Loading…</div>
			)}

			{error && (
				<div className="rounded border border-red-300 bg-red-50 p-4 mb-4 text-sm text-red-900">
					<div className="flex items-center gap-2 font-semibold mb-1">
						<ShieldAlert className="w-4 h-4" /> Could not load inbox
					</div>
					<div className="text-xs">{error}</div>
					<div className="text-xs mt-2">
						If you don&apos;t have any apps with{" "}
						<code className="bg-red-100 px-1 rounded">inbox_publish.enabled: true</code>{" "}
						in their xpcloud.yaml yet, the inbox will be empty until a cycle posts here.
					</div>
				</div>
			)}

			{/* Needs you — attention-needed messages (questions/flags/drafts),
			    surfaced above the routine cycle_summary activity feed. */}
			{attention.length > 0 && (
				<section className="mb-6">
					<h2 className="text-sm font-semibold text-amber-900 flex items-center gap-2 mb-2">
						<MessageSquare className="w-4 h-4 text-amber-500" />
						Needs you
						<span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full text-xs">
							{attention.length}
						</span>
					</h2>
					<p className="text-xs text-muted-foreground mb-3">
						Decisions your AI is unsure about + pending drafts. Reply and the next cycle ingests your guidance.
					</p>
					<div className="space-y-3">
						{attention.map((m) => (
							<MessageCard key={`att:${m.id}`} message={m} onSeen={() => onSeen(m.id)} onAction={refresh} />
						))}
					</div>
				</section>
			)}

			{!loading && !error && messages.length === 0 && attention.length === 0 && (
				<EmptyState />
			)}

			{messages.length > 0 && (
				<>
					{attention.length > 0 && (
						<h2 className="text-sm font-semibold text-muted-foreground mb-2">Recent activity</h2>
					)}
					<div className="space-y-3">
						{messages.map((m) => (
							<MessageCard key={m.id} message={m} onSeen={() => onSeen(m.id)} onAction={refresh} />
						))}
					</div>
				</>
			)}
		</div>
	);
}

function EmptyState() {
	return (
		<div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
			<InboxIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
			<p className="font-semibold text-gray-700 mb-1">No messages yet</p>
			<p className="text-sm text-muted-foreground mb-4">
				Configure <code className="bg-gray-100 px-1 rounded text-xs">inbox_publish:</code> in your app&apos;s xpcloud.yaml. Each cycle will post a message here.
			</p>
			<Link
				to="/dashboard/skills/new"
				className="text-sm text-indigo-500 hover:underline"
			>
				Or hand-author a skill →
			</Link>
		</div>
	);
}

function MessageCard({
	message,
	onSeen,
	onAction,
}: {
	message: InboxMessage;
	onSeen: () => void;
	onAction: () => void;
}) {
	const isUnread = message.seen_at == null;
	const ts = new Date(message.posted_at * 1000);
	const ago = relativeTime(message.posted_at);

	const kindIcon = {
		cycle_summary: <Bot className="w-4 h-4 text-violet-500" />,
		draft_pending: <Sparkles className="w-4 h-4 text-indigo-400" />,
		question: <MessageSquare className="w-4 h-4 text-amber-500" />,
		flag: <ShieldAlert className="w-4 h-4 text-red-500" />,
	}[message.kind] || <Brain className="w-4 h-4 text-gray-400" />;

	return (
		<div
			className={`rounded-lg border p-4 ${
				isUnread ? "border-indigo-300 bg-white shadow-sm" : "border-gray-200 bg-gray-50"
			}`}
		>
			<div className="flex items-start justify-between mb-2">
				<div className="flex items-center gap-2 text-sm">
					{kindIcon}
					<span className="font-semibold">{message.app}</span>
					{message.loop && (
						<span className="text-muted-foreground">/ {message.loop}</span>
					)}
					<span className="text-muted-foreground text-xs">· {message.kind}</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground" title={ts.toLocaleString()}>
						{ago}
					</span>
					{isUnread && (
						<Button variant="ghost" size="sm" onClick={onSeen} className="h-6 px-2 text-xs">
							Mark seen
						</Button>
					)}
				</div>
			</div>

			<MessagePayload payload={message.payload} />
			<DraftActions message={message} onAction={onAction} />
			<QuestionReply message={message} onAction={onAction} />
			<CycleSummaryStepInstructions message={message} onAction={onAction} />
		</div>
	);
}

function MessagePayload({ payload }: { payload: Record<string, unknown> }) {
	const score = payload.score as Record<string, unknown> | undefined;
	const flags = payload.flags as string[] | undefined;
	const drafts = payload.drafts_pending as
		| Array<{ draft_id: string; skill_id?: string; role?: string; kind?: string }>
		| undefined;
	const cycleDir = payload.cycle_dir as string | undefined;
	const decisionsToday = payload.decisions_today as number | undefined;
	const byKind = payload.by_kind as Record<string, number> | undefined;
	const certExpiring = payload.cert_expiring as Record<string, number> | undefined;
	const backupStale = payload.backup_stale as Record<string, number> | undefined;
	const apiProbesFailed = payload.api_probes_failed as string[] | undefined;
	const decisions = payload.decisions as Array<{ kind: string; reason: string }> | undefined;
	const suggestions = payload.suggestions as string[] | undefined;
	const recap = payload.recap as string | undefined;
	const stepRecap = payload.step_recap as Array<{ step_id: string; recap?: string; summary?: string }> | undefined;

	const lines: React.ReactNode[] = [];

	if (recap) {
		lines.push(
			<p key="recap" className="text-sm text-gray-700">{recap}</p>
		);
	}

	if (typeof decisionsToday === "number") {
		lines.push(
			<div key="dt" className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
				<span>decisions today:</span>
				<span className={`font-semibold ${decisionsToday > 0 ? "text-amber-600" : "text-emerald-600"}`}>
					{decisionsToday}
				</span>
				{byKind && Object.entries(byKind).map(([k, n]) => (
					<span key={k} className="bg-gray-100 rounded px-1.5 py-0.5 text-[10px]">
						{k} ×{n}
					</span>
				))}
			</div>
		);
	}

	if (certExpiring && Object.keys(certExpiring).length > 0) {
		lines.push(
			<div key="cert" className="flex items-start gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-900">
				<ShieldAlert className="w-3 h-3 text-amber-600 mt-0.5 shrink-0" />
				<span>Certs expiring: {Object.entries(certExpiring).map(([d, n]) => `${d} (${n}d)`).join(", ")}</span>
			</div>
		);
	}

	if (backupStale && Object.keys(backupStale).length > 0) {
		lines.push(
			<div key="bk" className="flex items-start gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-900">
				<ShieldAlert className="w-3 h-3 text-amber-600 mt-0.5 shrink-0" />
				<span>Stale backups: {Object.entries(backupStale).map(([j, h]) => `${j} (${Math.round(h)}h)`).join(", ")}</span>
			</div>
		);
	}

	if (apiProbesFailed && apiProbesFailed.length > 0) {
		lines.push(
			<div key="api" className="flex items-start gap-1.5 rounded bg-red-50 border border-red-200 px-2 py-1 text-xs text-red-900">
				<XCircle className="w-3 h-3 text-red-600 mt-0.5 shrink-0" />
				<span>API probes failed: {apiProbesFailed.join(", ")}</span>
			</div>
		);
	}

	if (decisions && decisions.length > 0) {
		lines.push(
			<ul key="dec" className="space-y-0.5">
				{decisions.slice(0, 5).map((d, i) => (
					<li key={i} className="flex items-start gap-2 text-xs">
						<span className="shrink-0 font-medium text-indigo-600">{d.kind}</span>
						<span className="text-muted-foreground">{d.reason}</span>
					</li>
				))}
			</ul>
		);
	}

	if (flags && flags.length > 0) {
		lines.push(
			<div key="flags" className="flex items-start gap-2 rounded bg-amber-50 border border-amber-200 px-2 py-1">
				<ShieldAlert className="w-3 h-3 text-amber-600 mt-0.5" />
				<ul className="text-xs text-amber-900 space-y-0.5">
					{flags.map((f) => <li key={f}>{f}</li>)}
				</ul>
			</div>
		);
	}

	if (drafts && drafts.length > 0) {
		lines.push(
			<div key="drafts">
				<div className="text-xs font-semibold text-muted-foreground mb-1">
					{drafts.length} draft{drafts.length === 1 ? "" : "s"} pending review
				</div>
				<ul className="text-xs space-y-1">
					{drafts.slice(0, 5).map((d) => (
						<li key={d.draft_id} className="flex items-center gap-2">
							<code className="bg-gray-100 px-1 rounded">{d.draft_id.slice(0, 8)}</code>
							<span className="text-muted-foreground">{d.role}/{d.kind || "prompt"}</span>
							{d.skill_id && <span className="font-medium">{d.skill_id}</span>}
						</li>
					))}
					{drafts.length > 5 && <li className="text-muted-foreground italic">… + {drafts.length - 5} more</li>}
				</ul>
			</div>
		);
	}

	if (stepRecap && stepRecap.length > 0) {
		lines.push(
			<ul key="sr" className="space-y-0.5">
				{stepRecap.map((s, i) => (
					<li key={i} className="text-xs text-muted-foreground">
						<span className="font-medium text-indigo-700">{s.step_id}</span>
						{(s.recap || s.summary) && <span> — {s.recap ?? s.summary}</span>}
					</li>
				))}
			</ul>
		);
	}

	if (suggestions && suggestions.length > 0) {
		lines.push(
			<details key="sug">
				<summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
					{suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
				</summary>
				<ul className="mt-1 space-y-0.5 pl-3">
					{suggestions.map((s, i) => <li key={i} className="text-xs text-muted-foreground">→ {s}</li>)}
				</ul>
			</details>
		);
	}

	if (score && typeof score === "object") {
		lines.push(
			<div key="score" className="text-xs text-muted-foreground">
				Score: {Object.keys(score).slice(0, 6).join(", ")}{Object.keys(score).length > 6 && "…"}
			</div>
		);
	}

	if (cycleDir) {
		lines.push(
			<div key="cd" className="text-[10px] text-muted-foreground"><code>{cycleDir}</code></div>
		);
	}

	if (lines.length === 0) {
		const raw = JSON.stringify(payload);
		const meaningful = raw.replace(/"ts":"[^"]+",?/g, "").replace(/^\{,/, "{").replace(/,\}$/, "}");
		if (meaningful.length > 2) {
			lines.push(
				<p key="raw" className="text-xs text-muted-foreground font-mono">{meaningful.slice(0, 300)}</p>
			);
		} else {
			lines.push(
				<p key="empty" className="text-xs text-muted-foreground italic">No summary content.</p>
			);
		}
	}

	return <div className="text-sm space-y-2">{lines}</div>;
}

function DraftActions({
	message,
	onAction,
}: {
	message: InboxMessage;
	onAction: () => void;
}) {
	const drafts = message.payload.drafts_pending as
		| Array<{ draft_id: string; skill_id?: string }>
		| undefined;
	const [pending, setPending] = useState<Record<string, "approve" | "reject" | undefined>>({});
	if (!drafts || drafts.length === 0) return null;

	const handle = async (draftId: string, kind: "approve" | "reject") => {
		// Optimistic: stamp the row immediately so the user sees feedback.
		setPending((p) => ({ ...p, [draftId]: kind }));
		try {
			await postReply(message.id, kind, { draft_id: draftId });
			toast.success(
				`${kind === "approve" ? "Approved" : "Rejected"} — next cycle will apply.`,
			);
			onAction();
		} catch (e) {
			setPending((p) => ({ ...p, [draftId]: undefined }));
			toast.error(`${kind} failed: ${String(e)}`);
		}
	};

	return (
		<div className="mt-3 space-y-2">
			{drafts.slice(0, 5).map((d) => {
				const stamp = pending[d.draft_id];
				if (stamp) {
					return (
						<div key={d.draft_id} className="flex items-center gap-2 text-xs text-muted-foreground italic">
							<code className="bg-gray-100 px-1 rounded">{d.draft_id.slice(0, 8)}</code>
							{d.skill_id && <> {d.skill_id}</>}
							<span>— {stamp === "approve" ? "✓ approved" : "✗ rejected"}, next cycle</span>
						</div>
					);
				}
				return (
					<div key={d.draft_id} className="flex items-center gap-2 text-xs">
						<span className="text-muted-foreground">
							<code className="bg-gray-100 px-1 rounded">{d.draft_id.slice(0, 8)}</code>
							{d.skill_id && <> {d.skill_id}</>}
						</span>
						<Button
							size="sm"
							variant="default"
							className="h-7 px-3 text-xs"
							onClick={() => handle(d.draft_id, "approve")}
						>
							<CheckCircle2 className="w-3 h-3 mr-1" /> Approve
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 px-3 text-xs"
							onClick={() => handle(d.draft_id, "reject")}
						>
							<XCircle className="w-3 h-3 mr-1" /> Reject
						</Button>
					</div>
				);
			})}
		</div>
	);
}

function QuestionReply({
	message,
	onAction,
}: {
	message: InboxMessage;
	onAction: () => void;
}) {
	const [body, setBody] = useState("");
	const [submitting, setSubmitting] = useState(false);
	if (message.kind !== "question") return null;

	const submit = async () => {
		if (!body.trim()) return;
		setSubmitting(true);
		try {
			await postReply(message.id, "text", { body });
			toast.success("Reply sent — next cycle will ingest as a memory.");
			setBody("");
			onAction();
		} catch (e) {
			toast.error(`Reply failed: ${String(e)}`);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="mt-3 space-y-2">
			<Label className="text-xs">
				<User className="w-3 h-3 inline mr-1" /> Your answer
			</Label>
			<Input
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder="Type a free-form answer; the loop ingests it as a memory in the role agent."
				className="text-sm"
				disabled={submitting}
			/>
			<Button
				size="sm"
				disabled={submitting || !body.trim()}
				onClick={submit}
			>
				Send reply
			</Button>
		</div>
	);
}

// ── CycleSummaryStepInstructions (Theme F.x) ───────────────────────
//
// For cycle_summary messages that include step_recap[], renders a per-step
// textarea labeled "Nudge next cycle". On "Send replies", POSTs each
// non-empty textarea as a step_instructions reply. A persist checkbox
// promotes the scope to "persist" (xpcloud.yaml).
function CycleSummaryStepInstructions({
	message,
	onAction,
}: {
	message: InboxMessage;
	onAction: () => void;
}) {
	const stepRecap = message.payload.step_recap as StepRecap[] | undefined;
	const [instructions, setInstructions] = useState<Record<string, string>>({});
	const [persist, setPersist] = useState<Record<string, boolean>>({});
	const [submitting, setSubmitting] = useState(false);
	const [queued, setQueued] = useState<number | null>(null);

	if (message.kind !== "cycle_summary") return null;
	if (!stepRecap || stepRecap.length === 0) return null;

	const anyFilled = Object.values(instructions).some((v) => v.trim().length > 0);

	const submit = async () => {
		const entries = stepRecap.filter((s) => instructions[s.step_id]?.trim());
		if (entries.length === 0) return;
		setSubmitting(true);
		try {
			await Promise.all(
				entries.map((s) =>
					postStepInstructions(message.id, {
						step_id: s.step_id,
						instructions: instructions[s.step_id].trim(),
						scope: persist[s.step_id] ? "persist" : "next_cycle",
						loop: message.loop,
						app: message.app,
					}),
				),
			);
			setQueued(entries.length);
			setInstructions({});
			setPersist({});
			toast.success(`${entries.length} instruction${entries.length === 1 ? "" : "s"} queued for next cycle.`);
			onAction();
		} catch (e) {
			toast.error(`Failed to send instructions: ${String(e)}`);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="mt-4 pt-3 border-t border-gray-100">
			<div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
				<Sparkles className="w-3 h-3" />
				Per-step nudges for next cycle
				{queued != null && (
					<span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-medium">
						{queued} queued
					</span>
				)}
			</div>
			<div className="space-y-3">
				{stepRecap.map((step) => (
					<div key={step.step_id} className="rounded border border-gray-100 bg-gray-50/50 p-2.5">
						<div className="flex items-center gap-2 mb-1.5">
							<code className="text-[10px] text-indigo-700 font-semibold">{step.step_id}</code>
							{step.skill && (
								<span className="text-[10px] text-gray-400">/ {step.skill}</span>
							)}
							{step.stage && (
								<span className="text-[10px] px-1 rounded bg-gray-200 text-gray-600">{step.stage}</span>
							)}
							{step.outcome && (
								<span className={`text-[10px] font-medium ml-auto ${
									step.outcome === "BLOCKED" ? "text-red-500" :
									step.outcome === "ACCEPTED" ? "text-green-600" : "text-gray-500"
								}`}>
									{step.outcome}
								</span>
							)}
						</div>
						{step.summary && (
							<div className="text-[10px] text-gray-600 mb-1.5 italic">{step.summary}</div>
						)}
						{step.current_instructions && (
							<div className="text-[10px] text-blue-700 mb-1.5 border-l-2 border-blue-200 pl-1.5">
								Current: {step.current_instructions}
							</div>
						)}
						<textarea
							value={instructions[step.step_id] || ""}
							onChange={(e) =>
								setInstructions((prev) => ({ ...prev, [step.step_id]: e.target.value }))
							}
							placeholder={`Nudge next cycle (e.g. "be 20% more conservative on drawdown gate")`}
							className="w-full text-xs rounded border border-gray-200 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
							rows={2}
							disabled={submitting}
						/>
						<label className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground cursor-pointer">
							<input
								type="checkbox"
								checked={persist[step.step_id] || false}
								onChange={(e) =>
									setPersist((prev) => ({ ...prev, [step.step_id]: e.target.checked }))
								}
								disabled={submitting}
								className="w-3 h-3"
							/>
							Apply forever (writes to xpcloud.yaml)
						</label>
					</div>
				))}
			</div>
			<div className="mt-3 flex items-center gap-2">
				<Button
					size="sm"
					disabled={!anyFilled || submitting}
					onClick={submit}
					className="h-7 px-3 text-xs"
				>
					{submitting ? "Sending…" : "Send replies"}
				</Button>
				{!anyFilled && (
					<span className="text-[10px] text-muted-foreground">
						Fill at least one field to enable.
					</span>
				)}
			</div>
		</div>
	);
}

function relativeTime(unixSec: number): string {
	const diff = Date.now() / 1000 - unixSec;
	if (diff < 60) return `${Math.floor(diff)}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}
