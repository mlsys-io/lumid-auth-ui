// "Add to app…" — the kind=skill marketplace action.
//
// Skills are imported BY apps (xpcloud.yaml skill_imports[]), never installed
// standalone. This dialog picks one of the caller's TENANT-OWNED installed
// apps, queues an add_skill intent (POST /me/apps/:app/skills), and polls the
// intent result so the user gets a definitive outcome (the change is two
// filesystem writes — quick once the picker drains).

import { useEffect, useState } from "react";
import { Loader2, Check, Puzzle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { me, waitForIntent, type MeAppCard } from "@/api/me";
import {
	Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export function AddSkillToAppDialog({
	skillRepo, skillLabel, version, open, onClose,
}: {
	skillRepo: string;   // owner/name of the kind=skill repo
	skillLabel: string;  // display name for copy
	version?: string;    // published version to pin (picker falls back to head)
	open: boolean;
	onClose: () => void;
}) {
	const [apps, setApps] = useState<MeAppCard[] | null>(null);
	const [target, setTarget] = useState<string>("");
	const [phase, setPhase] = useState<"pick" | "working" | "done">("pick");
	const [doneNote, setDoneNote] = useState<string>("");

	useEffect(() => {
		if (!open) return;
		setPhase("pick");
		setDoneNote("");
		me.listApps()
			.then((r) => {
				// Only the caller's own installs are writable (operator-shared
				// bundles are read-only) — and an app needs a manifest to have
				// skill_imports at all.
				const own = (r.apps ?? []).filter(
					(a) => a.tenant && (a.has_xpcloud || a.has_manifest) && (a.status ?? "ready") === "ready",
				);
				setApps(own);
				if (own.length === 1) setTarget(own[0].name);
			})
			.catch(() => setApps([]));
	}, [open]);

	const submit = async () => {
		if (!target) return;
		setPhase("working");
		try {
			const resp = await me.addSkillToApp(target, skillRepo, version);
			const result = await waitForIntent(resp.intent_id, { timeoutMs: 90_000 });
			const data = (result.result ?? {}) as { ok?: boolean; changed?: boolean; error?: string };
			if (data.error) throw new Error(data.error);
			setDoneNote(data.changed === false ? "Already imported — nothing to change." : "Imported. The app picks it up on its next run.");
			setPhase("done");
		} catch (e) {
			toast.error("Couldn't add the skill: " + (e instanceof Error ? e.message : String(e)));
			setPhase("pick");
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[15px]">
						<Puzzle className="w-4 h-4 text-violet-500" /> Add {skillLabel} to an app
					</DialogTitle>
					<DialogDescription className="text-[12.5px]">
						Skills aren&apos;t installed standalone — they&apos;re imported by an app
						(<code className="text-[11px]">skill_imports</code>). Pick which of your
						apps should use this skill.
					</DialogDescription>
				</DialogHeader>

				{phase === "done" ? (
					<div className="space-y-3">
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 flex items-center gap-2">
							<Check className="w-4 h-4 flex-shrink-0" /> {doneNote}
						</div>
						<Link
							to={`/studio/a/${encodeURIComponent(target)}/config`}
							onClick={onClose}
							className="inline-flex items-center gap-1.5 text-[12.5px] text-amber-700 hover:underline"
						>
							View {target}&apos;s config <ArrowRight className="w-3.5 h-3.5" />
						</Link>
					</div>
				) : apps === null ? (
					<div className="py-6 text-center text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading your apps…</div>
				) : apps.length === 0 ? (
					<div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[12.5px] text-slate-600">
						You don&apos;t have any installed apps yet. Install an app first — then
						come back and add this skill to it.
					</div>
				) : (
					<div className="space-y-3">
						<div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
							{apps.map((a) => (
								<label key={a.name} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[13px] transition-colors ${target === a.name ? "bg-violet-50 text-violet-900" : "hover:bg-slate-50 text-slate-700"}`}>
									<input
										type="radio" name="target-app" value={a.name}
										checked={target === a.name}
										onChange={() => setTarget(a.name)}
										className="accent-violet-600"
									/>
									<span className="truncate">{a.name}</span>
								</label>
							))}
						</div>
						<button
							onClick={submit}
							disabled={!target || phase === "working"}
							className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-all"
						>
							{phase === "working" ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</> : <>Add to {target || "app"}</>}
						</button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

export default AddSkillToAppDialog;
