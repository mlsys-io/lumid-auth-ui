// SchedulePicker — schedules for normal humans; cron is the escape hatch.
//
// Works in ParsedSchedule terms (lib/schedule.ts): a preset <select> plus the
// minimum conditional sub-controls (interval, time, weekday). Custom cron
// strings open directly in Advanced and are never silently rewritten.
// Dirty/save state belongs to the PARENT — every change calls onChange with
// the canonical cron (or "@trigger").

import { useMemo, useState } from "react";
import {
	parseSchedule, formatSchedule, describeSchedule,
	type ParsedSchedule, DOW_LABELS,
} from "@/lib/schedule";

type PresetKey =
	| "trigger" | "m15" | "m30" | "hourly" | "h6" | "h12"
	| "daily" | "weekdays" | "weekly" | "custom";

const PRESETS: Array<{ key: PresetKey; label: string }> = [
	{ key: "trigger", label: "On demand" },
	{ key: "m15", label: "Every 15 min" },
	{ key: "m30", label: "Every 30 min" },
	{ key: "hourly", label: "Every hour" },
	{ key: "h6", label: "Every 6 hours" },
	{ key: "h12", label: "Every 12 hours" },
	{ key: "daily", label: "Daily at…" },
	{ key: "weekdays", label: "Weekdays at…" },
	{ key: "weekly", label: "Weekly…" },
	{ key: "custom", label: "Advanced (cron)" },
];

function presetOf(p: ParsedSchedule): PresetKey {
	switch (p.kind) {
		case "trigger": return "trigger";
		case "every_minutes": return p.n === 15 ? "m15" : p.n === 30 ? "m30" : "custom";
		case "every_hours": return p.n === 1 ? "hourly" : p.n === 6 ? "h6" : p.n === 12 ? "h12" : "h6";
		case "daily": return "daily";
		case "weekdays": return "weekdays";
		case "weekly": return "weekly";
		case "custom": return "custom";
	}
}

function toTimeInput(hour: number, minute: number): string {
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function SchedulePicker({ value, onChange, disabled }: {
	value: string;
	onChange: (cron: string) => void;
	disabled?: boolean;
}) {
	const parsed = useMemo(() => parseSchedule(value), [value]);
	const preset = presetOf(parsed);
	// Sticky sub-control state so switching presets keeps a sensible time.
	const [time, setTime] = useState(() =>
		"hour" in parsed ? toTimeInput(parsed.hour, parsed.minute) : "08:00");
	const [dow, setDow] = useState(() => (parsed.kind === "weekly" ? parsed.dow : 1));

	const emit = (p: ParsedSchedule) => onChange(formatSchedule(p));
	const [h, m] = time.split(":").map(Number);

	const pick = (key: PresetKey) => {
		switch (key) {
			case "trigger": return emit({ kind: "trigger" });
			case "m15": return emit({ kind: "every_minutes", n: 15 });
			case "m30": return emit({ kind: "every_minutes", n: 30 });
			case "hourly": return emit({ kind: "every_hours", n: 1, minute: 0 });
			case "h6": return emit({ kind: "every_hours", n: 6, minute: 0 });
			case "h12": return emit({ kind: "every_hours", n: 12, minute: 0 });
			case "daily": return emit({ kind: "daily", hour: h, minute: m });
			case "weekdays": return emit({ kind: "weekdays", hour: h, minute: m });
			case "weekly": return emit({ kind: "weekly", dow, hour: h, minute: m });
			case "custom": return emit({ kind: "custom", cron: formatSchedule(parsed) });
		}
	};

	const needsTime = preset === "daily" || preset === "weekdays" || preset === "weekly";

	return (
		<div className="space-y-1.5">
			<div className="flex flex-wrap items-center gap-1.5">
				<select
					value={preset}
					disabled={disabled}
					onChange={(e) => pick(e.target.value as PresetKey)}
					className="px-2 py-1 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/40"
				>
					{PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
				</select>
				{needsTime && (
					<input
						type="time"
						value={time}
						disabled={disabled}
						onChange={(e) => {
							setTime(e.target.value);
							const [nh, nm] = e.target.value.split(":").map(Number);
							if (Number.isFinite(nh)) {
								if (preset === "daily") emit({ kind: "daily", hour: nh, minute: nm });
								else if (preset === "weekdays") emit({ kind: "weekdays", hour: nh, minute: nm });
								else emit({ kind: "weekly", dow, hour: nh, minute: nm });
							}
						}}
						className="px-2 py-[3px] text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/40"
					/>
				)}
				{preset === "weekly" && (
					<select
						value={dow}
						disabled={disabled}
						onChange={(e) => { const d = +e.target.value; setDow(d); emit({ kind: "weekly", dow: d, hour: h, minute: m }); }}
						className="px-2 py-1 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/40"
					>
						{DOW_LABELS.map((l, i) => <option key={l} value={i}>{l.replace(/s$/, "")}</option>)}
					</select>
				)}
				{preset === "custom" && (
					<input
						type="text"
						value={parsed.kind === "custom" ? parsed.cron : formatSchedule(parsed)}
						disabled={disabled}
						onChange={(e) => onChange(e.target.value)}
						placeholder="cron e.g. 0 8 * * *"
						className="w-36 px-2 py-1 text-xs font-mono rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-gold-400/40"
					/>
				)}
			</div>
			<div className="text-[10px] text-slate-400">
				{describeSchedule(value)}{needsTime ? " · times in your AI's timezone (PT)" : ""}
			</div>
		</div>
	);
}
