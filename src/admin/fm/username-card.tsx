// "Your username" on the Sandboxes page: ONE login name for every cluster (lum.id identity), chosen and changed
// here. Words from lib/username.ts; the server decides (shape, reserved, taken).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import { getMyUsername, setMyUsername, type UsernameInfo } from "../../api/username";
import { USERNAME_RULE, renameNote, usernameProblem } from "../../lib/username";
import { Button } from "../../components/ui/button";

export default function UsernameCard() {
	const [info, setInfo] = useState<UsernameInfo | null>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	useEffect(() => { getMyUsername().then(setInfo).catch(() => setInfo(null)); }, []);
	if (!info) return null;
	const current = info.username;
	const problem = editing ? usernameProblem(draft) : null;
	const changed = draft.trim() !== (current ?? "");
	async function save() {
		setSaving(true);
		try {
			const r = await setMyUsername(draft.trim());
			setInfo(r); setEditing(false);
			toast.success(`Your username is now ${r.username}`);
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? "could not save that username");
		} finally { setSaving(false); }
	}
	return (
		<section className="mb-4 rounded-lg border border-ink-200 bg-card p-4" data-testid="username-card">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<UserRound className="h-4 w-4 text-ink-600" aria-hidden />
					<span className="text-meta text-ink-700">Your username</span>
					<span className="font-mono text-body font-medium text-ink-900">{current ?? "not chosen yet"}</span>
					{info.uid != null && <span className="text-caption text-ink-600">id {info.uid}</span>}
				</div>
				{!editing && (
					<Button variant="secondary" size="sm" onClick={() => { setDraft(current ?? info.suggested ?? ""); setEditing(true); }}>
						{current ? "Change" : "Choose"}
					</Button>
				)}
			</div>
			<p className="mt-2 max-w-3xl text-caption text-ink-600">
				Your login name on every cluster — sandboxes, and the office, home and NUS machines. Pick the name you
				already use there, if you have one. The clusters switch over to this name in the coming days; until then
				your current sandbox and machine names keep working.
				{info.previous?.length ? ` Earlier names: ${info.previous.join(", ")} (they keep working as links).` : ""}
			</p>
			{editing && (
				<div className="mt-3 space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<input autoFocus value={draft} onChange={(e) => setDraft(e.target.value.toLowerCase())}
							aria-label="username" placeholder={info.suggested ?? "yourname"}
							className="w-56 rounded-md border border-ink-300 px-2 py-1 font-mono text-sm" />
						<Button size="sm" onClick={save} disabled={saving || !!problem || !changed}>{saving ? "Saving…" : "Save"}</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
					</div>
					<p className="text-caption text-ink-600">{problem ?? (changed ? renameNote(current, draft.trim()) : USERNAME_RULE)}</p>
				</div>
			)}
		</section>
	);
}
