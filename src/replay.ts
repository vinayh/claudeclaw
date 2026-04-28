import { nextCronMatch } from "./cron";

/**
 * Given a job's cron schedule, the cursor of its last fire, and the current
 * time, return every match in the half-open interval (cursor, now].
 *
 * If the number of missed matches exceeds `maxReplays`, return only the most
 * recent match and report the rest as `skipped`. This caps catch-up after long
 * downtime: a `*-/5 * * * *` job with a 7-day daemon outage produces one fire,
 * not 2,016.
 *
 * `newCursor` is the timestamp the caller should persist as the new
 * `lastFiredAt`: the latest fire time we returned, or the original cursor if
 * none matched.
 */
export interface ReplayResult {
  fires: Date[];
  newCursor: Date;
  skipped: number;
}

export function computeMissedFires(
  schedule: string,
  cursor: Date,
  now: Date,
  timezoneOffsetMinutes: number,
  maxReplays: number
): ReplayResult {
  if (cursor.getTime() >= now.getTime()) {
    return { fires: [], newCursor: cursor, skipped: 0 };
  }

  const fires: Date[] = [];
  let walker = cursor;
  // Walk forward up to maxReplays + 1 to detect overflow. The final extra
  // iteration tells us whether to coalesce.
  while (fires.length <= maxReplays) {
    const next = nextCronMatch(schedule, walker, timezoneOffsetMinutes);
    if (next.getTime() > now.getTime()) break;
    fires.push(next);
    walker = next;
  }

  if (fires.length <= maxReplays) {
    const newCursor = fires.length > 0 ? fires[fires.length - 1] : cursor;
    return { fires, newCursor, skipped: 0 };
  }

  // Overflow: keep walking to find the most recent match <= now, then collapse.
  let last = fires[fires.length - 1];
  let skipped = fires.length - 1; // everything except the one we'll keep
  while (true) {
    const next = nextCronMatch(schedule, last, timezoneOffsetMinutes);
    if (next.getTime() > now.getTime()) break;
    last = next;
    skipped++;
  }
  return { fires: [last], newCursor: last, skipped };
}

/**
 * Milliseconds until the next minute boundary in wall-clock time. Used to
 * align the cron tick to `:00` of each minute, eliminating setInterval drift.
 */
export function msUntilNextMinute(now: number = Date.now()): number {
  const ms = 60_000 - (now % 60_000);
  // If we're already exactly on a boundary, schedule for the next one rather
  // than firing immediately.
  return ms === 0 ? 60_000 : ms;
}
