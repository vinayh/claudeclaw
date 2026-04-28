import { describe, it, expect } from "bun:test";
import { computeMissedFires, msUntilNextMinute } from "./replay";

const TZ = 0;
const MAX = 10;

describe("computeMissedFires", () => {
  it("returns no fires when cursor is at or after now", () => {
    const cursor = new Date("2026-01-14T09:00:00Z");
    const now = new Date("2026-01-14T09:00:00Z");
    const r = computeMissedFires("* * * * *", cursor, now, TZ, MAX);
    expect(r.fires).toEqual([]);
    expect(r.skipped).toBe(0);
    expect(r.newCursor).toEqual(cursor);
  });

  it("returns one fire for a single missed minute", () => {
    const cursor = new Date("2026-01-14T09:00:00Z");
    const now = new Date("2026-01-14T09:01:30Z");
    const r = computeMissedFires("* * * * *", cursor, now, TZ, MAX);
    expect(r.fires.length).toBe(1);
    expect(r.fires[0].toISOString()).toBe("2026-01-14T09:01:00.000Z");
    expect(r.skipped).toBe(0);
    expect(r.newCursor).toEqual(r.fires[0]);
  });

  it("returns multiple fires when several are missed under the cap", () => {
    const cursor = new Date("2026-01-14T09:00:00Z");
    const now = new Date("2026-01-14T09:05:30Z");
    const r = computeMissedFires("* * * * *", cursor, now, TZ, MAX);
    expect(r.fires.length).toBe(5);
    expect(r.fires[0].toISOString()).toBe("2026-01-14T09:01:00.000Z");
    expect(r.fires[4].toISOString()).toBe("2026-01-14T09:05:00.000Z");
    expect(r.skipped).toBe(0);
    expect(r.newCursor).toEqual(r.fires[4]);
  });

  it("coalesces to one fire when missed fires exceed the cap", () => {
    // 60 missed fires of `* * * * *` over an hour, cap at 10.
    const cursor = new Date("2026-01-14T09:00:00Z");
    const now = new Date("2026-01-14T10:00:30Z");
    const r = computeMissedFires("* * * * *", cursor, now, TZ, MAX);
    expect(r.fires.length).toBe(1);
    expect(r.fires[0].toISOString()).toBe("2026-01-14T10:00:00.000Z");
    expect(r.skipped).toBe(59);
    expect(r.newCursor).toEqual(r.fires[0]);
  });

  it("respects sparse schedules", () => {
    // `0 9 * * *` from 8:00 today to 9:30 today fires once at 9:00.
    const cursor = new Date("2026-01-14T08:00:00Z");
    const now = new Date("2026-01-14T09:30:00Z");
    const r = computeMissedFires("0 9 * * *", cursor, now, TZ, MAX);
    expect(r.fires.length).toBe(1);
    expect(r.fires[0].toISOString()).toBe("2026-01-14T09:00:00.000Z");
    expect(r.skipped).toBe(0);
  });

  it("returns no fires when no match falls in the window", () => {
    // `0 9 * * *` from 10:00 to 12:00 today fires zero times.
    const cursor = new Date("2026-01-14T10:00:00Z");
    const now = new Date("2026-01-14T12:00:00Z");
    const r = computeMissedFires("0 9 * * *", cursor, now, TZ, MAX);
    expect(r.fires).toEqual([]);
    expect(r.skipped).toBe(0);
    expect(r.newCursor).toEqual(cursor);
  });

  it("respects timezone offset", () => {
    // `0 9 * * *` with +60min offset means 9am local = 8am UTC.
    const cursor = new Date("2026-01-14T07:00:00Z");
    const now = new Date("2026-01-14T08:30:00Z");
    const r = computeMissedFires("0 9 * * *", cursor, now, 60, MAX);
    expect(r.fires.length).toBe(1);
    expect(r.fires[0].toISOString()).toBe("2026-01-14T08:00:00.000Z");
  });
});

describe("msUntilNextMinute", () => {
  it("returns 60000 when exactly on a minute boundary", () => {
    const t = new Date("2026-01-14T09:00:00.000Z").getTime();
    expect(msUntilNextMinute(t)).toBe(60_000);
  });

  it("returns the remainder mid-minute", () => {
    const t = new Date("2026-01-14T09:00:30.500Z").getTime();
    expect(msUntilNextMinute(t)).toBe(29_500);
  });

  it("never returns zero", () => {
    expect(msUntilNextMinute(60_000)).toBe(60_000);
  });
});
