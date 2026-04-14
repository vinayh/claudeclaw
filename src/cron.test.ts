import { describe, it, expect } from "bun:test";
import { cronMatches, nextCronMatch } from "./cron";

describe("cronMatches", () => {
  // Wednesday 2026-01-14 at 09:30 UTC
  const date = new Date("2026-01-14T09:30:00Z");

  it("wildcard matches any date", () => {
    expect(cronMatches("* * * * *", date)).toBe(true);
  });

  it("matches specific minute", () => {
    expect(cronMatches("30 * * * *", date)).toBe(true);
    expect(cronMatches("0 * * * *", date)).toBe(false);
  });

  it("matches specific hour", () => {
    expect(cronMatches("30 9 * * *", date)).toBe(true);
    expect(cronMatches("30 10 * * *", date)).toBe(false);
  });

  it("matches day of month", () => {
    expect(cronMatches("30 9 14 * *", date)).toBe(true);
    expect(cronMatches("30 9 15 * *", date)).toBe(false);
  });

  it("matches month", () => {
    expect(cronMatches("30 9 14 1 *", date)).toBe(true);
    expect(cronMatches("30 9 14 2 *", date)).toBe(false);
  });

  it("matches day of week (0=Sunday, 3=Wednesday)", () => {
    expect(cronMatches("30 9 * * 3", date)).toBe(true);
    expect(cronMatches("30 9 * * 1", date)).toBe(false);
  });

  it("matches comma-separated values", () => {
    expect(cronMatches("0,15,30,45 * * * *", date)).toBe(true);
    expect(cronMatches("0,15,45 * * * *", date)).toBe(false);
  });

  it("matches ranges", () => {
    expect(cronMatches("25-35 * * * *", date)).toBe(true);
    expect(cronMatches("0-20 * * * *", date)).toBe(false);
  });

  it("matches step values", () => {
    expect(cronMatches("*/10 * * * *", date)).toBe(true);  // 30 % 10 === 0
    expect(cronMatches("*/7 * * * *", date)).toBe(false);   // 30 % 7 !== 0
  });

  it("matches range with step", () => {
    expect(cronMatches("0-30/10 * * * *", date)).toBe(true);   // 30 in 0-30, (30-0)%10===0
    expect(cronMatches("0-30/7 * * * *", date)).toBe(false);   // (30-0)%7 !== 0
    expect(cronMatches("5-25/5 * * * *", date)).toBe(false);   // 30 not in 5-25
  });

  it("applies timezone offset", () => {
    // 09:30 UTC + 60min offset = 10:30 in local time
    expect(cronMatches("30 10 * * *", date, 60)).toBe(true);
    expect(cronMatches("30 9 * * *", date, 60)).toBe(false);
  });

  it("timezone offset crossing midnight", () => {
    const lateDate = new Date("2026-01-14T23:30:00Z"); // Wed 23:30 UTC
    // +120 offset → Thu 01:30
    expect(cronMatches("30 1 * * 4", lateDate, 120)).toBe(true);  // Thursday
    expect(cronMatches("30 1 * * 3", lateDate, 120)).toBe(false); // not Wednesday anymore
  });
});

describe("nextCronMatch", () => {
  it("finds next hour mark from mid-hour", () => {
    const from = new Date("2026-01-14T09:30:00Z");
    const next = nextCronMatch("0 * * * *", from);
    expect(next.getUTCHours()).toBe(10);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("finds next specific time", () => {
    const from = new Date("2026-01-14T10:00:00Z");
    const next = nextCronMatch("0 9 * * *", from); // 9am daily, already past today
    expect(next.getUTCDate()).toBe(15); // next day
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("finds next weekday match", () => {
    // From Wednesday, find next Thursday at 9:00 (within 48-hour scan window)
    const from = new Date("2026-01-14T10:00:00Z"); // Wednesday
    const next = nextCronMatch("0 9 * * 4", from); // Thursday
    expect(next.getUTCDay()).toBe(4); // Thursday
    expect(next.getUTCDate()).toBe(15);
    expect(next.getUTCHours()).toBe(9);
  });

  it("advances at least one minute", () => {
    const from = new Date("2026-01-14T09:30:00Z");
    const next = nextCronMatch("* * * * *", from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.getUTCMinutes()).toBe(31);
  });

  it("applies timezone offset", () => {
    // Find 9am in UTC+5 timezone
    const from = new Date("2026-01-14T00:00:00Z");
    const next = nextCronMatch("0 9 * * *", from, 300);
    // 9am local = 4am UTC
    expect(next.getUTCHours()).toBe(4);
    expect(next.getUTCMinutes()).toBe(0);
  });
});
