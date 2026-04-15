import { describe, it, expect } from "bun:test";
import { formatCountdown, decodePath } from "./status";

describe("formatCountdown", () => {
  it("returns 'now!' for zero", () => {
    expect(formatCountdown(0)).toBe("now!");
  });

  it("returns 'now!' for negative values", () => {
    expect(formatCountdown(-1000)).toBe("now!");
  });

  it("returns '<1m' for less than 60 seconds", () => {
    expect(formatCountdown(30_000)).toBe("<1m");
  });

  it("returns minutes for values under an hour", () => {
    expect(formatCountdown(120_000)).toBe("2m");
  });

  it("returns hours and minutes for large values", () => {
    expect(formatCountdown(3_660_000)).toBe("1h 1m");
  });

  it("returns hours with 0 minutes", () => {
    expect(formatCountdown(3_600_000)).toBe("1h 0m");
  });
});

describe("decodePath", () => {
  it("decodes a project path", () => {
    expect(decodePath("-home-ubuntu-project")).toBe("/home/ubuntu/project");
  });

  it("decodes a single-segment path", () => {
    expect(decodePath("-tmp")).toBe("/tmp");
  });
});
