// "Your username" on the Sandboxes page: ONE login name for every cluster (lum.id identity), chosen and changed
// here. Words from lib/username.ts; the server decides (shape, reserved, taken).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import { checkMyUsername, getMyUsername, setMyUsername, type UsernameCheck, type UsernameInfo } from "../../api/username";
import { applyUsername, getUsername } from "../../api/sandboxes";
import { renameState, verifyState, type SiteRenameState } from "../../lib/username-apply";
import { TONES } from "../../lib/tones";
import { USERNAME_RULE, renameNote, usernameProblem } from "../../lib/username";
import { Button } from "../../components/ui/button";

export default function UsernameCard({ sites = ["home", "office"] }: { sites?: string[] }) {
	const [info, setInfo] = useState<UsernameInfo | null>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	// Per-site progress after a change: the page WAITS until each site has moved you, then checks it.
	const [progress, setProgress] = useState<Record<string, SiteRenameState>>({});
	// Live answer from the server while typing: taken by someone, reserved (an existing login or sandbox), or free.
	const [check, setCheck] = useState<UsernameCheck | null>(null);
	useEffect(() => { getMyUsername().then(setInfo).catch(() => setInfo(null)); }, []);
	const want = draft.trim();
	const localProblem = editing ? usernameProblem(draft) : null;
	useEffect(() => {
		setCheck(null);
		if (!editing || localProblem || !want || want === (info?.username ?? "")) return;
		let live = true;
		const t = setTimeout(() => { void checkMyUsername(want).then((r) => { if (live && r?.name === want) setCheck(r); }); }, 350);
		return () => { live = false; clearTimeout(t); };
	}, [editing, want, localProblem, info?.username]);
	if (!info) return null;
	const current = info.username;
	const problem = localProblem ?? (check && !check.ok ? (check.problem ?? "that name is not available") : null);
	const changed = want !== (current ?? "");
	async function save() {
		setSaving(true);
		try {
			const r = await setMyUsername(draft.trim());
			setInfo(r); setEditing(false);
			if (r.username) void applyEverywhere(r.username);
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? "could not save that username");
		} finally { setSaving(false); }
	}
	async function applyOne(site: string, want: string) {
		const set = (st: SiteRenameState) => setProgress((p) => ({ ...p, [site]: st }));
		set({ kind: "working" });
		for (let attempt = 0; attempt < 24; attempt++) {
			try {
				const st = renameState(await applyUsername(site));
				if (st.kind !== "retry") { set(st); break; }
				set(st);
			} catch (e: any) {
				const code = e?.response?.status;
				if (code === 404) { set({ kind: "later", text: "this site switches to unified usernames later" }); return; }
				set({ kind: "failed", text: e?.response?.data?.detail ?? `could not reach this site${code ? ` (HTTP ${code})` : ""}` });
				return;
			}
			await new Promise((r) => setTimeout(r, 5000));
		}
		try { set(verifyState(await getUsername(site), want)); } catch { /* keep the last state */ }
	}
	async function applyEverywhere(want: string) {
		setProgress(Object.fromEntries(sites.map((s) => [s, { kind: "working" } as SiteRenameState])));
		await Promise.all(sites.map((s) => applyOne(s, want)));
		toast.success(`Your username is now ${want}`);
	}
	const tone = (k: SiteRenameState["kind"]) => (k === "done" ? TONES.ok : k === "failed" ? TONES.failing : k === "later" ? TONES.idle : TONES.running);
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
			{Object.keys(progress).length > 0 && (
				<ul className="mt-3 space-y-1" data-testid="username-progress">
					{Object.entries(progress).map(([site, st]) => {
						const T = tone(st.kind);
						return (
							<li key={site} className="flex items-center gap-2 text-caption">
								<T.Icon className={`h-3.5 w-3.5 shrink-0 ${T.icon} ${st.kind === "working" || st.kind === "retry" ? "animate-spin" : ""}`} aria-hidden />
								<span className="w-14 font-medium text-ink-800">{site}</span>
								<span className={st.kind === "failed" ? T.text : "text-ink-700"}>{st.kind === "working" ? "moving you to the new name…" : st.text}</span>
							</li>
						);
					})}
				</ul>
			)}
			{editing && (
				<div className="mt-3 space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<input autoFocus value={draft} onChange={(e) => setDraft(e.target.value.toLowerCase())}
							aria-label="username" placeholder={info.suggested ?? "yourname"}
							className="w-56 rounded-md border border-ink-300 px-2 py-1 font-mono text-sm" />
						<Button size="sm" onClick={save} disabled={saving || !!problem || !changed}>{saving ? "Saving…" : "Save"}</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
					</div>
					<p className={`text-caption ${problem ? "text-brick-700" : "text-ink-600"}`} data-testid="username-check">
						{problem ?? (changed ? `${check?.ok ? `${want} is free. ` : ""}${renameNote(current, want)}` : USERNAME_RULE)}
					</p>
				</div>
			)}
		</section>
	);
}
