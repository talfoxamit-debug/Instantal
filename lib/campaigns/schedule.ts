// Timezone-aware send-window logic. Cold email must only go out during
// business hours on selected weekdays (Section 5.2). Pure + injectable clock
// so it is unit-testable; the worker calls isWithinWindow to gate each send
// and nextWindowOpen to schedule the next attempt.

export interface SendWindow {
  // Minutes-of-day, local to `timeZone`. e.g. 09:00 -> 540.
  startMinute: number;
  endMinute: number;
  // ISO weekdays allowed: 1=Mon .. 7=Sun.
  days: number[];
  timeZone: string;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  isoWeekday: number; // 1=Mon..7=Sun
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

// Wall-clock parts of `date` as seen in `timeZone`.
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour,
    minute: parseInt(get("minute"), 10),
    isoWeekday: WEEKDAY_TO_ISO[get("weekday")] ?? 1,
  };
}

// Offset (localWallTime - UTC) in ms for `date` in `timeZone`.
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Round `date` to the minute to match the parts' resolution.
  const dateMinute = Math.floor(date.getTime() / 60000) * 60000;
  return asUtc - dateMinute;
}

// Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
// Correct except within the ~1h DST transition, where it can be off by an
// hour — acceptable for send-timing (Section 5.2).
export function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

export function isWithinWindow(now: Date, w: SendWindow): boolean {
  const p = zonedParts(now, w.timeZone);
  if (!w.days.includes(p.isoWeekday)) return false;
  const minuteOfDay = p.hour * 60 + p.minute;
  return minuteOfDay >= w.startMinute && minuteOfDay < w.endMinute;
}

// The next instant the window is open: `now` if already within, otherwise the
// start of the next eligible day (today if before today's window opens).
export function nextWindowOpen(now: Date, w: SendWindow): Date {
  if (isWithinWindow(now, w)) return now;

  const p = zonedParts(now, w.timeZone);
  const minuteOfDay = p.hour * 60 + p.minute;

  // If today is an eligible day and we're before the window opens, use today.
  if (w.days.includes(p.isoWeekday) && minuteOfDay < w.startMinute) {
    return zonedWallToUtc(
      p.year,
      p.month,
      p.day,
      Math.floor(w.startMinute / 60),
      w.startMinute % 60,
      w.timeZone,
    );
  }

  // Otherwise scan forward up to 8 days for the next eligible day.
  for (let addDays = 1; addDays <= 8; addDays++) {
    const probe = new Date(now.getTime() + addDays * 86_400_000);
    const pp = zonedParts(probe, w.timeZone);
    if (w.days.includes(pp.isoWeekday)) {
      return zonedWallToUtc(
        pp.year,
        pp.month,
        pp.day,
        Math.floor(w.startMinute / 60),
        w.startMinute % 60,
        w.timeZone,
      );
    }
  }
  // No eligible day configured (shouldn't happen — launch gate requires days).
  return new Date(now.getTime() + 86_400_000);
}

// Parse a Postgres `time` value ("09:00:00" / "09:00") to minutes-of-day.
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m ?? "0", 10);
}
