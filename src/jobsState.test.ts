import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-jobsstate-test-"));

mock.module("./paths", () => ({
  HEARTBEAT_DIR: tempDir,
  JOBS_STATE_FILE: join(tempDir, "jobs-state.json"),
}));

import { getLastFired, setLastFired, forgetJob, _resetCache } from "./jobsState";

async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

describe("jobsState", () => {
  beforeEach(async () => {
    await cleanTempDir();
    _resetCache();
  });
  afterAll(() => rm(tempDir, { recursive: true, force: true }));

  it("returns null for unknown job", async () => {
    expect(await getLastFired("never-ran")).toBeNull();
  });

  it("round-trips a timestamp", async () => {
    const at = new Date("2026-01-14T09:30:00.000Z");
    await setLastFired("git-summary", at);
    _resetCache();
    const got = await getLastFired("git-summary");
    expect(got?.toISOString()).toBe(at.toISOString());
  });

  it("preserves entries for other jobs when one is updated", async () => {
    await setLastFired("a", new Date("2026-01-14T09:00:00Z"));
    await setLastFired("b", new Date("2026-01-14T10:00:00Z"));
    _resetCache();
    expect((await getLastFired("a"))?.toISOString()).toBe("2026-01-14T09:00:00.000Z");
    expect((await getLastFired("b"))?.toISOString()).toBe("2026-01-14T10:00:00.000Z");
  });

  it("forgetJob removes a single entry", async () => {
    await setLastFired("a", new Date("2026-01-14T09:00:00Z"));
    await setLastFired("b", new Date("2026-01-14T10:00:00Z"));
    await forgetJob("a");
    _resetCache();
    expect(await getLastFired("a")).toBeNull();
    expect(await getLastFired("b")).not.toBeNull();
  });

  it("starts fresh when state file is corrupt", async () => {
    await writeFile(join(tempDir, "jobs-state.json"), "{ not valid json", "utf-8");
    _resetCache();
    expect(await getLastFired("anything")).toBeNull();
  });

  it("ignores invalid ISO strings", async () => {
    await writeFile(
      join(tempDir, "jobs-state.json"),
      JSON.stringify({ lastFiredAt: { broken: "not-a-date" } }),
      "utf-8"
    );
    _resetCache();
    expect(await getLastFired("broken")).toBeNull();
  });
});
