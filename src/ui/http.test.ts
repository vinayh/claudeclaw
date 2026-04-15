import { describe, it, expect } from "bun:test";
import { json, clampInt } from "./http";

describe("json", () => {
  it("returns a Response with JSON content-type", () => {
    const res = json({ ok: true });
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  });

  it("serializes the data as JSON body", async () => {
    const data = { a: 1, b: [2, 3] };
    const res = json(data);
    expect(await res.json()).toEqual(data);
  });

  it("handles null", async () => {
    const res = json(null);
    expect(await res.json()).toBeNull();
  });
});

describe("clampInt", () => {
  it("returns fallback for null input", () => {
    expect(clampInt(null, 10, 0, 100)).toBe(10);
  });

  it("returns fallback for NaN input", () => {
    expect(clampInt("abc", 10, 0, 100)).toBe(10);
  });

  it("returns fallback for Infinity", () => {
    expect(clampInt("Infinity", 10, 0, 100)).toBe(10);
  });

  it("clamps below min", () => {
    expect(clampInt("-5", 10, 0, 100)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clampInt("200", 10, 0, 100)).toBe(100);
  });

  it("passes through valid value", () => {
    expect(clampInt("42", 10, 0, 100)).toBe(42);
  });

  it("truncates decimals", () => {
    expect(clampInt("7.9", 10, 0, 100)).toBe(7);
  });
});
