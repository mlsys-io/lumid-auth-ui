// ScheduleChip — the workflow header's answer to "when does this run?".
//
// One chip, in words: "Every hour", "Paused", "On demand". Opening it says
// the same thing as a sentence (with the next run time when that time is
// certain) and holds the two things you do with a schedule: pause/resume it
// and change it. Replaces the bare "Pause" button, which never said WHAT it
// paused, and the schedule editor that was buried in "Plan next run".
//
// `studio:wf-action` {loop, action: "schedule"} (the app menu's "Change
// schedule…") opens it straight into the editor.

import { useEffect, useState } from "react";
import { Clock, Pause, Play, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { MeApiError, patchLoopApplied } from "@/api/me";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import SchedulePicker from "@/components/workflow/SchedulePicker";
import { describeSchedule, parseSchedule } from "@/lib/schedule";
import { nextFireSec } from "@/lib/activity";
import { cn } from "@/lib/utils";

export interface WfActionDetail { loop: string; action: "plan" | "schedule" | "experiment" }

const clock = (sec: number) => new Date(sec * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export default function ScheduleChip({ app, loop, trigger, enabled, onChanged }: {
	app: string; loop: string; trigger: string; enabled: boolean; onChanged?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [cron, setCron] = useState(trigger || "@trigger");
	const [busy, setBusy] = useState<null | "toggle" | "save">(null);
	useEffect(() => { if (!editing) setCron(trigger || "@trigger"); }, [trigger, editing]);

	useEffect(() => {
		const h = (e: Event) => {
			const d = (e as CustomEvent<WfActionDetail>).detail;
			if (d?.loop === loop && d.action === "schedule") { setEditing(true); setOpen(true); }
		};
		window.addEventListener("studio:wf-action", h);
		return () => window.removeEventListener("studio:wf-action", h);
	}, [loop]);

	const manual = parseSchedule(trigger).kind === "trigger";
	const words = describeSchedule(trigger);
	const next = enabled && !manual ? nextFireSec(trigger) : null;

	const label = manual ? "On demand" : !enabled ? "Paused" : words;
	const sentence = manual
		? "Runs only when you start it."
		: !enabled
			? `Paused — it won't run on its own. When resumed it runs ${words.toLowerCase()}.`
			: `Runs ${words.charAt(0).toLowerCase()}${words.slice(1)}.${next ? ` Next run at ${clock(next)}.` : ""}`;

	const toggle = async () => {
		setBusy("toggle");
		try {
			// Wait for the scheduler to APPLY it (202 + intent id): without the
			// wait the next poll reads the pre-patch state and the toggle looks
			// like it silently failed.
			await patchLoopApplied(app, loop, { enabled: !enabled });
			toast.success(enabled ? "Paused — it won't run on its own." : "Resumed.");
			onChanged?.();
			setOpen(false);
		} catch (e) {
			toast.error(`Couldn't ${enabled ? "pause" : "resume"}: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setBusy(null); }
	};
	const save = async () => {
		setBusy("save");
		try {
			await patchLoopApplied(app, loop, { schedule: cron });
			toast.success(`Schedule set — ${describeSchedule(cron)}.`);
			setEditing(false);
			setOpen(false);
			onChanged?.();
		} catch (e) {
			toast.error(`Couldn't save the schedule: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setBusy(null); }
	};

	return (
		<Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(false); }}>
			<PopoverTrigger asChild>
				<button
					type="button"
					title="When this workflow runs"
					aria-label={`Schedule: ${label}`}
					className={cn(
						"inline-flex items-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-lg border text-caption font-medium transition-colors flex-shrink-0 max-w-[14rem]",
						!manual && !enabled
							? "border-ember-200 bg-ember-50 text-ember-700 hover:bg-ember-100"
							: "border-ink-200 bg-card text-ink-700 hover:bg-ink-50",
					)}
				>
					{!manual && !enabled ? <Pause className="w-3.5 h-3.5 flex-shrink-0" /> : <Clock className="w-3.5 h-3.5 flex-shrink-0" />}
					<span className="truncate hidden sm:inline">{label}</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-3 space-y-3">
				<div className="text-meta text-ink-800 leading-snug">{sentence}</div>
				{editing ? (
					<div className="space-y-2">
						<SchedulePicker value={cron} onChange={setCron} disabled={busy === "save"} />
						<div className="flex items-center gap-2">
							<Button size="sm" variant="primary" onClick={save} disabled={busy === "save" || cron === (trigger || "@trigger")}>
								{busy === "save" && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save schedule
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy === "save"}>Cancel</Button>
						</div>
					</div>
				) : (
					<div className="flex items-center gap-2 flex-wrap">
						{!manual && (
							<Button size="sm" variant="secondary" onClick={toggle} disabled={!!busy}>
								{busy === "toggle" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
								{enabled ? "Pause schedule" : "Resume schedule"}
							</Button>
						)}
						<Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={!!busy}>
							<Pencil className="w-3.5 h-3.5" /> {manual ? "Set a schedule" : "Change schedule"}
						</Button>
					</div>
				)}
				{/* Only where the zone changes the answer ("Daily at 1:07 PM"). */}
				{!manual && !next && enabled && (
					<div className="text-micro text-ink-600">Times are on the scheduler&apos;s clock (US Pacific).</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
