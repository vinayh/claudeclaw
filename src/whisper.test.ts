import { describe, it, expect } from "bun:test";
import { formatBytes } from "./whisper";

describe("formatBytes", () => {
  it("formats bytes under 1KB", () => {
    expect(formatBytes(512)).toBe("512B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1_500_000)).toBe("1.4MB");
  });

  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0B");
  });
});
