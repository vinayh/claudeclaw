import { describe, it, expect } from "vitest";
import {
  clampTimezoneOffsetMinutes,
  parseUtcOffsetMinutes,
  normalizeTimezoneName,
  resolveTimezoneOffsetMinutes,
  shiftDateToOffset,
  formatUtcOffsetLabel,
  buildClockPromptPrefix,
  getDayAndMinuteAtOffset,
} from "./timezone";

describe("clampTimezoneOffsetMinutes", () => {
  it("passes through values within range", () => {
    expect(clampTimezoneOffsetMinutes(0)).toBe(0);
    expect(clampTimezoneOffsetMinutes(330)).toBe(330);
    expect(clampTimezoneOffsetMinutes(-300)).toBe(-300);
  });

  it("clamps to -720 (UTC-12)", () => {
    expect(clampTimezoneOffsetMinutes(-720)).toBe(-720);
    expect(clampTimezoneOffsetMinutes(-1000)).toBe(-720);
  });

  it("clamps to 840 (UTC+14)", () => {
    expect(clampTimezoneOffsetMinutes(840)).toBe(840);
    expect(clampTimezoneOffsetMinutes(1000)).toBe(840);
  });

  it("returns 0 for NaN and Infinity", () => {
    expect(clampTimezoneOffsetMinutes(NaN)).toBe(0);
    expect(clampTimezoneOffsetMinutes(Infinity)).toBe(0);
    expect(clampTimezoneOffsetMinutes(-Infinity)).toBe(0);
  });

  it("rounds fractional values", () => {
    expect(clampTimezoneOffsetMinutes(330.7)).toBe(331);
    expect(clampTimezoneOffsetMinutes(330.3)).toBe(330);
  });
});

describe("parseUtcOffsetMinutes", () => {
  it("returns 0 for UTC and GMT", () => {
    expect(parseUtcOffsetMinutes("UTC")).toBe(0);
    expect(parseUtcOffsetMinutes("GMT")).toBe(0);
  });

  it("parses positive offsets", () => {
    expect(parseUtcOffsetMinutes("UTC+5")).toBe(300);
    expect(parseUtcOffsetMinutes("UTC+05")).toBe(300);
    expect(parseUtcOffsetMinutes("UTC+14")).toBe(840);
  });

  it("parses negative offsets", () => {
    expect(parseUtcOffsetMinutes("UTC-5")).toBe(-300);
    expect(parseUtcOffsetMinutes("UTC-12")).toBe(-720);
  });

  it("parses offsets with minutes", () => {
    expect(parseUtcOffsetMinutes("UTC+5:30")).toBe(330);
    expect(parseUtcOffsetMinutes("UTC-5:30")).toBe(-330);
    expect(parseUtcOffsetMinutes("UTC+05:45")).toBe(345);
  });

  it("handles colon-less minute format", () => {
    expect(parseUtcOffsetMinutes("UTC+0530")).toBe(330);
  });

  it("is case-insensitive", () => {
    expect(parseUtcOffsetMinutes("utc+3")).toBe(180);
    expect(parseUtcOffsetMinutes("gmt-5")).toBe(-300);
  });

  it("returns null for out-of-range offsets", () => {
    expect(parseUtcOffsetMinutes("UTC+15")).toBeNull();
  });

  it("returns null for malformed inputs", () => {
    expect(parseUtcOffsetMinutes("UTC+")).toBeNull();
    expect(parseUtcOffsetMinutes("EST")).toBeNull();
    expect(parseUtcOffsetMinutes("")).toBeNull();
    expect(parseUtcOffsetMinutes(123)).toBeNull();
    expect(parseUtcOffsetMinutes(null)).toBeNull();
  });
});

describe("normalizeTimezoneName", () => {
  it("passes through valid IANA timezone names", () => {
    expect(normalizeTimezoneName("America/New_York")).toBe("America/New_York");
    expect(normalizeTimezoneName("Europe/London")).toBe("Europe/London");
  });

  it("uppercases valid UTC offset strings", () => {
    expect(normalizeTimezoneName("utc+5")).toBe("UTC+5");
    expect(normalizeTimezoneName("gmt-3")).toBe("GMT-3");
  });

  it("returns empty string for invalid inputs", () => {
    expect(normalizeTimezoneName("Not/A/Timezone")).toBe("");
    expect(normalizeTimezoneName("")).toBe("");
    expect(normalizeTimezoneName(123)).toBe("");
    expect(normalizeTimezoneName(null)).toBe("");
  });
});

describe("resolveTimezoneOffsetMinutes", () => {
  it("uses numeric value directly (clamped)", () => {
    expect(resolveTimezoneOffsetMinutes(300)).toBe(300);
    expect(resolveTimezoneOffsetMinutes(9999)).toBe(840);
  });

  it("parses numeric string", () => {
    expect(resolveTimezoneOffsetMinutes("300")).toBe(300);
  });

  it("falls back to UTC offset string", () => {
    expect(resolveTimezoneOffsetMinutes(undefined, "UTC+5")).toBe(300);
  });

  it("falls back to IANA timezone", () => {
    const result = resolveTimezoneOffsetMinutes(undefined, "America/New_York");
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(-720);
    expect(result).toBeLessThanOrEqual(840);
  });

  it("defaults to 0 when all lookups fail", () => {
    expect(resolveTimezoneOffsetMinutes(undefined)).toBe(0);
    expect(resolveTimezoneOffsetMinutes(NaN, "Invalid/Zone")).toBe(0);
  });
});

describe("shiftDateToOffset", () => {
  const base = new Date("2026-01-15T12:00:00Z");

  it("shifts forward for positive offset", () => {
    const shifted = shiftDateToOffset(base, 330); // UTC+5:30
    expect(shifted.getUTCHours()).toBe(17);
    expect(shifted.getUTCMinutes()).toBe(30);
  });

  it("shifts backward for negative offset", () => {
    const shifted = shiftDateToOffset(base, -300); // UTC-5
    expect(shifted.getUTCHours()).toBe(7);
  });

  it("returns same time for zero offset", () => {
    const shifted = shiftDateToOffset(base, 0);
    expect(shifted.getTime()).toBe(base.getTime());
  });

  it("does not mutate the input date", () => {
    const original = base.getTime();
    shiftDateToOffset(base, 300);
    expect(base.getTime()).toBe(original);
  });
});

describe("formatUtcOffsetLabel", () => {
  it("formats zero offset", () => {
    expect(formatUtcOffsetLabel(0)).toBe("UTC+0");
  });

  it("formats positive whole hours", () => {
    expect(formatUtcOffsetLabel(300)).toBe("UTC+5");
  });

  it("formats negative whole hours", () => {
    expect(formatUtcOffsetLabel(-300)).toBe("UTC-5");
  });

  it("formats offsets with minutes", () => {
    expect(formatUtcOffsetLabel(330)).toBe("UTC+5:30");
    expect(formatUtcOffsetLabel(-330)).toBe("UTC-5:30");
    expect(formatUtcOffsetLabel(345)).toBe("UTC+5:45");
  });
});

describe("buildClockPromptPrefix", () => {
  it("formats a known date with offset", () => {
    const date = new Date("2026-04-13T10:30:45Z");
    const result = buildClockPromptPrefix(date, 330);
    expect(result).toBe("[2026-04-13 16:00:45 UTC+5:30]");
  });

  it("zero-pads month and day", () => {
    const date = new Date("2026-01-05T03:05:09Z");
    const result = buildClockPromptPrefix(date, 0);
    expect(result).toBe("[2026-01-05 03:05:09 UTC+0]");
  });
});

describe("getDayAndMinuteAtOffset", () => {
  it("returns correct day and minute", () => {
    // Wednesday 2026-01-14 at 14:30 UTC
    const date = new Date("2026-01-14T14:30:00Z");
    const result = getDayAndMinuteAtOffset(date, 0);
    expect(result.day).toBe(3); // Wednesday
    expect(result.minute).toBe(14 * 60 + 30); // 870
  });

  it("offset crossing midnight changes the day", () => {
    // Wednesday 2026-01-14 at 23:00 UTC, offset +120 (UTC+2) → Thursday 01:00
    const date = new Date("2026-01-14T23:00:00Z");
    const result = getDayAndMinuteAtOffset(date, 120);
    expect(result.day).toBe(4); // Thursday
    expect(result.minute).toBe(60); // 01:00
  });

  it("negative offset crossing midnight goes back a day", () => {
    // Thursday 2026-01-15 at 01:00 UTC, offset -120 (UTC-2) → Wednesday 23:00
    const date = new Date("2026-01-15T01:00:00Z");
    const result = getDayAndMinuteAtOffset(date, -120);
    expect(result.day).toBe(3); // Wednesday
    expect(result.minute).toBe(23 * 60); // 1380
  });
});
