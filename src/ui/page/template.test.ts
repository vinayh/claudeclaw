import { describe, expect, test } from "bun:test";
import { decodeUnicodeEscapes } from "./template";

describe("decodeUnicodeEscapes", () => {
  test("decodes \\u{XX} code point format", () => {
    expect(decodeUnicodeEscapes("\\u{41}")).toBe("A");
    expect(decodeUnicodeEscapes("\\u{61}")).toBe("a");
  });

  test("decodes \\uXXXX 4-digit format", () => {
    expect(decodeUnicodeEscapes("\\u0041")).toBe("A");
    expect(decodeUnicodeEscapes("\\u0061")).toBe("a");
  });

  test("decodes mixed formats in one string", () => {
    expect(decodeUnicodeEscapes("\\u{48}ello \\u0057orld")).toBe("Hello World");
  });

  test("handles multiple escapes", () => {
    expect(decodeUnicodeEscapes("\\u{48}\\u{49}")).toBe("HI");
    expect(decodeUnicodeEscapes("\\u0048\\u0049")).toBe("HI");
  });

  test("returns string unchanged when no escapes present", () => {
    expect(decodeUnicodeEscapes("Hello World")).toBe("Hello World");
    expect(decodeUnicodeEscapes("")).toBe("");
  });

  test("handles edge code points", () => {
    expect(decodeUnicodeEscapes("\\u{0}")).toBe("\0");
    expect(decodeUnicodeEscapes("\\u0000")).toBe("\0");
  });

  test("handles emoji code points", () => {
    expect(decodeUnicodeEscapes("\\u{1F600}")).toBe("\u{1F600}");
  });

  test("handles case-insensitive hex digits", () => {
    expect(decodeUnicodeEscapes("\\u{4a}")).toBe("J");
    expect(decodeUnicodeEscapes("\\u{4A}")).toBe("J");
    expect(decodeUnicodeEscapes("\\u004A")).toBe("J");
    expect(decodeUnicodeEscapes("\\u004a")).toBe("J");
  });

  test("preserves surrounding text", () => {
    expect(decodeUnicodeEscapes("before \\u{41} after")).toBe("before A after");
  });
});
