import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-jobs-io-test-"));

mock.module("./paths", () => ({
  JOBS_DIR: tempDir,
}));

import { loadJobs, clearJobSchedule } from "./jobs";

async function cleanTempDir() {
  const files = await readdir(tempDir);
  await Promise.all(files.map((f) => rm(join(tempDir, f), { force: true })));
}

describe("loadJobs", () => {
  beforeEach(cleanTempDir);

  it("returns empty array when jobs dir is empty", async () => {
    expect(await loadJobs()).toEqual([]);
  });

  it("loads valid markdown jobs", async () => {
    await writeFile(
      join(tempDir, "git-summary.md"),
      `---\nschedule: "0 9 * * *"\nrecurring: true\n---\nSummarize git activity`,
      "utf-8"
    );
    await writeFile(
      join(tempDir, "deploy-check.md"),
      `---\nschedule: "*/15 * * * *"\nnotify: error\n---\nCheck deploy status`,
      "utf-8"
    );
    const jobs = await loadJobs();
    expect(jobs.length).toBe(2);
    const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));
    expect(byName["git-summary"].schedule).toBe("0 9 * * *");
    expect(byName["git-summary"].recurring).toBe(true);
    expect(byName["deploy-check"].notify).toBe("error");
  });

  it("ignores non-markdown files", async () => {
    await writeFile(join(tempDir, "notes.txt"), "ignored", "utf-8");
    await writeFile(
      join(tempDir, "real.md"),
      `---\nschedule: "0 0 * * *"\n---\nbody`,
      "utf-8"
    );
    const jobs = await loadJobs();
    expect(jobs.map((j) => j.name)).toEqual(["real"]);
  });

  it("silently drops files that fail to parse", async () => {
    await writeFile(join(tempDir, "bad.md"), "no frontmatter at all", "utf-8");
    await writeFile(
      join(tempDir, "good.md"),
      `---\nschedule: "0 0 * * *"\n---\nbody`,
      "utf-8"
    );
    const jobs = await loadJobs();
    expect(jobs.map((j) => j.name)).toEqual(["good"]);
  });
});

describe("clearJobSchedule", () => {
  beforeEach(cleanTempDir);
  afterAll(() => rm(tempDir, { recursive: true, force: true }));

  it("strips the schedule line from a job file", async () => {


    const path = join(tempDir, "one-shot.md");
    await writeFile(
      path,
      `---\nschedule: "0 9 * * *"\nrecurring: false\n---\nDo it once\n`,
      "utf-8"
    );
    await clearJobSchedule("one-shot");
    const after = await readFile(path, "utf-8");
    expect(after).not.toContain("schedule:");
    expect(after).toContain("recurring: false");
    expect(after).toContain("Do it once");
  });

  it("leaves non-frontmatter content intact", async () => {
    const path = join(tempDir, "broken.md");
    await writeFile(path, "no frontmatter here", "utf-8");
    await clearJobSchedule("broken");
    const after = await readFile(path, "utf-8");
    expect(after).toBe("no frontmatter here");
  });
});
