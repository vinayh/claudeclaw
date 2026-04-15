import { describe, it, expect } from "bun:test";
import { tailLines } from "./logs";

describe("tailLines", () => {
  it("returns last N lines", () => {
    expect(tailLines("a\nb\nc\nd\ne", 3)).toEqual(["c", "d", "e"]);
  });

  it("returns all lines when count exceeds total", () => {
    expect(tailLines("a\nb", 10)).toEqual(["a", "b"]);
  });

  it("returns empty array for empty string", () => {
    expect(tailLines("", 5)).toEqual([]);
  });

  it("filters out blank lines", () => {
    expect(tailLines("a\n\nb\n\n", 10)).toEqual(["a", "b"]);
  });

  it("handles single line", () => {
    expect(tailLines("hello", 1)).toEqual(["hello"]);
  });

  it("handles Windows-style line endings", () => {
    expect(tailLines("a\r\nb\r\nc", 2)).toEqual(["b", "c"]);
  });

  it("returns last 1 line", () => {
    expect(tailLines("a\nb\nc", 1)).toEqual(["c"]);
  });
});
