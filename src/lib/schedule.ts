// schedule.ts — cron parse/format/describe for normal humans.
//
// The single source for everything schedule-shaped in the UI. Loops declare
// schedules as 5-field cron, scheduler shorthands ("*/12h", "*/30m"), or
// "@trigger" (manual only). Normal users never see cron: the SchedulePicker
// works in ParsedSchedule terms and describeSchedule() renders one English
// line everywhere.
//
// Times are interpreted by the scheduler container in America/Los_Angeles
// (see CLAUDE.md) — the picker labels absolute times as PT.

export type ParsedSchedule =
  | { kind: "trigger" }
  | { kind: "every_minutes"; n: number }
  | { kind: "every_hours"; n: number; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; dow: number; hour: number; minute: number } // 0=Sun..6=Sat
  | { kind: "custom"; cron: string };

const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};
const DOW_LABELS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function dowToNum(tok: string): number | null {
  const up = tok.toUpperCase();
  if (up in DOW_NAMES) return DOW_NAMES[up];
  if (/^[0-7]$/.test(tok)) return Number(tok) === 7 ? 0 : Number(tok);
  return null;
}

export function parseSchedule(s?: string): ParsedSchedule {
  const raw = (s || "").trim().replace(/\s+/g, " ");
  if (!raw || raw === "@trigger") return { kind: "trigger" };
  if (raw === "@hourly") return { kind: "every_hours", n: 1, minute: 0 };
  if (raw === "@daily" || raw === "@midnight") return { kind: "daily", hour: 0, minute: 0 };

  // Scheduler shorthands: */12h, */30m
  let m = raw.match(/^\*\/(\d+)h$/i);
  if (m) return { kind: "every_hours", n: +m[1], minute: 0 };
  m = raw.match(/^\*\/(\d+)m$/i);
  if (m) return { kind: "every_minutes", n: +m[1] };

  const parts = raw.split(" ");
  if (parts.length !== 5) return { kind: "custom", cron: raw };
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*") return { kind: "custom", cron: raw };

  // */N * * * *
  if ((m = min.match(/^\*\/(\d+)$/)) && hour === "*" && dow === "*")
    return { kind: "every_minutes", n: +m[1] };
  // 0 * * * * (or M * * * *)
  if (/^\d{1,2}$/.test(min) && hour === "*" && dow === "*")
    return { kind: "every_hours", n: 1, minute: +min };
  // M */N * * *
  if (/^\d{1,2}$/.test(min) && (m = hour.match(/^\*\/(\d+)$/)) && dow === "*")
    return { kind: "every_hours", n: +m[1], minute: +min };
  if (/^\d{1,2}$/.test(min) && /^\d{1,2}$/.test(hour)) {
    const h = +hour, mi = +min;
    if (dow === "*") return { kind: "daily", hour: h, minute: mi };
    if (dow === "1-5" || dow.toUpperCase() === "MON-FRI")
      return { kind: "weekdays", hour: h, minute: mi };
    const d = dowToNum(dow);
    if (d !== null) return { kind: "weekly", dow: d, hour: h, minute: mi };
  }
  return { kind: "custom", cron: raw };
}

export function formatSchedule(p: ParsedSchedule): string {
  switch (p.kind) {
    case "trigger":       return "@trigger";
    case "every_minutes": return `*/${p.n} * * * *`;
    case "every_hours":   return p.n === 1 ? `${p.minute} * * * *` : `${p.minute} */${p.n} * * *`;
    case "daily":         return `${p.minute} ${p.hour} * * *`;
    case "weekdays":      return `${p.minute} ${p.hour} * * 1-5`;
    case "weekly":        return `${p.minute} ${p.hour} * * ${p.dow}`;
    case "custom":        return p.cron;
  }
}

function time12(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

// One English line — used in the workflow list, the detail header, the
// picker preview, and the not-run-yet empty state.
export function describeSchedule(s?: string): string {
  const p = parseSchedule(s);
  switch (p.kind) {
    case "trigger":       return "On demand";
    case "every_minutes": return p.n === 1 ? "Every minute" : `Every ${p.n} min`;
    case "every_hours":   return p.n === 1 ? "Every hour" : `Every ${p.n} hours`;
    case "daily":         return `Daily at ${time12(p.hour, p.minute)}`;
    case "weekdays":      return `Weekdays at ${time12(p.hour, p.minute)}`;
    case "weekly":        return `${DOW_LABELS[p.dow]} at ${time12(p.hour, p.minute)}`;
    case "custom":        return `Custom (${p.cron})`;
  }
}

export { DOW_LABELS };
