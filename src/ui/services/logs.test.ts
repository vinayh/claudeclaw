import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-logs-test-"));

mock.module("../constants", () => ({
  LOGS_DIR: tempDir,
}));

import { tailLines, readLogs } from "./logs";

async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

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

describe("readLogs", () => {
  beforeEach(cleanTempDir);
  afterAll(() => rm(tempDir, { recursive: true, force: true }));

  it("returns empty results when logs dir is empty", async () => {
    const result = await readLogs(10);
    expect(result.daemonLog).toEqual([]);
    expect(result.runs).toEqual([]);
  });

  it("returns the tail of daemon.log", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    await writeFile(join(tempDir, "daemon.log"), lines, "utf-8");
    const result = await readLogs(5);
    expect(result.daemonLog).toEqual(["line 25", "line 26", "line 27", "line 28", "line 29"]);
  });

  it("includes recent run logs but excludes daemon.log from runs", async () => {
    await writeFile(join(tempDir, "daemon.log"), "daemon body\n", "utf-8");
    await writeFile(join(tempDir, "heartbeat-1.log"), "hb body line", "utf-8");
    await writeFile(join(tempDir, "git-summary-1.log"), "gs body line", "utf-8");
    const result = await readLogs(5);
    expect(result.runs.length).toBe(2);
    const names = result.runs.map((r) => r.file).sort();
    expect(names).toEqual(["git-summary-1.log", "heartbeat-1.log"]);
    expect(names).not.toContain("daemon.log");
  });

  it("caps run logs at 5 most recent", async () => {
    for (let i = 0; i < 8; i++) {
      await writeFile(join(tempDir, `job-${i}.log`), `body ${i}`, "utf-8");
    }
    const result = await readLogs(5);
    expect(result.runs.length).toBe(5);
  });
});
