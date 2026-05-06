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
	type InboxMessage,
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
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [unread, setUnread] = useState(0);

	const refresh = async () => {
		try {
			const resp = await listInboxMessages({
				app: appFilter || undefined,
				unread_only: unreadOnly,
				limit: 100,
			});
			setMessages(resp.messages);
			setUnread(resp.unread);
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
		refresh();
		// Poll every 30s so a cycle that just ran shows up without a manual refresh.
		const id = setInterval(refresh, 30_000);
		return () => clearInterval(id);
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

			{!loading && !error && messages.length === 0 && (
				<EmptyState />
			)}

			<div className="space-y-3">
				{messages.map((m) => (
					<MessageCard key={m.id} message={m} onSeen={() => onSeen(m.id)} onAction={refresh} />
				))}
			</div>
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
				className="text-sm text-soul-400 hover:underline"
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
		cycle_summary: <Bot className="w-4 h-4 text-spirit-400" />,
		draft_pending: <Sparkles className="w-4 h-4 text-soul-400" />,
		question: <MessageSquare className="w-4 h-4 text-amber-500" />,
		flag: <ShieldAlert className="w-4 h-4 text-red-500" />,
	}[message.kind] || <Brain className="w-4 h-4 text-gray-400" />;

	return (
		<div
			className={`rounded-lg border p-4 ${
				isUnread ? "border-soul-300 bg-white shadow-sm" : "border-gray-200 bg-gray-50"
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

	return (
		<div className="text-sm space-y-2">
			{score && typeof score === "object" && (
				<div className="text-xs text-muted-foreground">
					Score keys: {Object.keys(score).slice(0, 6).join(", ")}
					{Object.keys(score).length > 6 && "…"}
				</div>
			)}
			{drafts && drafts.length > 0 && (
				<div>
					<div className="text-xs font-semibold text-muted-foreground mb-1">
						{drafts.length} draft{drafts.length === 1 ? "" : "s"} pending review
					</div>
					<ul className="text-xs space-y-1">
						{drafts.slice(0, 5).map((d) => (
							<li key={d.draft_id} className="flex items-center gap-2">
								<code className="bg-gray-100 px-1 rounded">{d.draft_id.slice(0, 8)}</code>
								<span className="text-muted-foreground">
									{d.role}/{d.kind || "prompt"}
								</span>
								{d.skill_id && <span className="font-medium">{d.skill_id}</span>}
							</li>
						))}
						{drafts.length > 5 && (
							<li className="text-muted-foreground italic">… + {drafts.length - 5} more</li>
						)}
					</ul>
				</div>
			)}
			{flags && flags.length > 0 && (
				<div className="flex items-start gap-2 rounded bg-amber-50 border border-amber-200 px-2 py-1">
					<ShieldAlert className="w-3 h-3 text-amber-600 mt-0.5" />
					<ul className="text-xs text-amber-900 space-y-0.5">
						{flags.map((f) => (
							<li key={f}>{f}</li>
						))}
					</ul>
				</div>
			)}
			{cycleDir && (
				<div className="text-[10px] text-muted-foreground">
					<code>{cycleDir}</code>
				</div>
			)}
		</div>
	);
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
	if (!drafts || drafts.length === 0) return null;

	const handle = async (draftId: string, kind: "approve" | "reject") => {
		try {
			await postReply(message.id, kind, { draft_id: draftId });
			toast.success(
				`${kind === "approve" ? "Approved" : "Rejected"} — next cycle will apply.`,
			);
			onAction();
		} catch (e) {
			toast.error(`${kind} failed: ${String(e)}`);
		}
	};

	return (
		<div className="mt-3 space-y-2">
			{drafts.slice(0, 5).map((d) => (
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
			))}
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

function relativeTime(unixSec: number): string {
	const diff = Date.now() / 1000 - unixSec;
	if (diff < 60) return `${Math.floor(diff)}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}
