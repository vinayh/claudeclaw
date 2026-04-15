import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { mkdtemp, rm, readFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-jobs-test-"));
const JOBS_DIR = join(tempDir, "jobs");

mock.module("../constants", () => ({
  JOBS_DIR,
}));

import { createQuickJob, deleteJob } from "./jobs";

async function cleanTempDir() {
  await rm(JOBS_DIR, { recursive: true, force: true });
}

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("createQuickJob", () => {
  beforeEach(cleanTempDir);

  it("creates a job file with correct frontmatter", async () => {
    const result = await createQuickJob({ time: "09:30", prompt: "Do the thing" });
    expect(result.schedule).toBe("30 9 * * *");
    expect(result.recurring).toBe(true);

    const files = await readdir(JOBS_DIR);
    expect(files.length).toBe(1);

    const content = await readFile(join(JOBS_DIR, files[0]), "utf-8");
    expect(content).toContain('schedule: "30 9 * * *"');
    expect(content).toContain("recurring: true");
    expect(content).toContain("Do the thing");
  });

  it("supports non-recurring jobs", async () => {
    const result = await createQuickJob({ time: "14:00", prompt: "Once", recurring: false });
    expect(result.recurring).toBe(false);
  });

  it("rejects invalid time format", async () => {
    await expect(createQuickJob({ time: "9:30", prompt: "test" })).rejects.toThrow("Invalid time");
  });

  it("rejects empty prompt", async () => {
    await expect(createQuickJob({ time: "09:00", prompt: "" })).rejects.toThrow("Prompt is required");
  });

  it("rejects overly long prompt", async () => {
    const longPrompt = "x".repeat(10_001);
    await expect(createQuickJob({ time: "09:00", prompt: longPrompt })).rejects.toThrow("Prompt too long");
  });

  it("rejects out-of-range hours", async () => {
    await expect(createQuickJob({ time: "25:00", prompt: "test" })).rejects.toThrow("Time out of range");
  });

  it("rejects out-of-range minutes", async () => {
    await expect(createQuickJob({ time: "12:60", prompt: "test" })).rejects.toThrow("Time out of range");
  });
});

describe("deleteJob", () => {
  beforeEach(async () => {
    await cleanTempDir();
    await mkdir(JOBS_DIR, { recursive: true });
  });

  it("rejects invalid job name characters", async () => {
    await expect(deleteJob("../../../etc/passwd")).rejects.toThrow("Invalid job name");
  });

  it("rejects empty job name", async () => {
    await expect(deleteJob("")).rejects.toThrow("Invalid job name");
  });
});
